import { db } from '../index.js';

/** §17 Student dashboard + §24 admin analytics queries. */

export interface Breakdown {
  key: string;
  label: string;
  attempted: number;
  solved: number;
  total: number;
  accuracy: number;
}

export interface DashboardSummary {
  attempted: number;
  solved: number;
  totalQuestions: number;
  accuracy: number;
  submissions: number;
  correctSubmissions: number;
  streakCurrent: number;
  streakBest: number;
  xp: number;
  level: number;
  timeSpentMs: number;
  hintsUsed: number;
  errors: { syntax: number; runtime: number; conceptual: number; restricted: number; timeout: number };
  byLanguage: Breakdown[];
  byTopic: Breakdown[];
  byDifficulty: Breakdown[];
  weakTopics: Breakdown[];
  strongTopics: Breakdown[];
  recentActivity: Array<{ day: string; attempts: number; solved: number }>;
}

export function dashboardFor(userId: number): DashboardSummary {
  const conn = db();

  const totals = conn.prepare(`
    SELECT
      COUNT(*) AS attempted,
      COALESCE(SUM(solved), 0) AS solved,
      COALESCE(SUM(total_time_ms), 0) AS time_spent,
      COALESCE(SUM(hints_used), 0) AS hints_used,
      COALESCE(SUM(syntax_errors), 0) AS syntax_errors,
      COALESCE(SUM(runtime_errors), 0) AS runtime_errors,
      COALESCE(SUM(construct_errors), 0) AS construct_errors
    FROM student_progress WHERE user_id = ?
  `).get(userId) as any;

  const submissionStats = conn.prepare(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(is_correct), 0) AS correct,
           COALESCE(SUM(CASE WHEN verdict = 'RESTRICTED' THEN 1 ELSE 0 END), 0) AS restricted,
           COALESCE(SUM(CASE WHEN verdict = 'TIMEOUT' THEN 1 ELSE 0 END), 0) AS timeouts
    FROM submissions WHERE user_id = ? AND mode = 'submit'
  `).get(userId) as any;

  const student = conn.prepare(
    'SELECT xp, level, streak_current, streak_best FROM students WHERE user_id = ?',
  ).get(userId) as any ?? { xp: 0, level: 1, streak_current: 0, streak_best: 0 };

  const totalQuestions = (conn.prepare(
    `SELECT COUNT(*) AS n FROM questions WHERE status = 'published'`,
  ).get() as { n: number }).n;

  const byLanguage = breakdown(userId, 'language');
  const byTopic = breakdown(userId, 'topic');
  const byDifficulty = breakdown(userId, 'difficulty');

  const engaged = byTopic.filter((t) => t.attempted >= 2);
  const weakTopics = [...engaged].sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
  const strongTopics = [...engaged].sort((a, b) => b.accuracy - a.accuracy).slice(0, 5);

  const recentActivity = conn.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS attempts, COALESCE(SUM(is_correct), 0) AS solved
    FROM submissions
    WHERE user_id = ? AND mode = 'submit' AND created_at >= date('now', '-29 days')
    GROUP BY date(created_at)
    ORDER BY day
  `).all(userId) as Array<{ day: string; attempts: number; solved: number }>;

  const attempted = totals?.attempted ?? 0;
  const solved = totals?.solved ?? 0;

  return {
    attempted,
    solved,
    totalQuestions,
    accuracy: attempted > 0 ? Math.round((solved / attempted) * 100) : 0,
    submissions: submissionStats?.n ?? 0,
    correctSubmissions: submissionStats?.correct ?? 0,
    streakCurrent: student.streak_current,
    streakBest: student.streak_best,
    xp: student.xp,
    level: student.level,
    timeSpentMs: totals?.time_spent ?? 0,
    hintsUsed: totals?.hints_used ?? 0,
    errors: {
      syntax: totals?.syntax_errors ?? 0,
      runtime: totals?.runtime_errors ?? 0,
      conceptual: totals?.construct_errors ?? 0,
      restricted: submissionStats?.restricted ?? 0,
      timeout: submissionStats?.timeouts ?? 0,
    },
    byLanguage,
    byTopic,
    byDifficulty,
    weakTopics,
    strongTopics,
    recentActivity,
  };
}

