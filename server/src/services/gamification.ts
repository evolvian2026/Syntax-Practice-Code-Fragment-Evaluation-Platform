import { config } from '../config.js';
import { db } from '../db/index.js';

/**
 * §27 — XP, levels, streaks, badges, daily challenges, leaderboards.
 *
 * Awarding is idempotent per (student, question): XP is granted the first time
 * a question is solved, so re-submitting a solved question cannot farm points.
 */

export interface BadgeRow {
  id: number; slug: string; name: string; description: string; icon: string;
  criteria_type: string; criteria_value: number; scope_language: string | null;
  scope_topic: string | null; xp_reward: number;
}

export interface AwardResult {
  xpEarned: number;
  totalXp: number;
  level: number;
  leveledUp: boolean;
  streak: number;
  streakExtended: boolean;
  newBadges: Array<{ slug: string; name: string; description: string; icon: string }>;
}

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(xp / config.scoring.levelXpStep) + 1);
}

export function xpForLevel(level: number): number {
  return (level - 1) * config.scoring.levelXpStep;
}

/** Called after a successful `submit`. Returns everything the UI should celebrate. */
export function awardForSolve(opts: {
  userId: number;
  questionId: number;
  difficulty: string;
  score: number;
  maxScore: number;
  firstSolve: boolean;
  hintsUsed: number;
}): AwardResult {
  const conn = db();
  const student = conn.prepare('SELECT * FROM students WHERE user_id = ?').get(opts.userId) as any;
  if (!student) {
    return { xpEarned: 0, totalXp: 0, level: 1, leveledUp: false, streak: 0, streakExtended: false, newBadges: [] };
  }

  const streak = updateStreak(opts.userId, student);

  let xpEarned = 0;
  if (opts.firstSolve) {
    const base = config.scoring.xpPerDifficulty[opts.difficulty] ?? 10;
    const ratio = opts.maxScore > 0 ? opts.score / opts.maxScore : 0;
    xpEarned = Math.max(1, Math.round(base * ratio));
    if (opts.hintsUsed === 0) xpEarned += Math.round(base * 0.2); // no-hint bonus
    xpEarned += dailyChallengeBonus(opts.userId, opts.questionId);
  }

  const previousLevel = student.level as number;
  const totalXp = (student.xp as number) + xpEarned;
  const level = levelForXp(totalXp);

  if (xpEarned > 0) {
    conn.prepare('UPDATE students SET xp = ?, level = ? WHERE user_id = ?').run(totalXp, level, opts.userId);
    conn.prepare('INSERT INTO xp_events (user_id, amount, reason, question_id) VALUES (?, ?, ?, ?)')
      .run(opts.userId, xpEarned, opts.firstSolve ? 'question_solved' : 'practice', opts.questionId);
  }

  const newBadges = evaluateBadges(opts.userId);

  return {
    xpEarned,
    totalXp,
    level,
    leveledUp: level > previousLevel,
    streak: streak.current,
    streakExtended: streak.extended,
    newBadges,
  };
}

function dailyChallengeBonus(userId: number, questionId: number): number {
  const conn = db();
  const today = conn.prepare(
    `SELECT question_id, xp_bonus FROM daily_challenges WHERE day = date('now')`,
  ).get() as { question_id: number; xp_bonus: number } | undefined;
  if (!today || today.question_id !== questionId) return 0;

  const already = conn.prepare(
    `SELECT 1 FROM xp_events WHERE user_id = ? AND reason = 'daily_challenge' AND date(created_at) = date('now')`,
  ).get(userId);
  if (already) return 0;

  conn.prepare('INSERT INTO xp_events (user_id, amount, reason, question_id) VALUES (?, ?, ?, ?)')
    .run(userId, today.xp_bonus, 'daily_challenge', questionId);
  return today.xp_bonus;
}

function updateStreak(userId: number, student: any): { current: number; extended: boolean } {
  const conn = db();
  const today = new Date().toISOString().slice(0, 10);
  const last = student.last_practice_date as string | null;

  if (last === today) return { current: student.streak_current, extended: false };

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const current = last === yesterday ? student.streak_current + 1 : 1;
  const best = Math.max(student.streak_best as number, current);

  conn.prepare(
    'UPDATE students SET streak_current = ?, streak_best = ?, last_practice_date = ? WHERE user_id = ?',
  ).run(current, best, today, userId);

  return { current, extended: true };
}

/** Re-checks every badge rule against live progress; grants any newly earned. */
export function evaluateBadges(userId: number): Array<{ slug: string; name: string; description: string; icon: string }> {
  const conn = db();
  const badges = conn.prepare('SELECT * FROM badges').all() as BadgeRow[];
  const owned = new Set(
    (conn.prepare('SELECT badge_id FROM student_badges WHERE user_id = ?').all(userId) as { badge_id: number }[])
      .map((r) => r.badge_id),
  );

  const earned: Array<{ slug: string; name: string; description: string; icon: string }> = [];

  for (const badge of badges) {
    if (owned.has(badge.id)) continue;
    if (!meetsCriteria(userId, badge)) continue;

    conn.prepare('INSERT OR IGNORE INTO student_badges (user_id, badge_id) VALUES (?, ?)').run(userId, badge.id);
    if (badge.xp_reward > 0) {
      conn.prepare('UPDATE students SET xp = xp + ? WHERE user_id = ?').run(badge.xp_reward, userId);
      conn.prepare('INSERT INTO xp_events (user_id, amount, reason) VALUES (?, ?, ?)')
        .run(userId, badge.xp_reward, `badge:${badge.slug}`);
    }
    earned.push({ slug: badge.slug, name: badge.name, description: badge.description, icon: badge.icon });
  }

  if (earned.length > 0) {
    const xp = (conn.prepare('SELECT xp FROM students WHERE user_id = ?').get(userId) as { xp: number }).xp;
    conn.prepare('UPDATE students SET level = ? WHERE user_id = ?').run(levelForXp(xp), userId);
  }

  return earned;
}

