import { Router } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth } from '../auth/index.js';
import { db } from '../db/index.js';
import { buildCatalog, describeDataset, listDatasets, listLanguages, listTopics } from '../db/repositories/catalog.js';
import { listQuestions } from '../db/repositories/questions.js';
import { progressMap } from '../db/repositories/progress.js';
import {
  findSubmission, listSubmissions, recordHintUsage, recordSolutionReveal,
} from '../db/repositories/submissions.js';
import { CONSTRUCT_GROUPS } from '../evaluation/constructs.js';
import { listAdapters } from '../evaluation/languages/registry.js';
import { attempt, loadQuestion, redactForStudent, toStudentView } from '../services/practice.js';
import { todaysChallenge } from '../services/gamification.js';
import { asyncHandler, idOrQid, NotFoundError, parseIntParam, validate } from './helpers.js';

export const practiceRouter = Router();

// ------------------------------------------------------------- catalog

practiceRouter.get('/catalog', asyncHandler(async (_req, res) => {
  res.json({ languages: buildCatalog() });
}));

practiceRouter.get('/languages', asyncHandler(async (_req, res) => {
  const adapters = new Map(listAdapters().map((a) => [a.slug, a]));
  res.json({
    languages: listLanguages().map((l) => ({
      slug: l.slug,
      name: l.name,
      runtime: l.runtime,
      monacoId: l.monaco_id,
      icon: l.icon,
      accent: l.accent,
      description: l.description,
      executable: adapters.get(l.slug)?.executable ?? false,
    })),
  });
}));

practiceRouter.get('/topics', asyncHandler(async (req, res) => {
  const language = typeof req.query.language === 'string' ? req.query.language : undefined;
  res.json({ topics: listTopics(language) });
}));

practiceRouter.get('/constructs', asyncHandler(async (_req, res) => {
  res.json({ groups: CONSTRUCT_GROUPS });
}));

practiceRouter.get('/datasets', asyncHandler(async (_req, res) => {
  res.json({
    datasets: listDatasets().map((d) => ({
      slug: d.slug, name: d.name, dialect: d.dialect, description: d.description,
    })),
  });
}));

practiceRouter.get('/datasets/:slug', asyncHandler(async (req, res) => {
  const described = describeDataset(req.params.slug);
  if (!described) throw new NotFoundError('Dataset');
  res.json({ dataset: described });
}));

// ------------------------------------------------------------ questions

practiceRouter.get('/questions', optionalAuth, asyncHandler(async (req, res) => {
  const { items, total } = listQuestions({
    language: str(req.query.language),
    topic: str(req.query.topic),
    subtopic: str(req.query.subtopic),
    difficulty: str(req.query.difficulty),
    questionType: str(req.query.questionType),
    tag: str(req.query.tag),
    search: str(req.query.search),
    status: 'published',
    limit: parseIntParam(req.query.limit, 50),
    offset: parseIntParam(req.query.offset, 0),
    sort: (str(req.query.sort) as any) ?? 'qid',
  });

  const progress = req.user ? progressMap(req.user.id) : new Map();
  res.json({
    total,
    questions: items.map((q) => ({
      ...q,
      solved: progress.get(q.id)?.solved ?? false,
      attempts: progress.get(q.id)?.attempts ?? 0,
      bestScore: progress.get(q.id)?.bestScore ?? 0,
    })),
  });
}));

practiceRouter.get('/questions/:id', optionalAuth, asyncHandler(async (req, res) => {
  const full = loadQuestion(idOrQid(req.params.id));
  if (!full || full.question.status !== 'published') throw new NotFoundError('Question');
  res.json({ question: toStudentView(full, req.user?.id) });
}));

/** Next unsolved question in the same topic — powers the "Next" button. */
practiceRouter.get('/questions/:id/next', authenticate, asyncHandler(async (req, res) => {
  const full = loadQuestion(idOrQid(req.params.id));
  if (!full) throw new NotFoundError('Question');

  const next = db().prepare(`
    SELECT q.id, q.qid FROM questions q
    LEFT JOIN student_progress sp ON sp.question_id = q.id AND sp.user_id = @userId
    WHERE q.topic_id = @topicId AND q.status = 'published' AND q.id != @currentId
      AND COALESCE(sp.solved, 0) = 0
    ORDER BY CASE q.difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, q.qid
    LIMIT 1
  `).get({ userId: req.user!.id, topicId: full.question.topic_id, currentId: full.question.id }) as any;

  res.json({ next: next ? { id: next.id, qid: next.qid } : null });
}));

// ---------------------------------------------------------- run/submit

const attemptSchema = z.object({
  code: z.string().max(20000),
  timeSpentMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  selectedOption: z.string().nullable().optional(),
  assessmentId: z.number().int().positive().nullable().optional(),
});