/** Per-language / per-topic / per-difficulty accuracy, including untouched buckets. */
export function breakdown(userId: number, dimension: 'language' | 'topic' | 'difficulty'): Breakdown[] {
  const conn = db();
  const select = {
    language: { key: 'l.slug', label: 'l.name', group: 'l.id' },
    topic: { key: 't.slug', label: "t.name || ' · ' || l.name", group: 't.id' },
    difficulty: { key: 'q.difficulty', label: 'q.difficulty', group: 'q.difficulty' },
  }[dimension];

  return (conn.prepare(`
    SELECT ${select.key} AS key, ${select.label} AS label,
           COUNT(DISTINCT q.id) AS total,
           COUNT(DISTINCT sp.question_id) AS attempted,
           COUNT(DISTINCT CASE WHEN sp.solved = 1 THEN sp.question_id END) AS solved
    FROM questions q
    JOIN languages l ON l.id = q.language_id
    JOIN topics t ON t.id = q.topic_id
    LEFT JOIN student_progress sp ON sp.question_id = q.id AND sp.user_id = ?
    WHERE q.status = 'published'
    GROUP BY ${select.group}
    ORDER BY label
  `).all(userId) as any[]).map((r) => ({
    key: String(r.key),
    label: String(r.label),
    total: r.total,
    attempted: r.attempted,
    solved: r.solved,
    accuracy: r.attempted > 0 ? Math.round((r.solved / r.attempted) * 100) : 0,
  }));
}

// ------------------------------------------------------ admin analytics

export interface QuestionStat {
  questionId: number;
  qid: string;
  title: string;
  language: string;
  topic: string;
  difficulty: string;
  attempts: number;
  distinctStudents: number;
  solvedBy: number;
  successRate: number;
  avgAttempts: number;
  avgTimeMs: number;
  hintsUsed: number;
}

export function questionStats(opts: { limit?: number; order?: 'hardest' | 'easiest' | 'most_attempted' } = {}): QuestionStat[] {
  const order = {
    hardest: 'success_rate ASC, attempts DESC',
    easiest: 'success_rate DESC, attempts DESC',
    most_attempted: 'attempts DESC',
  }[opts.order ?? 'hardest'];
  const limit = Math.min(opts.limit ?? 20, 200);

  return (db().prepare(`
    SELECT q.id, q.qid, q.title, q.difficulty, l.slug AS language, t.slug AS topic,
           COUNT(s.id) AS attempts,
           COUNT(DISTINCT s.user_id) AS distinct_students,
           COUNT(DISTINCT CASE WHEN s.is_correct = 1 THEN s.user_id END) AS solved_by,
           CASE WHEN COUNT(DISTINCT s.user_id) = 0 THEN 0
                ELSE ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.is_correct = 1 THEN s.user_id END)
                     / COUNT(DISTINCT s.user_id), 1) END AS success_rate,
           CASE WHEN COUNT(DISTINCT s.user_id) = 0 THEN 0
                ELSE ROUND(1.0 * COUNT(s.id) / COUNT(DISTINCT s.user_id), 2) END AS avg_attempts,
           COALESCE(ROUND(AVG(s.time_spent_ms)), 0) AS avg_time_ms,
           COALESCE(SUM(s.hints_used), 0) AS hints_used
    FROM questions q
    JOIN languages l ON l.id = q.language_id
    JOIN topics t ON t.id = q.topic_id
    LEFT JOIN submissions s ON s.question_id = q.id AND s.mode = 'submit'
    GROUP BY q.id
    HAVING attempts > 0
    ORDER BY ${order}
    LIMIT ${limit}
  `).all() as any[]).map((r) => ({
    questionId: r.id,
    qid: r.qid,
    title: r.title,
    language: r.language,
    topic: r.topic,
    difficulty: r.difficulty,
    attempts: r.attempts,
    distinctStudents: r.distinct_students,
    solvedBy: r.solved_by,
    successRate: r.success_rate,
    avgAttempts: r.avg_attempts,
    avgTimeMs: r.avg_time_ms,
    hintsUsed: r.hints_used,
  }));
}

/** §24 — "top weak concepts" across the cohort. */
export function topicAccuracy(): Array<{ topic: string; language: string; label: string; attempts: number; accuracy: number }> {
  return (db().prepare(`
    SELECT t.slug AS topic, l.slug AS language, t.name || ' (' || l.name || ')' AS label,
           COUNT(s.id) AS attempts,
           CASE WHEN COUNT(s.id) = 0 THEN 0
                ELSE ROUND(100.0 * SUM(s.is_correct) / COUNT(s.id), 1) END AS accuracy
    FROM topics t
    JOIN languages l ON l.id = t.language_id
    JOIN questions q ON q.topic_id = t.id
    JOIN submissions s ON s.question_id = q.id AND s.mode = 'submit'
    GROUP BY t.id
    HAVING attempts >= 1
    ORDER BY accuracy ASC
  `).all() as any[]);
}

