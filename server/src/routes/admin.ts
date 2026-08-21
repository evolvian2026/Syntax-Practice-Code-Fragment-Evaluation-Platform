import { Router } from 'express';
import { z } from 'zod';
import { createUser, DuplicateEmailError, requireAdmin } from '../auth/index.js';
import { authenticate } from '../auth/index.js';
import { db } from '../db/index.js';
import {
  commonErrors, leaderboard, platformOverview, questionStats,
  studentSummaries, topicAccuracy,
} from '../db/repositories/progress.js';
import {
  CatalogReferenceError, createQuestion, deleteQuestion, duplicateQuestion,
  findQuestionById, listQuestions, toQuestionInput, updateQuestion, upsertQuestion,
  type QuestionInput,
} from '../db/repositories/questions.js';
import { listSubmissions } from '../db/repositories/submissions.js';
import { STUDENT_MARKER } from '../evaluation/assembler.js';
import { evaluate } from '../evaluation/engine.js';
import { resolveIds, toEvaluable } from '../db/repositories/questions.js';
import { hasAdapter } from '../evaluation/languages/registry.js';
import { toStudentView } from '../services/practice.js';
import { asyncHandler, NotFoundError, parseIntParam, validate, ValidationError } from './helpers.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

// -------------------------------------------------------- question CRUD

const testCaseSchema = z.object({
  visibility: z.enum(['public', 'hidden']).default('public'),
  name: z.string().nullish(),
  setupCode: z.string().nullish(),
  stdin: z.string().nullish(),
  expectedOutput: z.string().nullish(),
  expectedValue: z.string().nullish(),
  matcher: z.enum(['exact', 'trimmed', 'normalized', 'contains', 'regex', 'unordered_rows', 'rows']).default('trimmed'),
  weight: z.number().positive().default(1),
});

