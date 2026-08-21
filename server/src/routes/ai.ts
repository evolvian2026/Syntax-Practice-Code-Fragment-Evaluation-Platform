import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth/index.js';
import { dashboardFor } from '../db/repositories/progress.js';
import { findQuestionById, toEvaluable } from '../db/repositories/questions.js';
import { findSubmission } from '../db/repositories/submissions.js';
import {
  aiAvailable, explainError, generateQuestion, progressiveHint, recommendPractice,
} from '../services/ai.js';
import { asyncHandler, NotFoundError, parseIntParam, validate } from './helpers.js';

export const aiRouter = Router();
aiRouter.use(authenticate);

aiRouter.get('/status', asyncHandler(async (_req, res) => {
  res.json({
    available: aiAvailable(),
    note: aiAvailable()
      ? 'AI tutoring is enabled. Hints are progressive and never reveal the answer.'
      : 'AI features are disabled (no ANTHROPIC_API_KEY configured). Built-in hints are still available.',
  });
}));

/** §25 — progressive tutoring: level 1-3, never the answer. */
aiRouter.post('/tutor', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      questionId: z.number().int().positive(),
      code: z.string().max(20000).default(''),
      level: z.number().int().min(1).max(3).default(1),
      submissionId: z.number().int().positive().optional(),
    }),
    req.body,
  );

  const full = findQuestionById(input.questionId);
  if (!full) throw new NotFoundError('Question');

  const lastResult = input.submissionId ? findSubmission(input.submissionId)?.result ?? null : null;
  const { hint, source } = await progressiveHint({
    question: toEvaluable(full),
    fragment: input.code,
    level: input.level as 1 | 2 | 3,
    lastResult,
  });

  res.json({ hint, level: input.level, source });
}));

aiRouter.post('/explain-error', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({ questionId: z.number().int().positive(), submissionId: z.number().int().positive() }),
    req.body,
  );

  const full = findQuestionById(input.questionId);
  if (!full) throw new NotFoundError('Question');
  const submission = findSubmission(input.submissionId);
  if (!submission) throw new NotFoundError('Submission');
  if (submission.user_id !== req.user!.id && req.user!.role === 'student') {
    res.status(403).json({ error: 'You can only ask about your own submissions.' });
    return;
  }

  const { explanation, source } = await explainError(
    toEvaluable(full),
    submission.fragment_code,
    submission.result,
  );
  res.json({ explanation, source });
}));

aiRouter.get('/recommendations', asyncHandler(async (req, res) => {
  const summary = dashboardFor(req.user!.id);
  const recommendations = await recommendPractice(
    summary.weakTopics.map((t) => ({ label: t.label, accuracy: t.accuracy, attempted: t.attempted })),
  );
  res.json({ recommendations });
}));

/** §25 — admin-only question generation / variation. */
aiRouter.post('/generate-question', requireAdmin, asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      language: z.string(),
      topic: z.string(),
      subtopic: z.string().optional(),
      difficulty: z.enum(['Easy', 'Medium', 'Hard']).default('Easy'),
      constructHint: z.string().optional(),
      variationOfQuestionId: z.number().int().positive().optional(),
    }),
    req.body,
  );

  if (!aiAvailable()) {
    res.status(503).json({ error: 'AI generation needs ANTHROPIC_API_KEY to be configured on the server.' });
    return;
  }

  let variationOf;
  if (input.variationOfQuestionId) {
    const source = findQuestionById(input.variationOfQuestionId);
    if (!source) throw new NotFoundError('Source question');
    variationOf = { statement: source.question.statement, starterCode: source.question.starter_code };
  }

  const generated = await generateQuestion({ ...input, variationOf });
  if (!generated) {
    res.status(502).json({ error: 'The generator did not return a usable question. Try again or adjust the topic.' });
    return;
  }

  // Returned as a draft for the admin to review in the builder — never auto-published.
  res.json({
    draft: {
      language: input.language,
      topic: input.topic,
      subtopic: input.subtopic ?? null,
      difficulty: generated.difficulty ?? input.difficulty,
      questionType: 'FILL_CODE',
      evaluationType: 'OUTPUT',
      title: generated.title,
      statement: generated.statement,
      starterCode: generated.starterCode,
      explanation: generated.explanation,
      requiredConstructs: generated.requiredConstructs ?? [],
      hints: (generated.hints ?? []).map((body) => ({ body, penalty: 15 })),
      solutions: [{ code: generated.solution, isPrimary: true }],
      testCases: (generated.testCases ?? []).map((t) => ({
        visibility: t.visibility,
        expectedOutput: t.expectedOutput,
        matcher: 'trimmed' as const,
        weight: 1,
      })),
      status: 'draft',
    },
    warning: 'Review and run "Test question" before publishing — generated questions are unverified.',
  });
}));