function meetsCriteria(userId: number, badge: BadgeRow): boolean {
  const conn = db();
  switch (badge.criteria_type) {
    case 'solved_total': {
      const n = (conn.prepare(
        'SELECT COUNT(*) AS n FROM student_progress WHERE user_id = ? AND solved = 1',
      ).get(userId) as { n: number }).n;
      return n >= badge.criteria_value;
    }
    case 'streak': {
      const s = conn.prepare('SELECT streak_current FROM students WHERE user_id = ?').get(userId) as { streak_current: number };
      return (s?.streak_current ?? 0) >= badge.criteria_value;
    }
    case 'xp': {
      const s = conn.prepare('SELECT xp FROM students WHERE user_id = ?').get(userId) as { xp: number };
      return (s?.xp ?? 0) >= badge.criteria_value;
    }
    case 'topic_solved': {
      const n = (conn.prepare(`
        SELECT COUNT(*) AS n FROM student_progress sp
        JOIN questions q ON q.id = sp.question_id
        JOIN topics t ON t.id = q.topic_id
        JOIN languages l ON l.id = q.language_id
        WHERE sp.user_id = ? AND sp.solved = 1 AND t.slug = ?
          AND (? IS NULL OR l.slug = ?)
      `).get(userId, badge.scope_topic, badge.scope_language, badge.scope_language) as { n: number }).n;
      return n >= badge.criteria_value;
    }
    case 'language_solved': {
      const n = (conn.prepare(`
        SELECT COUNT(*) AS n FROM student_progress sp
        JOIN questions q ON q.id = sp.question_id
        JOIN languages l ON l.id = q.language_id
        WHERE sp.user_id = ? AND sp.solved = 1 AND l.slug = ?
      `).get(userId, badge.scope_language) as { n: number }).n;
      return n >= badge.criteria_value;
    }
    case 'language_accuracy': {
      const row = conn.prepare(`
        SELECT COUNT(*) AS attempted, COALESCE(SUM(sp.solved), 0) AS solved
        FROM student_progress sp
        JOIN questions q ON q.id = sp.question_id
        JOIN languages l ON l.id = q.language_id
        WHERE sp.user_id = ? AND l.slug = ?
      `).get(userId, badge.scope_language) as { attempted: number; solved: number };
      if (!row || row.attempted < 5) return false;
      return (row.solved / row.attempted) * 100 >= badge.criteria_value;
    }
    case 'first_try': {
      const n = (conn.prepare(
        'SELECT COUNT(*) AS n FROM student_progress WHERE user_id = ? AND solved = 1 AND attempts = 1',
      ).get(userId) as { n: number }).n;
      return n >= badge.criteria_value;
    }
    default:
      return false;
  }
}

export function badgesFor(userId: number): Array<{
  slug: string; name: string; description: string; icon: string;
  earned: boolean; earnedAt: string | null; progressLabel: string;
}> {
  const conn = db();
  const all = conn.prepare('SELECT * FROM badges ORDER BY criteria_type, criteria_value').all() as BadgeRow[];
  const owned = new Map(
    (conn.prepare('SELECT badge_id, earned_at FROM student_badges WHERE user_id = ?').all(userId) as any[])
      .map((r) => [r.badge_id, r.earned_at]),
  );
  return all.map((b) => ({
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    earned: owned.has(b.id),
    earnedAt: owned.get(b.id) ?? null,
    progressLabel: b.description,
  }));
}

/** §27 — deterministic daily challenge, created on first request each day. */
export function todaysChallenge(): { day: string; questionId: number; xpBonus: number } | null {
  const conn = db();
  const existing = conn.prepare(
    `SELECT day, question_id AS questionId, xp_bonus AS xpBonus FROM daily_challenges WHERE day = date('now')`,
  ).get() as any;
  if (existing) return existing;

  const pick = conn.prepare(`
    SELECT id FROM questions
    WHERE status = 'published'
    ORDER BY (id * 7919 + CAST(strftime('%j', 'now') AS INTEGER) * 104729) % 100003
    LIMIT 1
  `).get() as { id: number } | undefined;
  if (!pick) return null;

  conn.prepare('INSERT OR IGNORE INTO daily_challenges (day, question_id, xp_bonus) VALUES (date(\'now\'), ?, 50)')
    .run(pick.id);
  return conn.prepare(
    `SELECT day, question_id AS questionId, xp_bonus AS xpBonus FROM daily_challenges WHERE day = date('now')`,
  ).get() as any;
}