function handleAttempt(mode: 'run' | 'submit') {
  return asyncHandler(async (req, res) => {
    const input = validate(attemptSchema, req.body);
    const full = loadQuestion(idOrQid(req.params.id));
    if (!full || full.question.status === 'archived') throw new NotFoundError('Question');

    const outcome = await attempt({
      userId: req.user!.id,
      question: full,
      fragment: input.code,
      mode,
      timeSpentMs: input.timeSpentMs ?? 0,
      assessmentId: input.assessmentId ?? null,
      selectedOption: input.selectedOption ?? null,
    });

    res.json({
      result: redactForStudent(outcome.result, { showGeneratedCode: true }),
      submissionId: outcome.submissionId,
      attemptNumber: outcome.attemptNumber,
      award: outcome.award,
      explanation: outcome.explanation,
      solutions: outcome.solutions,
    });
  });
}

practiceRouter.post('/questions/:id/run', authenticate, handleAttempt('run'));
practiceRouter.post('/questions/:id/submit', authenticate, handleAttempt('submit'));

// --------------------------------------------------------------- hints

practiceRouter.post('/questions/:id/hint', authenticate, asyncHandler(async (req, res) => {
  const full = loadQuestion(idOrQid(req.params.id));
  if (!full) throw new NotFoundError('Question');

  const index = parseIntParam(req.body?.index, 0);
  const hint = full.hints[index];
  if (!hint) {
    res.status(404).json({ error: 'No further hints are available for this question.' });
    return;
  }

  recordHintUsage(req.user!.id, full.question.id, hint.id);
  res.json({
    hint: { index, body: hint.body, penalty: hint.penalty },
    remaining: Math.max(0, full.hints.length - index - 1),
    totalHints: full.hints.length,
  });
}));

/** Hints the student has already unlocked, restored on page reload. */
practiceRouter.get('/questions/:id/hints', authenticate, asyncHandler(async (req, res) => {
  const full = loadQuestion(idOrQid(req.params.id));
  if (!full) throw new NotFoundError('Question');

  const used = new Set(
    (db().prepare('SELECT hint_id FROM hint_usage WHERE user_id = ? AND question_id = ?')
      .all(req.user!.id, full.question.id) as { hint_id: number }[]).map((r) => r.hint_id),
  );

  res.json({
    totalHints: full.hints.length,
    hints: full.hints
      .map((h, index) => ({ index, body: used.has(h.id) ? h.body : null, penalty: h.penalty, unlocked: used.has(h.id) })),
  });
}));

practiceRouter.post('/questions/:id/solution', authenticate, asyncHandler(async (req, res) => {
  const full = loadQuestion(idOrQid(req.params.id));
  if (!full) throw new NotFoundError('Question');

  recordSolutionReveal(req.user!.id, full.question.id);
  res.json({
    solutions: full.solutions.map((s) => ({ code: s.code, note: s.note, isPrimary: s.is_primary === 1 })),
    explanation: full.question.explanation,
    warning: 'Revealing the solution scores this question 0, but you can still practise it.',
  });
}));

// --------------------------------------------------------- submissions

practiceRouter.get('/submissions', authenticate, asyncHandler(async (req, res) => {
  const { items, total } = listSubmissions({
    userId: req.user!.id,
    questionId: req.query.questionId ? parseIntParam(req.query.questionId, 0) : undefined,
    mode: 'submit',
    limit: parseIntParam(req.query.limit, 25),
    offset: parseIntParam(req.query.offset, 0),
  });
  res.json({ total, submissions: items });
}));

practiceRouter.get('/submissions/:id', authenticate, asyncHandler(async (req, res) => {
  const submission = findSubmission(parseIntParam(req.params.id, 0));
  if (!submission) throw new NotFoundError('Submission');
  if (submission.user_id !== req.user!.id && req.user!.role === 'student') {
    res.status(403).json({ error: 'You can only view your own submissions.' });
    return;
  }
  res.json({
    submission: {
      id: submission.id,
      questionId: submission.question_id,
      mode: submission.mode,
      fragment: submission.fragment_code,
      generatedCode: submission.generated_code,
      verdict: submission.verdict,
      score: submission.score,
      maxScore: submission.max_score,
      createdAt: submission.created_at,
      result: redactForStudent(submission.result, { showGeneratedCode: true }),
    },
  });
}));

// ---------------------------------------------------- daily challenge

practiceRouter.get('/daily-challenge', optionalAuth, asyncHandler(async (_req, res) => {
  const challenge = todaysChallenge();
  if (!challenge) {
    res.json({ challenge: null });
    return;
  }
  const full = loadQuestion(challenge.questionId);
  res.json({
    challenge: full
      ? {
        day: challenge.day,
        xpBonus: challenge.xpBonus,
        question: {
          id: full.question.id,
          qid: full.question.qid,
          title: full.question.title,
          statement: full.question.statement,
          difficulty: full.question.difficulty,
          language: full.languageSlug,
          topic: full.topicName,
        },
      }
      : null,
  });
}));

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
