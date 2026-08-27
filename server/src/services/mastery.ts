import { db } from '../db/index.js';
import { describeConstruct } from '../evaluation/constructs.js';

/**
 * Construct-level mastery.
 *
 * The platform teaches *constructs* — a for loop, a LEFT JOIN, a list
 * comprehension — but progress was tracked per topic and per question, which
 * are only proxies for the thing being learned. "Loops: 78%" says nothing
 * about whether a student has ever successfully written a `while` loop.
 *
 * Every submission already reports the constructs the analyser found, so this
 * reads them straight back: attempts, successes and last use, per construct.
 */

export interface ConstructMastery {
  construct: string;
  label: string;
  /** Submissions in which the student wrote this construct. */
  attempts: number;
  /** Of those, how many were correct answers. */
  correct: number;
  /** Attempts where the question explicitly asked for this construct. */
  required: number;
  accuracy: number;
  distinctQuestions: number;
  lastUsedAt: string | null;
  level: MasteryLevel;
}

/**
 * Deliberately coarse. Three correct uses is not proof of mastery, but it is
 * enough to stop recommending the basics, and a scale with more gradations
 * would imply a precision this data does not have.
 */
export type MasteryLevel = 'unseen' | 'attempted' | 'developing' | 'proficient';

export function levelFor(correct: number, accuracy: number): MasteryLevel {
  if (correct === 0) return 'attempted';
  if (correct >= 3 && accuracy >= 0.75) return 'proficient';
  return 'developing';
}

export function masteryForUser(userId: number, opts: { language?: string } = {}): ConstructMastery[] {
  const clause = opts.language ? 'AND l.slug = @language' : '';
  const rows = db().prepare(`
    SELECT sc.construct,
           COUNT(*)                              AS attempts,
           SUM(sc.is_correct)                    AS correct,
           SUM(sc.was_required)                  AS required,
           COUNT(DISTINCT sc.question_id)        AS distinct_questions,
           MAX(sc.created_at)                    AS last_used_at
    FROM submission_constructs sc
    JOIN questions q ON q.id = sc.question_id
    JOIN languages l ON l.id = q.language_id
    WHERE sc.user_id = @userId ${clause}
    GROUP BY sc.construct
    ORDER BY attempts DESC, sc.construct ASC
  `).all({ userId, language: opts.language ?? null }) as any[];

  return rows.map((r) => {
    const attempts = r.attempts ?? 0;
    const correct = r.correct ?? 0;
    const accuracy = attempts > 0 ? correct / attempts : 0;
    return {
      construct: r.construct,
      label: describeConstruct(r.construct),
      attempts,
      correct,
      required: r.required ?? 0,
      accuracy,
      distinctQuestions: r.distinct_questions ?? 0,
      lastUsedAt: r.last_used_at ?? null,
      level: levelFor(correct, accuracy),
    };
  });
}

/**
 * Constructs the catalogue teaches that this student has never once written
 * correctly — the honest answer to "what should I learn next".
 */
export interface ConstructGap {
  construct: string;
  label: string;
  attempts: number;
  questionsAvailable: number;
  nextQuestion: { id: number; qid: string; title: string; difficulty: string } | null;
}

export function gapsForUser(userId: number, limit = 12): ConstructGap[] {
  // Every construct the published bank actually requires, with how many
  // questions practise it.
  const taught = db().prepare(`
    SELECT q.id, q.qid, q.title, q.difficulty, q.required_constructs
    FROM questions q
    WHERE q.status = 'published' AND q.required_constructs <> '[]'
  `).all() as Array<{ id: number; qid: string; title: string; difficulty: string; required_constructs: string }>;

  const byConstruct = new Map<string, Array<{ id: number; qid: string; title: string; difficulty: string }>>();
  for (const row of taught) {
    let listed: string[];
    try {
      listed = JSON.parse(row.required_constructs) as string[];
    } catch {
      continue;
    }
    for (const entry of listed) {
      // A question asking for "either of these" practises both.
      const names = entry.startsWith('ANY:') ? entry.slice(4).split('|').map((n) => n.trim()) : [entry];
      for (const name of names) {
        const list = byConstruct.get(name) ?? [];
        list.push({ id: row.id, qid: row.qid, title: row.title, difficulty: row.difficulty });
        byConstruct.set(name, list);
      }
    }
  }

  const mastery = new Map(masteryForUser(userId).map((m) => [m.construct, m]));
  const solvedQuestions = new Set(
    (db().prepare('SELECT question_id FROM student_progress WHERE user_id = ? AND solved = 1')
      .all(userId) as Array<{ question_id: number }>).map((r) => r.question_id),
  );

  const gaps: ConstructGap[] = [];
  for (const [construct, questions] of byConstruct) {
    const seen = mastery.get(construct);
    if (seen && seen.correct > 0) continue;
    const next = questions.find((q) => !solvedQuestions.has(q.id)) ?? null;
    gaps.push({
      construct,
      label: describeConstruct(construct),
      attempts: seen?.attempts ?? 0,
      questionsAvailable: questions.length,
      nextQuestion: next,
    });
  }

  // Tried and not yet managed comes before never attempted: the student is
  // already engaged with it.
  gaps.sort((a, b) => b.attempts - a.attempts || b.questionsAvailable - a.questionsAvailable);
  return gaps.slice(0, limit);
}

/** Cohort-wide construct accuracy, for the admin analytics view. */
export function masteryAcrossCohort(limit = 30): Array<{
  construct: string; label: string; attempts: number; correct: number; accuracy: number; students: number;
}> {
  const rows = db().prepare(`
    SELECT construct,
           COUNT(*) AS attempts,
           SUM(is_correct) AS correct,
           COUNT(DISTINCT user_id) AS students
    FROM submission_constructs
    GROUP BY construct
    HAVING attempts >= 3
    ORDER BY (CAST(SUM(is_correct) AS REAL) / COUNT(*)) ASC, attempts DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r) => ({
    construct: r.construct,
    label: describeConstruct(r.construct),
    attempts: r.attempts,
    correct: r.correct ?? 0,
    accuracy: r.attempts > 0 ? (r.correct ?? 0) / r.attempts : 0,
    students: r.students,
  }));
}
