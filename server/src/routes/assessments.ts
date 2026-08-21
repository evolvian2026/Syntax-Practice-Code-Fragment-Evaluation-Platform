import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/index.js';
import { db } from '../db/index.js';
import { attempt, loadQuestion, redactForStudent, toStudentView } from '../services/practice.js';
import { asyncHandler, NotFoundError, parseIntParam, validate } from './helpers.js';

export const assessmentRouter = Router();
assessmentRouter.use(authenticate);

/** §23 — assessment mode: timed sets scored on correctness, hints and time. */

assessmentRouter.get('/', asyncHandler(async (req, res) => {
  const rows = db().prepare(`
    SELECT a.*, l.slug AS language, l.name AS language_name,
           (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.assessment_id = a.id) AS question_count,
           (SELECT COALESCE(SUM(points), 0) FROM assessment_questions aq WHERE aq.assessment_id = a.id) AS total_points,
           (SELECT sa.id FROM student_assessments sa
             WHERE sa.assessment_id = a.id AND sa.user_id = @userId
             ORDER BY sa.id DESC LIMIT 1) AS attempt_id,
           (SELECT sa.status FROM student_assessments sa
             WHERE sa.assessment_id = a.id AND sa.user_id = @userId
             ORDER BY sa.id DESC LIMIT 1) AS attempt_status,
           (SELECT sa.score FROM student_assessments sa
             WHERE sa.assessment_id = a.id AND sa.user_id = @userId AND sa.status = 'submitted'
             ORDER BY sa.score DESC LIMIT 1) AS best_score,
           (SELECT COUNT(*) FROM student_assessments sa
             WHERE sa.assessment_id = a.id AND sa.user_id = @userId AND sa.status = 'submitted') AS attempts_used
    FROM assessments a
    LEFT JOIN languages l ON l.id = a.language_id
    WHERE a.status = 'published'
    ORDER BY a.created_at DESC
  `).all({ userId: req.user!.id }) as any[];

  res.json({
    assessments: rows.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      language: a.language,
      languageName: a.language_name,
      durationMinutes: a.duration_minutes,
      allowHints: a.allow_hints === 1,
      maxAttempts: a.max_attempts,
      questionCount: a.question_count,
      totalPoints: a.total_points,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      myAttemptId: a.attempt_id,
      myAttemptStatus: a.attempt_status,
      myBestScore: a.best_score,
      attemptsUsed: a.attempts_used,
    })),
  });
}));

assessmentRouter.post('/:id/start', asyncHandler(async (req, res) => {
  const conn = db();
  const assessmentId = parseIntParam(req.params.id, 0);
  const assessment = conn.prepare(`SELECT * FROM assessments WHERE id = ? AND status = 'published'`)
    .get(assessmentId) as any;
  if (!assessment) throw new NotFoundError('Assessment');

  const now = new Date().toISOString();
  if (assessment.starts_at && now < assessment.starts_at) {
    res.status(400).json({ error: 'This assessment has not opened yet.' });
    return;
  }
  if (assessment.ends_at && now > assessment.ends_at) {
    res.status(400).json({ error: 'This assessment has closed.' });
    return;
  }

  const inProgress = conn.prepare(
    `SELECT * FROM student_assessments WHERE assessment_id = ? AND user_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`,
  ).get(assessmentId, req.user!.id) as any;

  let attemptRow = inProgress;
  if (!attemptRow) {
    const used = (conn.prepare(
      `SELECT COUNT(*) AS n FROM student_assessments WHERE assessment_id = ? AND user_id = ? AND status = 'submitted'`,
    ).get(assessmentId, req.user!.id) as { n: number }).n;
    if (used >= assessment.max_attempts) {
      res.status(400).json({ error: `You have used all ${assessment.max_attempts} attempt(s) for this assessment.` });
      return;
    }
    const maxScore = (conn.prepare(
      'SELECT COALESCE(SUM(points), 0) AS n FROM assessment_questions WHERE assessment_id = ?',
    ).get(assessmentId) as { n: number }).n;
    const info = conn.prepare(
      'INSERT INTO student_assessments (assessment_id, user_id, max_score) VALUES (?, ?, ?)',
    ).run(assessmentId, req.user!.id, maxScore);
    attemptRow = conn.prepare('SELECT * FROM student_assessments WHERE id = ?').get(Number(info.lastInsertRowid));
  }

  res.json({ attempt: serializeAttempt(attemptRow, assessment), questions: assessmentQuestions(assessmentId, req.user!.id, assessment.shuffle === 1) });
}));