const questionSchema = z.object({
  qid: z.string().trim().min(3).optional(),
  language: z.string().min(1),
  topic: z.string().min(1),
  subtopic: z.string().nullish(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  questionType: z.enum([
    'FILL_CODE', 'COMPLETE_STATEMENT', 'COMPLETE_CONDITION', 'COMPLETE_LOOP',
    'COMPLETE_SQL_CLAUSE', 'CHOOSE_AND_WRITE', 'FIX_SYNTAX', 'PREDICT_OUTPUT', 'IDENTIFY_SYNTAX',
  ]),
  evaluationType: z.enum(['OUTPUT', 'SYNTAX', 'AST', 'SQL_RESULT', 'VALUE', 'STATIC', 'TEXT', 'COMPOSITE']),
  title: z.string().min(3),
  statement: z.string().min(3),
  instructions: z.string().nullish(),
  learningObjective: z.string().nullish(),
  starterCode: z.string(),
  hiddenPrefix: z.string().nullish(),
  hiddenSuffix: z.string().nullish(),
  editablePrefill: z.string().nullish(),
  editablePlaceholder: z.string().nullish(),
  indentFragment: z.boolean().default(true),
  dataset: z.string().nullish(),
  requiredConstructs: z.array(z.string()).default([]),
  forbiddenConstructs: z.array(z.string()).default([]),
  requiredKeywords: z.array(z.string()).default([]),
  forbiddenKeywords: z.array(z.string()).default([]),
  options: z.array(z.string()).default([]),
  config: z.record(z.unknown()).default({}),
  maxCodeLength: z.number().int().positive().max(20000).default(2000),
  timeLimitMs: z.number().int().positive().max(15000).default(4000),
  memoryLimitMb: z.number().int().positive().max(512).default(128),
  maxScore: z.number().int().positive().max(1000).default(100),
  explanation: z.string().nullish(),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
  tags: z.array(z.string()).default([]),
  testCases: z.array(testCaseSchema).default([]),
  hints: z.array(z.object({ body: z.string().min(1), penalty: z.number().int().min(0).max(100).default(15) })).default([]),
  solutions: z.array(z.object({ code: z.string().min(1), isPrimary: z.boolean().optional(), note: z.string().nullish() })).default([]),
});

/** Authoring rules that the schema alone cannot express. */
function assertAuthorable(input: QuestionInput): void {
  const issues: Array<{ path: string; message: string }> = [];

  if (!input.starterCode.includes(STUDENT_MARKER)) {
    issues.push({ path: 'starterCode', message: `Starter code must contain the ${STUDENT_MARKER} marker.` });
  }
  if (!hasAdapter(input.language)) {
    issues.push({ path: 'language', message: `No evaluation adapter is registered for "${input.language}".` });
  }
  const needsTests = ['OUTPUT', 'SQL_RESULT', 'VALUE', 'COMPOSITE'].includes(input.evaluationType);
  if (needsTests && (input.testCases ?? []).length === 0) {
    issues.push({ path: 'testCases', message: `${input.evaluationType} questions need at least one test case.` });
  }
  const needsSolution = ['SYNTAX'].includes(input.evaluationType);
  if (needsSolution && (input.solutions ?? []).length === 0 && !(input.config?.acceptRegex as string[] | undefined)?.length) {
    issues.push({ path: 'solutions', message: 'SYNTAX questions need at least one accepted solution or an acceptRegex.' });
  }
  if (input.evaluationType === 'SQL_RESULT' && !input.dataset) {
    issues.push({ path: 'dataset', message: 'SQL questions must reference a sandbox dataset.' });
  }
  if (input.evaluationType === 'AST' && (input.requiredConstructs ?? []).length === 0) {
    issues.push({ path: 'requiredConstructs', message: 'AST questions need at least one required construct.' });
  }
  if (issues.length > 0) throw new ValidationError(issues);
}

adminRouter.get('/questions', asyncHandler(async (req, res) => {
  const result = listQuestions({
    language: str(req.query.language),
    topic: str(req.query.topic),
    subtopic: str(req.query.subtopic),
    difficulty: str(req.query.difficulty),
    questionType: str(req.query.questionType),
    evaluationType: str(req.query.evaluationType),
    status: str(req.query.status),
    tag: str(req.query.tag),
    search: str(req.query.search),
    limit: parseIntParam(req.query.limit, 50),
    offset: parseIntParam(req.query.offset, 0),
    sort: (str(req.query.sort) as any) ?? 'newest',
  });
  res.json(result);
}));

adminRouter.get('/questions/:id', asyncHandler(async (req, res) => {
  const full = findQuestionById(parseIntParam(req.params.id, 0));
  if (!full) throw new NotFoundError('Question');
  res.json({ question: toQuestionInput(full), id: full.question.id, preview: toStudentView(full) });
}));

adminRouter.post('/questions', asyncHandler(async (req, res) => {
  const input = validate(questionSchema, req.body) as QuestionInput;
  assertAuthorable(input);
  try {
    const created = createQuestion(input, req.user!.id);
    res.status(201).json({ id: created.question.id, qid: created.question.qid, question: toQuestionInput(created) });
  } catch (err) {
    if (err instanceof CatalogReferenceError) {
      throw new ValidationError([{ path: 'topic', message: err.message }]);
    }
    throw err;
  }
}));

adminRouter.put('/questions/:id', asyncHandler(async (req, res) => {
  const input = validate(questionSchema, req.body) as QuestionInput;
  assertAuthorable(input);
  try {
    const updated = updateQuestion(parseIntParam(req.params.id, 0), input);
    if (!updated) throw new NotFoundError('Question');
    res.json({ id: updated.question.id, qid: updated.question.qid, question: toQuestionInput(updated) });
  } catch (err) {
    if (err instanceof CatalogReferenceError) {
      throw new ValidationError([{ path: 'topic', message: err.message }]);
    }
    throw err;
  }
}));

adminRouter.delete('/questions/:id', asyncHandler(async (req, res) => {
  const ok = deleteQuestion(parseIntParam(req.params.id, 0));
  if (!ok) throw new NotFoundError('Question');
  res.json({ ok: true });
}));

adminRouter.post('/questions/:id/duplicate', asyncHandler(async (req, res) => {
  const copy = duplicateQuestion(parseIntParam(req.params.id, 0), req.user!.id);
  if (!copy) throw new NotFoundError('Question');
  res.status(201).json({ id: copy.question.id, qid: copy.question.qid });
}));

/** §20 — "preview exactly as the student will see it" without saving. */
adminRouter.post('/questions/preview', asyncHandler(async (req, res) => {
  const input = validate(questionSchema, req.body) as QuestionInput;
  const marker = input.starterCode.includes(STUDENT_MARKER);
  const { splitTemplate } = await import('../evaluation/assembler.js');
  let contextBefore = input.starterCode;
  let contextAfter = '';
  if (marker) {
    const split = splitTemplate(input.starterCode);
    contextBefore = split.prefix.replace(/[ \t]+$/, '');
    contextAfter = split.suffix.replace(/^\n/, '');
  }
  res.json({
    valid: marker,
    marker,
    preview: {
      title: input.title,
      statement: input.statement,
      instructions: input.instructions ?? null,
      difficulty: input.difficulty,
      language: input.language,
      questionType: input.questionType,
      evaluationType: input.evaluationType,
      contextBefore,
      contextAfter,
      editablePrefill: input.editablePrefill ?? '',
      editablePlaceholder: input.editablePlaceholder ?? null,
      options: input.options ?? [],
      publicTests: (input.testCases ?? []).filter((t) => t.visibility === 'public'),
      hiddenTestCount: (input.testCases ?? []).filter((t) => t.visibility === 'hidden').length,
      hintCount: (input.hints ?? []).length,
      requiredConstructs: input.requiredConstructs ?? [],
    },
  });
}));

/**
 * Runs a candidate answer against a question definition without saving it —
 * the builder's "test my question" button. Also used to verify the reference
 * solution actually passes.
 */
adminRouter.post('/questions/dry-run', asyncHandler(async (req, res) => {
  const body = validate(
    z.object({ question: questionSchema, code: z.string(), mode: z.enum(['run', 'submit']).default('submit') }),
    req.body,
  );
  const input = body.question as QuestionInput;
  assertAuthorable(input);

  const conn = db();
  const language = conn.prepare('SELECT slug, runtime FROM languages WHERE slug = ?').get(input.language) as any;
  if (!language) throw new ValidationError([{ path: 'language', message: `Unknown language "${input.language}".` }]);

  let dataset = null;
  if (input.dataset) {
    const d = conn.prepare('SELECT * FROM sql_datasets WHERE slug = ?').get(input.dataset) as any;
    if (!d) throw new ValidationError([{ path: 'dataset', message: `Unknown dataset "${input.dataset}".` }]);
    dataset = { id: d.id, slug: d.slug, name: d.name, dialect: d.dialect, schemaSql: d.schema_sql, seedSql: d.seed_sql };
  }

  const result = await evaluate({
    question: {
      id: 0,
      qid: input.qid ?? 'DRAFT',
      languageSlug: input.language,
      runtime: language.runtime,
      difficulty: input.difficulty as any,
      questionType: input.questionType as any,
      evaluationType: input.evaluationType as any,
      title: input.title,
      statement: input.statement,
      starterCode: input.starterCode,
      hiddenPrefix: input.hiddenPrefix ?? null,
      hiddenSuffix: input.hiddenSuffix ?? null,
      indentFragment: input.indentFragment !== false,
      requiredConstructs: input.requiredConstructs ?? [],
      forbiddenConstructs: input.forbiddenConstructs ?? [],
      requiredKeywords: input.requiredKeywords ?? [],
      forbiddenKeywords: input.forbiddenKeywords ?? [],
      maxCodeLength: input.maxCodeLength ?? 2000,
      timeLimitMs: input.timeLimitMs ?? 4000,
      memoryLimitMb: input.memoryLimitMb ?? 128,
      maxScore: input.maxScore ?? 100,
      testCases: (input.testCases ?? []).map((t, i) => ({
        visibility: t.visibility,
        name: t.name ?? null,
        setupCode: t.setupCode ?? null,
        stdin: t.stdin ?? null,
        expectedOutput: t.expectedOutput ?? null,
        expectedValue: t.expectedValue ?? null,
        matcher: t.matcher ?? 'trimmed',
        weight: t.weight ?? 1,
        displayOrder: i,
      })),
      acceptedSolutions: (input.solutions ?? []).map((s) => s.code),
      config: (input.config ?? {}) as any,
      dataset,
      explanation: input.explanation ?? null,
    },
    fragment: body.code,
    mode: body.mode,
  });

  res.json({ result });
}));

/** Verifies the stored reference solution still passes — catches rotten questions. */
adminRouter.post('/questions/:id/verify', asyncHandler(async (req, res) => {
  const full = findQuestionById(parseIntParam(req.params.id, 0));
  if (!full) throw new NotFoundError('Question');
  const primary = full.solutions.find((s) => s.is_primary === 1) ?? full.solutions[0];
  if (!primary) {
    res.json({ ok: false, message: 'This question has no reference solution to verify.' });
    return;
  }
  const result = await evaluate({ question: toEvaluable(full), fragment: primary.code, mode: 'submit' });
  res.json({
    ok: result.isCorrect,
    verdict: result.verdict,
    message: result.isCorrect
      ? 'The reference solution passes every test case.'
      : `The reference solution fails: ${result.feedback}`,
    result,
  });
}));

// --------------------------------------------------------- import/export

adminRouter.get('/questions-export', asyncHandler(async (req, res) => {
  const { items } = listQuestions({
    language: str(req.query.language),
    topic: str(req.query.topic),
    status: str(req.query.status),
    limit: 5000,
  });
  const questions = items
    .map((i) => findQuestionById(i.id))
    .filter((q): q is NonNullable<typeof q> => q !== null)
    .map(toQuestionInput);

  res.setHeader('Content-Disposition', 'attachment; filename="questions-export.json"');
  res.json({ version: 1, exportedAt: new Date().toISOString(), count: questions.length, questions });
}));

adminRouter.post('/questions-import', asyncHandler(async (req, res) => {
  const body = validate(
    z.object({
      questions: z.array(z.record(z.unknown())).min(1).max(2000),
      mode: z.enum(['upsert', 'create']).default('upsert'),
      dryRun: z.boolean().default(false),
    }),
    req.body,
  );

  const results: Array<{ index: number; qid?: string; status: 'created' | 'updated' | 'failed'; error?: string }> = [];

  for (const [index, raw] of body.questions.entries()) {
    try {
      const parsed = questionSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({
          index,
          qid: typeof raw.qid === 'string' ? raw.qid : undefined,
          status: 'failed',
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        continue;
      }
      const input = parsed.data as QuestionInput;
      assertAuthorable(input);
      if (body.dryRun) {
        // A dry run has to resolve the catalog references too, or it would
        // report a row as importable and then fail on the real import.
        resolveIds(input);
        results.push({ index, qid: input.qid, status: 'created' });
        continue;
      }
      const { question, created } = body.mode === 'create'
        ? { question: createQuestion({ ...input, qid: undefined }, req.user!.id), created: true }
        : upsertQuestion(input, req.user!.id);
      results.push({ index, qid: question.question.qid, status: created ? 'created' : 'updated' });
    } catch (err) {
      results.push({
        index,
        qid: typeof raw.qid === 'string' ? raw.qid : undefined,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({
    dryRun: body.dryRun,
    created: results.filter((r) => r.status === 'created').length,
    updated: results.filter((r) => r.status === 'updated').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}));

// ------------------------------------------------------------- taxonomy

adminRouter.post('/topics', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      language: z.string(),
      slug: z.string().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes.'),
      name: z.string().min(2),
      description: z.string().nullish(),
      displayOrder: z.number().int().default(0),
    }),
    req.body,
  );
  const conn = db();
  const lang = conn.prepare('SELECT id FROM languages WHERE slug = ?').get(input.language) as any;
  if (!lang) throw new ValidationError([{ path: 'language', message: 'Unknown language.' }]);
  conn.prepare(
    'INSERT OR IGNORE INTO topics (language_id, slug, name, description, display_order) VALUES (?, ?, ?, ?, ?)',
  ).run(lang.id, input.slug, input.name, input.description ?? null, input.displayOrder);
  res.status(201).json({ ok: true });
}));

adminRouter.post('/subtopics', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      language: z.string(),
      topic: z.string(),
      slug: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(2),
      displayOrder: z.number().int().default(0),
    }),
    req.body,
  );
  const conn = db();
  const topic = conn.prepare(`
    SELECT t.id FROM topics t JOIN languages l ON l.id = t.language_id
    WHERE l.slug = ? AND t.slug = ?
  `).get(input.language, input.topic) as any;
  if (!topic) throw new ValidationError([{ path: 'topic', message: 'Unknown topic.' }]);
  conn.prepare('INSERT OR IGNORE INTO subtopics (topic_id, slug, name, display_order) VALUES (?, ?, ?, ?)')
    .run(topic.id, input.slug, input.name, input.displayOrder);
  res.status(201).json({ ok: true });
}));