export function commonErrors(limit = 15): Array<{ errorType: string; verdict: string; message: string; count: number }> {
  return (db().prepare(`
    SELECT error_type AS errorType, verdict, COALESCE(error_message, '') AS message, COUNT(*) AS count
    FROM submissions
    WHERE mode = 'submit' AND is_correct = 0 AND error_message IS NOT NULL
    GROUP BY error_type, verdict, error_message
    ORDER BY count DESC
    LIMIT ?
  `).all(limit) as any[]);
}

export interface StudentRanking {
  userId: number;
  name: string;
  email: string;
  batch: string | null;
  xp: number;
  level: number;
  solved: number;
  attempted: number;
  accuracy: number;
  streak: number;
}

export function leaderboard(limit = 20, batch?: string): StudentRanking[] {
  const clause = batch ? 'WHERE st.batch = @batch' : '';
  return (db().prepare(`
    SELECT u.id AS user_id, u.full_name AS name, u.email, st.batch, st.xp, st.level,
           st.streak_current AS streak,
           COALESCE(p.attempted, 0) AS attempted,
           COALESCE(p.solved, 0) AS solved,
           CASE WHEN COALESCE(p.attempted, 0) = 0 THEN 0
                ELSE ROUND(100.0 * COALESCE(p.solved, 0) / p.attempted) END AS accuracy
    FROM students st
    JOIN users u ON u.id = st.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS attempted, SUM(solved) AS solved
      FROM student_progress GROUP BY user_id
    ) p ON p.user_id = st.user_id
    ${clause}
    ORDER BY st.xp DESC, solved DESC, u.full_name
    LIMIT @limit
  `).all({ limit: Math.min(limit, 200), batch }) as any[]).map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    batch: r.batch,
    xp: r.xp,
    level: r.level,
    solved: r.solved,
    attempted: r.attempted,
    accuracy: r.accuracy,
    streak: r.streak,
  }));
}

export function platformOverview(): Record<string, number> {
  const conn = db();
  const one = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
  return {
    students: one(`SELECT COUNT(*) AS n FROM users WHERE role = 'student'`),
    questions: one(`SELECT COUNT(*) AS n FROM questions WHERE status = 'published'`),
    draftQuestions: one(`SELECT COUNT(*) AS n FROM questions WHERE status = 'draft'`),
    submissions: one(`SELECT COUNT(*) AS n FROM submissions WHERE mode = 'submit'`),
    correctSubmissions: one(`SELECT COUNT(*) AS n FROM submissions WHERE mode = 'submit' AND is_correct = 1`),
    assessments: one(`SELECT COUNT(*) AS n FROM assessments`),
    submissionsToday: one(`SELECT COUNT(*) AS n FROM submissions WHERE mode = 'submit' AND date(created_at) = date('now')`),
    activeStudentsToday: one(`SELECT COUNT(DISTINCT user_id) AS n FROM submissions WHERE date(created_at) = date('now')`),
  };
}

/** Per-student view for the admin student list. */
export function studentSummaries(limit = 100, search?: string): StudentRanking[] {
  const clause = search ? `WHERE u.full_name LIKE @search OR u.email LIKE @search` : '';
  return (db().prepare(`
    SELECT u.id AS user_id, u.full_name AS name, u.email, st.batch, st.xp, st.level,
           st.streak_current AS streak,
           COALESCE(p.attempted, 0) AS attempted,
           COALESCE(p.solved, 0) AS solved,
           CASE WHEN COALESCE(p.attempted, 0) = 0 THEN 0
                ELSE ROUND(100.0 * COALESCE(p.solved, 0) / p.attempted) END AS accuracy
    FROM users u
    JOIN students st ON st.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS attempted, SUM(solved) AS solved
      FROM student_progress GROUP BY user_id
    ) p ON p.user_id = u.id
    ${clause}
    ORDER BY u.full_name
    LIMIT @limit
  `).all({ limit: Math.min(limit, 500), search: search ? `%${search}%` : undefined }) as any[]).map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    batch: r.batch,
    xp: r.xp,
    level: r.level,
    solved: r.solved,
    attempted: r.attempted,
    accuracy: r.accuracy,
    streak: r.streak,
  }));
}

/** Progress rows for one user keyed by question id — used to badge lists. */
export function progressMap(userId: number): Map<number, { solved: boolean; attempts: number; bestScore: number }> {
  const rows = db().prepare(
    'SELECT question_id, solved, attempts, best_score FROM student_progress WHERE user_id = ?',
  ).all(userId) as Array<{ question_id: number; solved: number; attempts: number; best_score: number }>;
  return new Map(rows.map((r) => [r.question_id, {
    solved: r.solved === 1,
    attempts: r.attempts,
    bestScore: r.best_score,
  }]));
}