assessmentRouter.get('/attempts/:attemptId', asyncHandler(async (req, res) => {
  const conn = db();
  const attemptRow = conn.prepare('SELECT * FROM student_assessments WHERE id = ?')
    .get(parseIntParam(req.params.attemptId, 0)) as any;
  if (!attemptRow || attemptRow.user_id !== req.user!.id) throw new NotFoundError('Attempt');
  const assessment = conn.prepare('SELECT * FROM assessments WHERE id = ?').get(attemptRow.assessment_id) as any;

  const answers = conn.prepare(
    'SELECT question_id, score, points, is_correct, attempts, hints_used FROM student_assessment_answers WHERE student_assessment_id = ?',
  ).all(attemptRow.id) as any[];

  res.json({
    attempt: serializeAttempt(attemptRow, assessment),
    questions: assessmentQuestions(attemptRow.assessment_id, req.user!.id, assessment.shuffle === 1),
    answers: answers.map((a) => ({
      questionId: a.question_id,
      score: a.score,
      points: a.points,
      isCorrect: a.is_correct === 1,
      attempts: a.attempts,
      hintsUsed: a.hints_used,
    })),
  });
}));

const answerSchema = z.object({
  questionId: z.number().int().positive(),
  code: z.string().max(20000),
  timeSpentMs: z.number().int().min(0).optional(),
});

assessmentRouter.post('/attempts/:attemptId/answer', asyncHandler(async (req, res) => {
  const conn = db();
  const input = validate(answerSchema, req.body);
  const attemptRow = conn.prepare('SELECT * FROM student_assessments WHERE id = ?')
    .get(parseIntParam(req.params.attemptId, 0)) as any;
  if (!attemptRow || attemptRow.user_id !== req.user!.id) throw new NotFoundError('Attempt');
  if (attemptRow.status !== 'in_progress') {
    res.status(400).json({ error: 'This attempt has already been submitted.' });
    return;
  }

  const assessment = conn.prepare('SELECT * FROM assessments WHERE id = ?').get(attemptRow.assessment_id) as any;
  if (isExpired(attemptRow, assessment)) {
    expireAttempt(attemptRow.id);
    res.status(400).json({ error: 'Time is up — this attempt has been closed.' });
    return;
  }

  const link = conn.prepare(
    'SELECT * FROM assessment_questions WHERE assessment_id = ? AND question_id = ?',
  ).get(attemptRow.assessment_id, input.questionId) as any;
  if (!link) throw new NotFoundError('Question in this assessment');

  const full = loadQuestion(input.questionId);
  if (!full) throw new NotFoundError('Question');

  const outcome = await attempt({
    userId: req.user!.id,
    question: full,
    fragment: input.code,
    mode: 'submit',
    timeSpentMs: input.timeSpentMs ?? 0,
    assessmentId: attemptRow.assessment_id,
  });

  // §23 — score scales the question's points by the achieved ratio.
  const ratio = outcome.result.maxScore > 0 ? outcome.result.score / outcome.result.maxScore : 0;
  const earned = Math.round(link.points * ratio * 100) / 100;

  conn.prepare(`
    INSERT INTO student_assessment_answers
      (student_assessment_id, question_id, submission_id, score, points, is_correct, attempts, hints_used, time_spent_ms)
    VALUES (@attemptId, @questionId, @submissionId, @score, @points, @isCorrect, 1, @hintsUsed, @timeSpentMs)
    ON CONFLICT(student_assessment_id, question_id) DO UPDATE SET
      submission_id = excluded.submission_id,
      score = MAX(score, excluded.score),
      is_correct = MAX(is_correct, excluded.is_correct),
      attempts = attempts + 1,
      hints_used = excluded.hints_used,
      time_spent_ms = time_spent_ms + excluded.time_spent_ms
  `).run({
    attemptId: attemptRow.id,
    questionId: input.questionId,
    submissionId: outcome.submissionId,
    score: earned,
    points: link.points,
    isCorrect: outcome.result.isCorrect ? 1 : 0,
    hintsUsed: 0,
    timeSpentMs: input.timeSpentMs ?? 0,
  });

  recomputeAttemptScore(attemptRow.id);

  res.json({
    // During an assessment, feedback stays minimal: verdict yes/no, no expected output.
    result: {
      verdict: outcome.result.verdict,
      isCorrect: outcome.result.isCorrect,
      feedback: outcome.result.feedback,
      errorType: outcome.result.errorType,
      errorMessage: outcome.result.errorMessage,
      testsPassed: outcome.result.testsPassed,
      testsFailed: outcome.result.testsFailed,
      stdout: outcome.result.stdout,
    },
    earned,
    points: link.points,
  });
}));

