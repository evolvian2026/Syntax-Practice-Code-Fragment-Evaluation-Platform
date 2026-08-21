import { db, parseJson, toJson } from '../index.js';
import type { EvaluationResult } from '../../evaluation/types.js';

/** §22 — every attempt is recorded with its full evaluation trace. */

export interface SubmissionRecordInput {
  userId: number;
  questionId: number;
  assessmentId?: number | null;
  mode: 'run' | 'submit';
  fragment: string;
  result: EvaluationResult;
  hintsUsed: number;
  timeSpentMs: number;
}

export interface SubmissionRow {
  id: number; user_id: number; question_id: number; assessment_id: number | null;
  mode: string; fragment_code: string; generated_code: string; verdict: string;
  is_correct: number; score: number; max_score: number; tests_passed: number; tests_failed: number;
  execution_ms: number; memory_kb: number; error_type: string | null; error_message: string | null;
  hints_used: number; attempt_number: number; time_spent_ms: number; feedback: string; created_at: string;
}

export function recordSubmission(input: SubmissionRecordInput): { submissionId: number; attemptNumber: number } {
  const conn = db();
  const { result } = input;

  const txn = conn.transaction(() => {
    const previous = conn.prepare(
      `SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND question_id = ? AND mode = 'submit'`,
    ).get(input.userId, input.questionId) as { n: number };
    const attemptNumber = previous.n + 1;

    const info = conn.prepare(`
      INSERT INTO submissions (
        user_id, question_id, assessment_id, mode, fragment_code, generated_code, verdict,
        is_correct, score, max_score, tests_passed, tests_failed, execution_ms, memory_kb,
        error_type, error_message, hints_used, attempt_number, time_spent_ms, feedback
      ) VALUES (
        @userId, @questionId, @assessmentId, @mode, @fragment, @generated, @verdict,
        @isCorrect, @score, @maxScore, @testsPassed, @testsFailed, @executionMs, @memoryKb,
        @errorType, @errorMessage, @hintsUsed, @attemptNumber, @timeSpentMs, @feedback
      )
    `).run({
      userId: input.userId,
      questionId: input.questionId,
      assessmentId: input.assessmentId ?? null,
      mode: input.mode,
      fragment: input.fragment,
      generated: result.generatedCode,
      verdict: result.verdict,
      isCorrect: result.isCorrect ? 1 : 0,
      score: result.score,
      maxScore: result.maxScore,
      testsPassed: result.testsPassed,
      testsFailed: result.testsFailed,
      executionMs: result.executionMs,
      memoryKb: result.memoryKb,
      errorType: result.errorType,
      errorMessage: result.errorMessage ?? null,
      hintsUsed: input.hintsUsed,
      attemptNumber,
      timeSpentMs: input.timeSpentMs,
      feedback: toJson(result),
    });

    const submissionId = Number(info.lastInsertRowid);

    const resultStmt = conn.prepare(`
      INSERT INTO submission_results
        (submission_id, test_case_id, stage, visibility, name, passed, expected, actual, message, execution_ms)
      VALUES (@submissionId, @testCaseId, 'test', @visibility, @name, @passed, @expected, @actual, @message, @executionMs)
    `);
    for (const test of result.tests) {
      resultStmt.run({
        submissionId,
        testCaseId: test.testCaseId ?? null,
        visibility: test.visibility,
        name: test.name,
        passed: test.passed ? 1 : 0,
        expected: test.expected ?? null,
        actual: test.actual ?? null,
        message: test.message ?? null,
        executionMs: test.executionMs,
      });
    }

    const stageStmt = conn.prepare(`
      INSERT INTO submission_results (submission_id, stage, visibility, name, passed, message)
      VALUES (?, ?, 'public', ?, ?, ?)
    `);
    for (const stage of result.stages) {
      stageStmt.run(submissionId, stage.stage, stage.title, stage.passed ? 1 : 0, stage.message ?? null);
    }

    if (input.mode === 'submit') {
      updateProgress(input, attemptNumber);
    }

    return { submissionId, attemptNumber };
  });

  return txn();
}

