import { db } from '../db/index.js';

/**
 * Spaced repetition over solved questions.
 *
 * Syntax is close to the ideal case for spaced repetition: the items are small
 * and discrete, recall decays quickly, and re-testing is cheap. Solving a
 * question once and never seeing it again is how a student ends up recognising
 * a `for` loop without being able to write one.
 *
 * The schedule is SM-2, simplified. A question enters the schedule the first
 * time it is solved, and every later submission of it grades the recall:
 *
 *   first attempt, no hints, correct  → 5   (effortless)
 *   correct, but with hints or retries → 3-4 (recalled with effort)
 *   wrong                              → 2   (a lapse: back to a one-day interval)
 */

export const MIN_EASE = 1.3;

export interface ReviewGrade {
  /** 0-5, SM-2's quality score. */
  quality: number;
}

export interface ScheduleRow {
  userId: number;
  questionId: number;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: string;
  lastReviewAt: string | null;
}

/** Turns the outcome of an attempt into an SM-2 quality score. */
export function gradeAttempt(input: {
  isCorrect: boolean;
  hintsUsed: number;
  attemptNumber: number;
  solutionRevealed?: boolean;
}): number {
  if (!input.isCorrect) return 2;
  if (input.solutionRevealed) return 3;
  if (input.hintsUsed === 0 && input.attemptNumber <= 1) return 5;
  if (input.hintsUsed <= 1 && input.attemptNumber <= 2) return 4;
  return 3;
}

/**
 * The SM-2 step. Exported so the interval policy can be tested without a
 * database: given a current state and a grade, what comes next.
 */
export function nextSchedule(
  current: { ease: number; intervalDays: number; repetitions: number; lapses: number },
  quality: number,
): { ease: number; intervalDays: number; repetitions: number; lapses: number } {
  // A grade below 3 is a lapse: the interval collapses, but the ease decays
  // rather than resetting, so a single slip does not erase a long history.
  if (quality < 3) {
    return {
      ease: Math.max(MIN_EASE, current.ease - 0.2),
      intervalDays: 1,
      repetitions: 0,
      lapses: current.lapses + 1,
    };
  }

  const repetitions = current.repetitions + 1;
  const ease = Math.max(
    MIN_EASE,
    current.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  let intervalDays: number;
  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  else intervalDays = Math.round(current.intervalDays * ease);

  // A year is far past the point where re-testing tells you anything new.
  return { ease, intervalDays: Math.min(intervalDays, 365), repetitions, lapses: current.lapses };
}

function addDays(days: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return at.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Records a review. Called for every submitted attempt on a question the
 * student has solved before, and for the solve that first schedules it.
 */
export function recordReview(input: {
  userId: number;
  questionId: number;
  quality: number;
}): ScheduleRow {
  const conn = db();
  const existing = conn.prepare(
    'SELECT ease, interval_days, repetitions, lapses FROM review_schedule WHERE user_id = ? AND question_id = ?',
  ).get(input.userId, input.questionId) as
    { ease: number; interval_days: number; repetitions: number; lapses: number } | undefined;

  const current = existing
    ? { ease: existing.ease, intervalDays: existing.interval_days, repetitions: existing.repetitions, lapses: existing.lapses }
    : { ease: 2.5, intervalDays: 1, repetitions: 0, lapses: 0 };

  const next = nextSchedule(current, input.quality);
  const dueAt = addDays(next.intervalDays);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  conn.prepare(`
    INSERT INTO review_schedule
      (user_id, question_id, ease, interval_days, repetitions, lapses, due_at, last_review_at)
    VALUES (@userId, @questionId, @ease, @intervalDays, @repetitions, @lapses, @dueAt, @now)
    ON CONFLICT(user_id, question_id) DO UPDATE SET
      ease = excluded.ease,
      interval_days = excluded.interval_days,
      repetitions = excluded.repetitions,
      lapses = excluded.lapses,
      due_at = excluded.due_at,
      last_review_at = excluded.last_review_at
  `).run({
    userId: input.userId,
    questionId: input.questionId,
    ease: next.ease,
    intervalDays: next.intervalDays,
    repetitions: next.repetitions,
    lapses: next.lapses,
    dueAt,
    now,
  });

  return {
    userId: input.userId,
    questionId: input.questionId,
    ease: next.ease,
    intervalDays: next.intervalDays,
    repetitions: next.repetitions,
    lapses: next.lapses,
    dueAt,
    lastReviewAt: now,
  };
}

export interface DueReview {
  questionId: number;
  qid: string;
  title: string;
  language: string;
  topic: string;
  difficulty: string;
  dueAt: string;
  intervalDays: number;
  lapses: number;
  /** Whole days overdue; 0 means due today. */
  overdueDays: number;
}

/** Questions whose review has come due, most overdue first. */
export function dueForUser(userId: number, limit = 20): DueReview[] {
  const rows = db().prepare(`
    SELECT r.question_id, r.due_at, r.interval_days, r.lapses,
           q.qid, q.title, q.difficulty, l.slug AS language, t.slug AS topic,
           CAST(julianday('now') - julianday(r.due_at) AS INTEGER) AS overdue_days
    FROM review_schedule r
    JOIN questions q ON q.id = r.question_id
    JOIN languages l ON l.id = q.language_id
    JOIN topics t ON t.id = q.topic_id
    WHERE r.user_id = ? AND r.due_at <= datetime('now') AND q.status = 'published'
    ORDER BY r.due_at ASC
    LIMIT ?
  `).all(userId, Math.min(limit, 100)) as any[];

  return rows.map((r) => ({
    questionId: r.question_id,
    qid: r.qid,
    title: r.title,
    language: r.language,
    topic: r.topic,
    difficulty: r.difficulty,
    dueAt: r.due_at,
    intervalDays: r.interval_days,
    lapses: r.lapses,
    overdueDays: Math.max(0, r.overdue_days ?? 0),
  }));
}

export interface ReviewSummary {
  dueNow: number;
  dueToday: number;
  scheduled: number;
  /** Upcoming load, so a student can see what is coming rather than only what is late. */
  upcoming: Array<{ date: string; count: number }>;
}

export function summaryForUser(userId: number): ReviewSummary {
  const conn = db();
  const dueNow = (conn.prepare(
    `SELECT COUNT(*) AS n FROM review_schedule WHERE user_id = ? AND due_at <= datetime('now')`,
  ).get(userId) as { n: number }).n;

  const dueToday = (conn.prepare(
    `SELECT COUNT(*) AS n FROM review_schedule WHERE user_id = ? AND date(due_at) <= date('now')`,
  ).get(userId) as { n: number }).n;

  const scheduled = (conn.prepare(
    'SELECT COUNT(*) AS n FROM review_schedule WHERE user_id = ?',
  ).get(userId) as { n: number }).n;

  const upcoming = (conn.prepare(`
    SELECT date(due_at) AS date, COUNT(*) AS count
    FROM review_schedule
    WHERE user_id = ? AND date(due_at) > date('now') AND date(due_at) <= date('now', '+14 days')
    GROUP BY date(due_at)
    ORDER BY date(due_at)
  `).all(userId) as Array<{ date: string; count: number }>);

  return { dueNow, dueToday, scheduled, upcoming };
}