assessmentRouter.post('/attempts/:attemptId/submit', asyncHandler(async (req, res) => {
  const conn = db();
  const attemptRow = conn.prepare('SELECT * FROM student_assessments WHERE id = ?')
    .get(parseIntParam(req.params.attemptId, 0)) as any;
  if (!attemptRow || attemptRow.user_id !== req.user!.id) throw new NotFoundError('Attempt');
  if (attemptRow.status === 'submitted') {
    res.json({ attempt: serializeAttempt(attemptRow, null), alreadySubmitted: true });
    return;
  }

  recomputeAttemptScore(attemptRow.id);
  conn.prepare(
    `UPDATE student_assessments SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?`,
  ).run(attemptRow.id);

  const updated = conn.prepare('SELECT * FROM student_assessments WHERE id = ?').get(attemptRow.id) as any;
  res.json({ attempt: serializeAttempt(updated, null), result: attemptReport(attemptRow.id) });
}));

assessmentRouter.get('/attempts/:attemptId/report', asyncHandler(async (req, res) => {
  const attemptRow = db().prepare('SELECT * FROM student_assessments WHERE id = ?')
    .get(parseIntParam(req.params.attemptId, 0)) as any;
  if (!attemptRow) throw new NotFoundError('Attempt');
  if (attemptRow.user_id !== req.user!.id && req.user!.role === 'student') {
    res.status(403).json({ error: 'You can only view your own results.' });
    return;
  }
  res.json({ attempt: serializeAttempt(attemptRow, null), report: attemptReport(attemptRow.id) });
}));

// ------------------------------------------------------------- helpers

function assessmentQuestions(assessmentId: number, userId: number, shuffle: boolean) {
  const rows = db().prepare(`
    SELECT aq.question_id, aq.points, aq.display_order
    FROM assessment_questions aq WHERE aq.assessment_id = ?
    ORDER BY aq.display_order, aq.id
  `).all(assessmentId) as any[];

  const ordered = shuffle ? [...rows].sort(() => Math.random() - 0.5) : rows;
  return ordered.map((r) => {
    const full = loadQuestion(r.question_id);
    if (!full) return null;
    const view = toStudentView(full, userId);
    return { ...view, points: r.points, hintCount: 0, hintsUsed: 0 };
  }).filter(Boolean);
}

function serializeAttempt(row: any, assessment: any) {
  if (!row) return null;
  const durationMinutes = assessment?.duration_minutes;
  const endsAt = durationMinutes
    ? new Date(new Date(`${row.started_at}Z`).getTime() + durationMinutes * 60_000).toISOString()
    : null;
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    status: row.status,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    score: row.score,
    maxScore: row.max_score,
    correctCount: row.correct_count,
    durationMinutes: durationMinutes ?? null,
    endsAt,
  };
}

function isExpired(attemptRow: any, assessment: any): boolean {
  if (!assessment?.duration_minutes) return false;
  const started = new Date(`${attemptRow.started_at}Z`).getTime();
  return Date.now() > started + assessment.duration_minutes * 60_000;
}

function expireAttempt(attemptId: number): void {
  db().prepare(
    `UPDATE student_assessments SET status = 'expired', submitted_at = datetime('now') WHERE id = ?`,
  ).run(attemptId);
}

function recomputeAttemptScore(attemptId: number): void {
  const conn = db();
  const totals = conn.prepare(`
    SELECT COALESCE(SUM(score), 0) AS score,
           COALESCE(SUM(is_correct), 0) AS correct,
           COALESCE(SUM(hints_used), 0) AS hints,
           COALESCE(SUM(time_spent_ms), 0) AS time_spent
    FROM student_assessment_answers WHERE student_assessment_id = ?
  `).get(attemptId) as any;
  conn.prepare(
    'UPDATE student_assessments SET score = ?, correct_count = ?, hints_used = ?, time_spent_ms = ? WHERE id = ?',
  ).run(totals.score, totals.correct, totals.hints, totals.time_spent, attemptId);
}

function attemptReport(attemptId: number) {
  return db().prepare(`
    SELECT a.question_id AS questionId, q.qid, q.title, q.difficulty, t.name AS topic,
           a.score, a.points, a.is_correct AS isCorrect, a.attempts, a.hints_used AS hintsUsed,
           a.time_spent_ms AS timeSpentMs, s.verdict, s.fragment_code AS fragment
    FROM student_assessment_answers a
    JOIN questions q ON q.id = a.question_id
    JOIN topics t ON t.id = q.topic_id
    LEFT JOIN submissions s ON s.id = a.submission_id
    WHERE a.student_assessment_id = ?
    ORDER BY q.qid
  `).all(attemptId) as any[];
}
