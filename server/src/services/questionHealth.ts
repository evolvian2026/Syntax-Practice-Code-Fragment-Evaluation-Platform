import { db } from '../db/index.js';
import { findQuestionById, toEvaluable, type FullQuestion } from '../db/repositories/questions.js';
import { evaluate } from '../evaluation/engine.js';

/**
 * Question health — every question's own reference solution, re-run through
 * the real engine.
 *
 * A question whose reference solution no longer passes is unanswerable by
 * anyone, and nothing else in the platform surfaces that: to a student it just
 * looks hard, and its pass rate of zero is indistinguishable from a genuinely
 * difficult question. Two seeded fix-the-syntax questions were in exactly that
 * state until an engine change was made to accept a block header whose body
 * lives in the template. This sweep makes that class of breakage loud.
 *
 * It is worth running after any change to the engine, an adapter or the
 * sandbox, which is when questions silently rot.
 */

export type HealthStatus = 'healthy' | 'failing' | 'unverifiable';

export interface HealthRecord {
  questionId: number;
  qid: string;
  title: string;
  status: HealthStatus;
  verdict: string | null;
  message: string | null;
  score: number | null;
  maxScore: number | null;
  durationMs: number;
  checkedAt: string;
}

export interface SweepSummary {
  checked: number;
  healthy: number;
  failing: number;
  unverifiable: number;
  durationMs: number;
  failures: HealthRecord[];
}

/** Verifies one question and records the outcome. Never throws for a bad question. */
export async function checkQuestion(full: FullQuestion): Promise<HealthRecord> {
  const started = Date.now();
  const q = full.question;
  const primary = full.solutions.find((s) => s.is_primary === 1) ?? full.solutions[0];

  let status: HealthStatus;
  let verdict: string | null = null;
  let message: string;
  let score: number | null = null;
  let maxScore: number | null = null;

  if (!primary) {
    status = 'unverifiable';
    message = 'No reference solution to verify.';
  } else {
    try {
      const result = await evaluate({ question: toEvaluable(full), fragment: primary.code, mode: 'submit' });
      verdict = result.verdict;
      score = result.score;
      maxScore = result.maxScore;
      status = result.isCorrect ? 'healthy' : 'failing';
      message = result.isCorrect
        ? 'The reference solution passes every test case.'
        : `The reference solution fails: ${result.feedback}`;
    } catch (err) {
      // An engine or sandbox fault is itself a health problem worth reporting,
      // not something to abort the sweep over.
      status = 'failing';
      message = `The engine could not evaluate this question: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const durationMs = Date.now() - started;
  const record: HealthRecord = {
    questionId: q.id,
    qid: q.qid,
    title: q.title,
    status,
    verdict,
    message,
    score,
    maxScore,
    durationMs,
    checkedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  db().prepare(`
    INSERT INTO question_health (question_id, status, verdict, message, score, max_score, duration_ms, checked_at)
    VALUES (@questionId, @status, @verdict, @message, @score, @maxScore, @durationMs, @checkedAt)
    ON CONFLICT(question_id) DO UPDATE SET
      status = excluded.status, verdict = excluded.verdict, message = excluded.message,
      score = excluded.score, max_score = excluded.max_score,
      duration_ms = excluded.duration_ms, checked_at = excluded.checked_at
  `).run(record);

  return record;
}

/**
 * Verifies every question, oldest-checked first so a time-boxed sweep still
 * makes progress across the whole bank.
 */
export async function sweep(opts: { limit?: number; status?: HealthStatus } = {}): Promise<SweepSummary> {
  const started = Date.now();
  const clause = opts.status
    ? `WHERE q.status = 'published' AND COALESCE(h.status, 'unchecked') = @status`
    : `WHERE q.status = 'published'`;

  const ids = db().prepare(`
    SELECT q.id FROM questions q
    LEFT JOIN question_health h ON h.question_id = q.id
    ${clause}
    ORDER BY COALESCE(h.checked_at, '') ASC, q.id ASC
    LIMIT @limit
  `).all({ limit: Math.min(opts.limit ?? 500, 2000), status: opts.status ?? null }) as Array<{ id: number }>;

  const summary: SweepSummary = {
    checked: 0, healthy: 0, failing: 0, unverifiable: 0, durationMs: 0, failures: [],
  };

  for (const { id } of ids) {
    const full = findQuestionById(id);
    if (!full) continue;
    const record = await checkQuestion(full);
    summary.checked += 1;
    summary[record.status] += 1;
    if (record.status !== 'healthy') summary.failures.push(record);
  }

  summary.durationMs = Date.now() - started;
  return summary;
}

/** The stored health of every question, worst first. */
export function listHealth(opts: { status?: HealthStatus; limit?: number } = {}): HealthRecord[] {
  const clause = opts.status ? 'WHERE h.status = @status' : '';
  const rows = db().prepare(`
    SELECT h.*, q.qid, q.title
    FROM question_health h
    JOIN questions q ON q.id = h.question_id
    ${clause}
    ORDER BY CASE h.status WHEN 'failing' THEN 0 WHEN 'unverifiable' THEN 1 ELSE 2 END,
             h.checked_at DESC
    LIMIT @limit
  `).all({ status: opts.status ?? null, limit: Math.min(opts.limit ?? 200, 1000) }) as any[];

  return rows.map(toRecord);
}

export function healthFor(questionId: number): HealthRecord | null {
  const row = db().prepare(`
    SELECT h.*, q.qid, q.title FROM question_health h
    JOIN questions q ON q.id = h.question_id
    WHERE h.question_id = ?
  `).get(questionId) as any;
  return row ? toRecord(row) : null;
}

/** Counts by status, including questions never checked. */
export function healthSummary(): { healthy: number; failing: number; unverifiable: number; unchecked: number } {
  const row = db().prepare(`
    SELECT
      SUM(CASE WHEN h.status = 'healthy' THEN 1 ELSE 0 END) AS healthy,
      SUM(CASE WHEN h.status = 'failing' THEN 1 ELSE 0 END) AS failing,
      SUM(CASE WHEN h.status = 'unverifiable' THEN 1 ELSE 0 END) AS unverifiable,
      SUM(CASE WHEN h.status IS NULL THEN 1 ELSE 0 END) AS unchecked
    FROM questions q
    LEFT JOIN question_health h ON h.question_id = q.id
    WHERE q.status = 'published'
  `).get() as any;
  return {
    healthy: row.healthy ?? 0,
    failing: row.failing ?? 0,
    unverifiable: row.unverifiable ?? 0,
    unchecked: row.unchecked ?? 0,
  };
}

function toRecord(row: any): HealthRecord {
  return {
    questionId: row.question_id,
    qid: row.qid,
    title: row.title,
    status: row.status,
    verdict: row.verdict,
    message: row.message,
    score: row.score,
    maxScore: row.max_score,
    durationMs: row.duration_ms,
    checkedAt: row.checked_at,
  };
}