// ---------------------------------------------------------- assessments

const assessmentSchema = z.object({
  title: z.string().min(3),
  description: z.string().nullish(),
  language: z.string().nullish(),
  durationMinutes: z.number().int().positive().max(600).default(30),
  shuffle: z.boolean().default(false),
  allowHints: z.boolean().default(false),
  maxAttempts: z.number().int().positive().max(20).default(1),
  status: z.enum(['draft', 'published', 'closed']).default('draft'),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
  questions: z.array(z.object({ questionId: z.number().int().positive(), points: z.number().positive().default(10) })).default([]),
});

adminRouter.get('/assessments', asyncHandler(async (_req, res) => {
  const rows = db().prepare(`
    SELECT a.*, l.slug AS language,
      (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.assessment_id = a.id) AS question_count,
      (SELECT COUNT(*) FROM student_assessments sa WHERE sa.assessment_id = a.id AND sa.status = 'submitted') AS submissions
    FROM assessments a LEFT JOIN languages l ON l.id = a.language_id
    ORDER BY a.created_at DESC
  `).all() as any[];
  res.json({ assessments: rows });
}));

adminRouter.post('/assessments', asyncHandler(async (req, res) => {
  const input = validate(assessmentSchema, req.body);
  const conn = db();
  const languageId = input.language
    ? (conn.prepare('SELECT id FROM languages WHERE slug = ?').get(input.language) as any)?.id ?? null
    : null;

  const txn = conn.transaction(() => {
    const info = conn.prepare(`
      INSERT INTO assessments (title, description, language_id, duration_minutes, shuffle, allow_hints, max_attempts, status, starts_at, ends_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.title, input.description ?? null, languageId, input.durationMinutes,
      input.shuffle ? 1 : 0, input.allowHints ? 1 : 0, input.maxAttempts, input.status,
      input.startsAt ?? null, input.endsAt ?? null, req.user!.id,
    );
    const id = Number(info.lastInsertRowid);
    const link = conn.prepare(
      'INSERT OR IGNORE INTO assessment_questions (assessment_id, question_id, points, display_order) VALUES (?, ?, ?, ?)',
    );
    input.questions.forEach((q, i) => link.run(id, q.questionId, q.points, i));
    return id;
  });

  res.status(201).json({ id: txn() });
}));

adminRouter.put('/assessments/:id', asyncHandler(async (req, res) => {
  const input = validate(assessmentSchema, req.body);
  const id = parseIntParam(req.params.id, 0);
  const conn = db();
  const existing = conn.prepare('SELECT id FROM assessments WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError('Assessment');

  const languageId = input.language
    ? (conn.prepare('SELECT id FROM languages WHERE slug = ?').get(input.language) as any)?.id ?? null
    : null;

  conn.transaction(() => {
    conn.prepare(`
      UPDATE assessments SET title = ?, description = ?, language_id = ?, duration_minutes = ?,
        shuffle = ?, allow_hints = ?, max_attempts = ?, status = ?, starts_at = ?, ends_at = ?
      WHERE id = ?
    `).run(
      input.title, input.description ?? null, languageId, input.durationMinutes,
      input.shuffle ? 1 : 0, input.allowHints ? 1 : 0, input.maxAttempts, input.status,
      input.startsAt ?? null, input.endsAt ?? null, id,
    );
    conn.prepare('DELETE FROM assessment_questions WHERE assessment_id = ?').run(id);
    const link = conn.prepare(
      'INSERT OR IGNORE INTO assessment_questions (assessment_id, question_id, points, display_order) VALUES (?, ?, ?, ?)',
    );
    input.questions.forEach((q, i) => link.run(id, q.questionId, q.points, i));
  })();

  res.json({ ok: true });
}));

adminRouter.get('/assessments/:id/results', asyncHandler(async (req, res) => {
  const id = parseIntParam(req.params.id, 0);
  const rows = db().prepare(`
    SELECT sa.id, sa.status, sa.score, sa.max_score, sa.correct_count, sa.started_at, sa.submitted_at,
           sa.time_spent_ms, u.full_name AS student, u.email, st.batch
    FROM student_assessments sa
    JOIN users u ON u.id = sa.user_id
    LEFT JOIN students st ON st.user_id = u.id
    WHERE sa.assessment_id = ?
    ORDER BY sa.score DESC, sa.submitted_at
  `).all(id) as any[];
  res.json({ results: rows });
}));

adminRouter.delete('/assessments/:id', asyncHandler(async (req, res) => {
  const ok = db().prepare('DELETE FROM assessments WHERE id = ?').run(parseIntParam(req.params.id, 0)).changes > 0;
  if (!ok) throw new NotFoundError('Assessment');
  res.json({ ok: true });
}));

// ------------------------------------------------------------- students

adminRouter.get('/students', asyncHandler(async (req, res) => {
  res.json({
    students: studentSummaries(parseIntParam(req.query.limit, 100), str(req.query.search)),
  });
}));

adminRouter.post('/students', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      email: z.string().email(),
      fullName: z.string().min(2),
      password: z.string().min(6),
      batch: z.string().nullish(),
      role: z.enum(['student', 'teacher', 'admin']).default('student'),
    }),
    req.body,
  );
  try {
    const user = await createUser({
      email: input.email, password: input.password, fullName: input.fullName,
      batch: input.batch ?? null, role: input.role,
    });
    res.status(201).json({ user });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

adminRouter.get('/students/:id', asyncHandler(async (req, res) => {
  const userId = parseIntParam(req.params.id, 0);
  const { dashboardFor } = await import('../db/repositories/progress.js');
  const user = db().prepare(`
    SELECT u.id, u.full_name AS name, u.email, u.role, st.batch, st.xp, st.level,
           st.streak_current AS streak, st.streak_best AS bestStreak
    FROM users u LEFT JOIN students st ON st.user_id = u.id WHERE u.id = ?
  `).get(userId) as any;
  if (!user) throw new NotFoundError('Student');
  res.json({
    student: user,
    dashboard: dashboardFor(userId),
    recentSubmissions: listSubmissions({ userId, mode: 'submit', limit: 20 }).items,
  });
}));

// -------------------------------------------------------------- assign

adminRouter.post('/assignments', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      title: z.string().min(3),
      description: z.string().nullish(),
      dueAt: z.string().nullish(),
      questionIds: z.array(z.number().int().positive()).min(1),
      studentIds: z.array(z.number().int().positive()).min(1),
    }),
    req.body,
  );
  const conn = db();
  const id = conn.transaction(() => {
    const info = conn.prepare(
      'INSERT INTO assignments (title, description, due_at, created_by) VALUES (?, ?, ?, ?)',
    ).run(input.title, input.description ?? null, input.dueAt ?? null, req.user!.id);
    const assignmentId = Number(info.lastInsertRowid);
    const q = conn.prepare('INSERT OR IGNORE INTO assignment_questions (assignment_id, question_id, display_order) VALUES (?, ?, ?)');
    input.questionIds.forEach((qid, i) => q.run(assignmentId, qid, i));
    const s = conn.prepare('INSERT OR IGNORE INTO assignment_students (assignment_id, user_id) VALUES (?, ?)');
    for (const sid of input.studentIds) s.run(assignmentId, sid);
    return assignmentId;
  })();
  res.status(201).json({ id });
}));

adminRouter.get('/assignments', asyncHandler(async (_req, res) => {
  const rows = db().prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id) AS question_count,
           (SELECT COUNT(*) FROM assignment_students s WHERE s.assignment_id = a.id) AS student_count
    FROM assignments a ORDER BY a.created_at DESC
  `).all();
  res.json({ assignments: rows });
}));

// ---------------------------------------------------------- collections

adminRouter.post('/collections', asyncHandler(async (req, res) => {
  const input = validate(
    z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(3),
      description: z.string().nullish(),
      questionIds: z.array(z.number().int().positive()).default([]),
    }),
    req.body,
  );
  const conn = db();
  const id = conn.transaction(() => {
    const info = conn.prepare(
      'INSERT INTO collections (slug, name, description, created_by) VALUES (?, ?, ?, ?)',
    ).run(input.slug, input.name, input.description ?? null, req.user!.id);
    const collectionId = Number(info.lastInsertRowid);
    const link = conn.prepare('INSERT OR IGNORE INTO collection_questions (collection_id, question_id, display_order) VALUES (?, ?, ?)');
    input.questionIds.forEach((qid, i) => link.run(collectionId, qid, i));
    return collectionId;
  })();
  res.status(201).json({ id });
}));