function updateProgress(input: SubmissionRecordInput, _attemptNumber: number): void {
  const conn = db();
  const { result } = input;
  const errorColumn =
    result.errorType === 'syntax' ? 'syntax_errors'
      : result.errorType === 'runtime' || result.errorType === 'timeout' ? 'runtime_errors'
        : result.errorType === 'conceptual' ? 'construct_errors'
          : null;

  conn.prepare(`
    INSERT INTO student_progress (user_id, question_id, attempts, solved, best_score, hints_used, total_time_ms, last_attempt_at, first_solved_at)
    VALUES (@userId, @questionId, 1, @solved, @score, @hintsUsed, @timeSpentMs, datetime('now'), @firstSolvedAt)
    ON CONFLICT(user_id, question_id) DO UPDATE SET
      attempts = attempts + 1,
      solved = MAX(solved, @solved),
      best_score = MAX(best_score, @score),
      hints_used = MAX(hints_used, @hintsUsed),
      total_time_ms = total_time_ms + @timeSpentMs,
      last_attempt_at = datetime('now'),
      first_solved_at = COALESCE(first_solved_at, @firstSolvedAt)
  `).run({
    userId: input.userId,
    questionId: input.questionId,
    solved: result.isCorrect ? 1 : 0,
    score: result.score,
    hintsUsed: input.hintsUsed,
    timeSpentMs: input.timeSpentMs,
    firstSolvedAt: result.isCorrect ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
  });

  if (errorColumn) {
    conn.prepare(`UPDATE student_progress SET ${errorColumn} = ${errorColumn} + 1 WHERE user_id = ? AND question_id = ?`)
      .run(input.userId, input.questionId);
  }
}

export interface SubmissionListItem {
  id: number;
  questionId: number;
  qid: string;
  title: string;
  language: string;
  topic: string;
  difficulty: string;
  verdict: string;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  attemptNumber: number;
  hintsUsed: number;
  executionMs: number;
  createdAt: string;
}

export function listSubmissions(opts: {
  userId?: number; questionId?: number; assessmentId?: number;
  mode?: 'run' | 'submit'; limit?: number; offset?: number;
}): { items: SubmissionListItem[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.userId) { where.push('s.user_id = @userId'); params.userId = opts.userId; }
  if (opts.questionId) { where.push('s.question_id = @questionId'); params.questionId = opts.questionId; }
  if (opts.assessmentId) { where.push('s.assessment_id = @assessmentId'); params.assessmentId = opts.assessmentId; }
  if (opts.mode) { where.push('s.mode = @mode'); params.mode = opts.mode; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 25, 200);
  const offset = opts.offset ?? 0;

  const items = (db().prepare(`
    SELECT s.id, s.question_id, s.verdict, s.is_correct, s.score, s.max_score, s.attempt_number,
           s.hints_used, s.execution_ms, s.created_at,
           q.qid, q.title, q.difficulty, l.slug AS language, t.slug AS topic
    FROM submissions s
    JOIN questions q ON q.id = s.question_id
    JOIN languages l ON l.id = q.language_id
    JOIN topics t ON t.id = q.topic_id
    ${clause}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `).all(params) as any[]).map((r) => ({
    id: r.id,
    questionId: r.question_id,
    qid: r.qid,
    title: r.title,
    language: r.language,
    topic: r.topic,
    difficulty: r.difficulty,
    verdict: r.verdict,
    isCorrect: r.is_correct === 1,
    score: r.score,
    maxScore: r.max_score,
    attemptNumber: r.attempt_number,
    hintsUsed: r.hints_used,
    executionMs: r.execution_ms,
    createdAt: r.created_at,
  }));

  const total = (db().prepare(`SELECT COUNT(*) AS n FROM submissions s ${clause}`).get(params) as { n: number }).n;
  return { items, total };
}

export function findSubmission(id: number): (SubmissionRow & { result: EvaluationResult }) | null {
  const row = db().prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
  if (!row) return null;
  return { ...row, result: parseJson<EvaluationResult>(row.feedback, {} as EvaluationResult) };
}

export function lastSubmissionFor(userId: number, questionId: number): SubmissionRow | null {
  return (db().prepare(
    'SELECT * FROM submissions WHERE user_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1',
  ).get(userId, questionId) as SubmissionRow) ?? null;
}

// ------------------------------------------------------- hints/solution

export function recordHintUsage(userId: number, questionId: number, hintId: number): void {
  db().prepare(
    'INSERT OR IGNORE INTO hint_usage (user_id, question_id, hint_id) VALUES (?, ?, ?)',
  ).run(userId, questionId, hintId);
}

export function countHintsUsed(userId: number, questionId: number): number {
  return (db().prepare(
    'SELECT COUNT(*) AS n FROM hint_usage WHERE user_id = ? AND question_id = ?',
  ).get(userId, questionId) as { n: number }).n;
}

export function recordSolutionReveal(userId: number, questionId: number): void {
  db().prepare(
    'INSERT OR IGNORE INTO solution_reveals (user_id, question_id) VALUES (?, ?)',
  ).run(userId, questionId);
}

export function hasRevealedSolution(userId: number, questionId: number): boolean {
  return db().prepare(
    'SELECT 1 FROM solution_reveals WHERE user_id = ? AND question_id = ?',
  ).get(userId, questionId) !== undefined;
}