adminRouter.get('/collections', asyncHandler(async (_req, res) => {
  res.json({
    collections: db().prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM collection_questions cq WHERE cq.collection_id = c.id) AS question_count
      FROM collections c ORDER BY c.name
    `).all(),
  });
}));

// ------------------------------------------------------------ analytics

adminRouter.get('/analytics/overview', asyncHandler(async (_req, res) => {
  res.json({
    overview: platformOverview(),
    weakConcepts: topicAccuracy().slice(0, 10),
    hardestQuestions: questionStats({ limit: 10, order: 'hardest' }),
    mostAttempted: questionStats({ limit: 10, order: 'most_attempted' }),
    commonErrors: commonErrors(10),
    topStudents: leaderboard(10),
  });
}));

adminRouter.get('/analytics/questions', asyncHandler(async (req, res) => {
  res.json({
    questions: questionStats({
      limit: parseIntParam(req.query.limit, 50),
      order: (str(req.query.order) as any) ?? 'hardest',
    }),
  });
}));

adminRouter.get('/analytics/topics', asyncHandler(async (_req, res) => {
  res.json({ topics: topicAccuracy() });
}));

adminRouter.get('/analytics/submissions', asyncHandler(async (req, res) => {
  res.json(listSubmissions({
    mode: 'submit',
    questionId: req.query.questionId ? parseIntParam(req.query.questionId, 0) : undefined,
    limit: parseIntParam(req.query.limit, 50),
    offset: parseIntParam(req.query.offset, 0),
  }));
}));

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
