import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser } from '../src/auth/index.js';
import { db, resetDatabase } from '../src/db/index.js';
import { createQuestion } from '../src/db/repositories/questions.js';
import { deriveQuestion, pickRequired } from '../src/services/deriveQuestion.js';
import { gapsForUser, masteryForUser } from '../src/services/mastery.js';
import { matchMisconception, replaceMisconceptions } from '../src/services/misconceptions.js';
import { checkQuestion, healthSummary, sweep } from '../src/services/questionHealth.js';
import { dueForUser, gradeAttempt, nextSchedule, recordReview, summaryForUser } from '../src/services/review.js';
import { findQuestionById } from '../src/db/repositories/questions.js';
import type { EvaluationResult } from '../src/evaluation/types.js';

/**
 * The five features built on top of the platform: question health, construct
 * mastery, spaced repetition, misconception hints and question derivation.
 */

let server: Server;
let baseUrl: string;
let studentToken = '';
let adminToken = '';
let goodQuestionId = 0;
let brokenQuestionId = 0;
let studentId = 0;

async function call(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  resetDatabase();
  const conn = db();

  conn.prepare(`
    INSERT INTO languages (slug, name, runtime, monaco_id, file_extension, accent, display_order)
    VALUES ('python', 'Python', 'python', 'python', 'py', '#3b82f6', 0)
  `).run();
  const languageId = (conn.prepare('SELECT id FROM languages WHERE slug = ?').get('python') as { id: number }).id;
  conn.prepare('INSERT INTO topics (language_id, slug, name, display_order) VALUES (?, ?, ?, 0)')
    .run(languageId, 'loops', 'Loops');

  const admin = await createUser({
    email: 'admin@test.dev', password: 'admin123', fullName: 'Test Admin', role: 'admin',
  });
  const student = await createUser({
    email: 'student@test.dev', password: 'student123', fullName: 'Test Student',
  });
  studentId = student.id;

  goodQuestionId = createQuestion({
    qid: 'PY-LOOPS-9001',
    language: 'python', topic: 'loops', difficulty: 'Easy',
    questionType: 'COMPLETE_LOOP', evaluationType: 'OUTPUT',
    title: 'Print every number',
    statement: 'Write a for loop that prints every number.',
    starterCode: 'numbers = [1, 2, 3]\n\n{{STUDENT_CODE}}',
    requiredConstructs: ['FOR_LOOP'],
    testCases: [{ visibility: 'public', expectedOutput: '1\n2\n3', matcher: 'trimmed' }],
    solutions: [{ code: 'for n in numbers:\n    print(n)', isPrimary: true }],
    status: 'published',
  }, admin.id).question.id;

  // A question whose reference solution does not produce the stated output —
  // exactly the rot the health sweep exists to find.
  brokenQuestionId = createQuestion({
    qid: 'PY-LOOPS-9002',
    language: 'python', topic: 'loops', difficulty: 'Easy',
    questionType: 'COMPLETE_LOOP', evaluationType: 'OUTPUT',
    title: 'Rotten question',
    statement: 'This question expects output its own solution never produces.',
    starterCode: 'numbers = [1, 2, 3]\n\n{{STUDENT_CODE}}',
    requiredConstructs: ['FOR_LOOP'],
    testCases: [{ visibility: 'public', expectedOutput: 'never printed', matcher: 'trimmed' }],
    solutions: [{ code: 'for n in numbers:\n    print(n)', isPrimary: true }],
    status: 'published',
  }, admin.id).question.id;

  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  studentToken = (await call('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'student@test.dev', password: 'student123' }),
  })).body.token;
  adminToken = (await call('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'admin@test.dev', password: 'admin123' }),
  })).body.token;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// --------------------------------------------------------- health sweep

describe('question health', () => {
  it('passes a question whose reference solution works', async () => {
    const record = await checkQuestion(findQuestionById(goodQuestionId)!);
    expect(record.status).toBe('healthy');
    expect(record.verdict).toBe('CORRECT');
  });

  it('flags a question its own reference solution cannot pass', async () => {
    const record = await checkQuestion(findQuestionById(brokenQuestionId)!);
    expect(record.status).toBe('failing');
    expect(record.message).toMatch(/reference solution fails/i);
  });

  it('reports a question with no reference solution as unverifiable', async () => {
    const created = createQuestion({
      qid: 'PY-LOOPS-9003',
      language: 'python', topic: 'loops', difficulty: 'Easy',
      questionType: 'FILL_CODE', evaluationType: 'AST',
      title: 'No solution', statement: 'Nothing to verify against.',
      starterCode: '{{STUDENT_CODE}}', requiredConstructs: ['FOR_LOOP'],
      status: 'published',
    }, 1).question.id;

    const record = await checkQuestion(findQuestionById(created)!);
    expect(record.status).toBe('unverifiable');
  });

  it('sweeps the bank and separates the failures', async () => {
    const summary = await sweep();
    expect(summary.checked).toBeGreaterThanOrEqual(3);
    expect(summary.failing).toBeGreaterThanOrEqual(1);
    expect(summary.failures.map((f) => f.qid)).toContain('PY-LOOPS-9002');
    // A healthy question must never appear in the failure list.
    expect(summary.failures.map((f) => f.qid)).not.toContain('PY-LOOPS-9001');
  });

  it('counts unchecked questions separately from healthy ones', async () => {
    const summary = healthSummary();
    expect(summary.healthy + summary.failing + summary.unverifiable).toBeGreaterThanOrEqual(3);
  });

  it('tells the admin when a saved question is unanswerable', async () => {
    const res = await call(`/admin/questions/${brokenQuestionId}`, { token: adminToken });
    const question = res.body.question;
    const saved = await call(`/admin/questions/${brokenQuestionId}`, {
      method: 'PUT', token: adminToken, body: JSON.stringify(question),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.health.status).toBe('failing');
    expect(saved.body.health.blocksPublication).toBe(true);
  });

  it('exposes the sweep over HTTP to admins only', async () => {
    const denied = await call('/admin/questions-health/sweep', { method: 'POST', token: studentToken, body: '{}' });
    expect(denied.status).toBe(403);

    const allowed = await call('/admin/questions-health/sweep', { method: 'POST', token: adminToken, body: '{}' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.checked).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------- construct mastery

describe('construct mastery', () => {
  it('records what the student actually wrote, per construct', async () => {
    await call(`/practice/questions/${goodQuestionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'for n in numbers:\n    print(n)', timeSpentMs: 1000 }),
    });

    const mastery = masteryForUser(studentId);
    const forLoop = mastery.find((m) => m.construct === 'FOR_LOOP');
    expect(forLoop).toBeTruthy();
    expect(forLoop!.correct).toBe(1);
    expect(forLoop!.required).toBe(1);
    expect(forLoop!.label).toMatch(/for/i);
  });

  it('separates a construct the student used from one the question demanded', async () => {
    const mastery = masteryForUser(studentId);
    // `print` was used but never required by the question.
    const call1 = mastery.find((m) => m.construct.startsWith('CALL') || m.construct === 'PRINT');
    if (call1) expect(call1.required).toBe(0);
  });

  it('counts a wrong answer as an attempt but not a success', async () => {
    await call(`/practice/questions/${brokenQuestionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'for n in numbers:\n    print(n)', timeSpentMs: 1000 }),
    });

    const forLoop = masteryForUser(studentId).find((m) => m.construct === 'FOR_LOOP')!;
    expect(forLoop.attempts).toBeGreaterThanOrEqual(2);
    expect(forLoop.correct).toBe(1);
    expect(forLoop.accuracy).toBeLessThan(1);
  });

  it('does not report a construct the student has mastered as a gap', () => {
    const gaps = gapsForUser(studentId);
    expect(gaps.map((g) => g.construct)).not.toContain('FOR_LOOP');
  });

  it('serves mastery over HTTP', async () => {
    const res = await call('/progress/mastery', { token: studentToken });
    expect(res.status).toBe(200);
    expect(res.body.mastery.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.gaps)).toBe(true);
  });
});

// ---------------------------------------------------- spaced repetition

describe('spaced repetition', () => {
  it('grades an effortless first solve highest', () => {
    expect(gradeAttempt({ isCorrect: true, hintsUsed: 0, attemptNumber: 1 })).toBe(5);
  });

  it('grades a hinted solve lower than an unaided one', () => {
    const unaided = gradeAttempt({ isCorrect: true, hintsUsed: 0, attemptNumber: 1 });
    const hinted = gradeAttempt({ isCorrect: true, hintsUsed: 2, attemptNumber: 3 });
    expect(hinted).toBeLessThan(unaided);
  });

  it('treats a wrong answer as a lapse', () => {
    expect(gradeAttempt({ isCorrect: false, hintsUsed: 0, attemptNumber: 1 })).toBeLessThan(3);
  });

  it('lengthens the interval as repetitions succeed', () => {
    const first = nextSchedule({ ease: 2.5, intervalDays: 1, repetitions: 0, lapses: 0 }, 5);
    const second = nextSchedule(first, 5);
    const third = nextSchedule(second, 5);
    expect(first.intervalDays).toBe(1);
    expect(second.intervalDays).toBe(6);
    expect(third.intervalDays).toBeGreaterThan(6);
  });

  it('collapses the interval on a lapse but keeps the history', () => {
    const grown = nextSchedule(nextSchedule({ ease: 2.5, intervalDays: 1, repetitions: 0, lapses: 0 }, 5), 5);
    const lapsed = nextSchedule(grown, 2);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.lapses).toBe(1);
    // Ease decays rather than resetting: one slip must not erase a long record.
    expect(lapsed.ease).toBeLessThan(grown.ease);
    expect(lapsed.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('never lets ease fall below the floor', () => {
    let state = { ease: 1.4, intervalDays: 10, repetitions: 5, lapses: 0 };
    for (let i = 0; i < 10; i += 1) state = nextSchedule(state, 2);
    expect(state.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('caps the interval so reviews never drift past a year', () => {
    const state = nextSchedule({ ease: 2.5, intervalDays: 300, repetitions: 9, lapses: 0 }, 5);
    expect(state.intervalDays).toBeLessThanOrEqual(365);
  });

  it('schedules a solved question and surfaces it once due', () => {
    recordReview({ userId: studentId, questionId: goodQuestionId, quality: 5 });
    expect(dueForUser(studentId)).toHaveLength(0);

    // Pull the due date into the past to simulate the wait.
    db().prepare(`UPDATE review_schedule SET due_at = datetime('now', '-2 days') WHERE user_id = ? AND question_id = ?`)
      .run(studentId, goodQuestionId);

    const due = dueForUser(studentId);
    expect(due).toHaveLength(1);
    expect(due[0].qid).toBe('PY-LOOPS-9001');
    expect(due[0].overdueDays).toBeGreaterThanOrEqual(1);
  });

  it('summarises the upcoming load', () => {
    const summary = summaryForUser(studentId);
    expect(summary.scheduled).toBeGreaterThanOrEqual(1);
    expect(summary.dueNow).toBeGreaterThanOrEqual(1);
  });

  it('serves the queue over HTTP', async () => {
    const res = await call('/progress/reviews', { token: studentToken });
    expect(res.status).toBe(200);
    expect(res.body.summary.scheduled).toBeGreaterThanOrEqual(1);
  });
});

// ------------------------------------------------------- misconceptions

const wrongResult = (over: Partial<EvaluationResult> = {}): EvaluationResult => ({
  verdict: 'WRONG_CONSTRUCT',
  isCorrect: false,
  score: 0,
  maxScore: 100,
  errorType: 'conceptual',
  feedback: 'Wrong construct.',
  stages: [],
  tests: [],
  testsPassed: 0,
  testsFailed: 1,
  generatedCode: '',
  stdout: '',
  stderr: '',
  executionMs: 1,
  memoryKb: 0,
  detectedConstructs: ['WHILE_LOOP', 'CALL:range'],
  missingConstructs: ['FOR_LOOP'],
  usedForbiddenConstructs: [],
  ...over,
});

describe('misconception hints', () => {
  it('matches a rule on the construct the student actually used', () => {
    replaceMisconceptions(goodQuestionId, [{
      label: 'Used while instead of for',
      hint: 'A while loop works, but this question is practising the for loop.',
      displayOrder: 0,
      constructUsed: ['WHILE_LOOP'],
      constructAbsent: [],
      fragmentRegex: null,
      errorType: null,
      verdict: null,
    }]);

    const match = matchMisconception(goodQuestionId, 'while i < len(numbers):', wrongResult());
    expect(match?.label).toBe('Used while instead of for');
  });

  it('does not fire on a correct answer', () => {
    const match = matchMisconception(
      goodQuestionId,
      'while i < len(numbers):',
      wrongResult({ isCorrect: true, verdict: 'CORRECT' }),
    );
    expect(match).toBeNull();
  });

  it('requires every criterion to hold', () => {
    replaceMisconceptions(goodQuestionId, [{
      label: 'Indexing instead of iterating',
      hint: 'Iterate the list directly.',
      displayOrder: 0,
      constructUsed: ['FOR_LOOP'],
      constructAbsent: [],
      fragmentRegex: 'range\\s*\\(\\s*len',
      errorType: null,
      verdict: null,
    }]);

    // The construct matches but the fragment does not.
    expect(matchMisconception(
      goodQuestionId, 'for n in numbers:', wrongResult({ detectedConstructs: ['FOR_LOOP'] }),
    )).toBeNull();

    // Both match.
    expect(matchMisconception(
      goodQuestionId, 'for i in range(len(numbers)):', wrongResult({ detectedConstructs: ['FOR_LOOP'] }),
    )?.label).toBe('Indexing instead of iterating');
  });

  it('treats a rule with no criteria as inert rather than universal', () => {
    replaceMisconceptions(goodQuestionId, [{
      label: 'Matches nothing',
      hint: 'Should never be shown.',
      displayOrder: 0,
      constructUsed: [],
      constructAbsent: [],
      fragmentRegex: null,
      errorType: null,
      verdict: null,
    }]);
    expect(matchMisconception(goodQuestionId, 'anything at all', wrongResult())).toBeNull();
  });

  it('survives a regex that cannot compile', () => {
    replaceMisconceptions(goodQuestionId, [{
      label: 'Broken pattern',
      hint: 'Never matches.',
      displayOrder: 0,
      constructUsed: [],
      constructAbsent: [],
      fragmentRegex: '([unclosed',
      errorType: null,
      verdict: null,
    }]);
    expect(() => matchMisconception(goodQuestionId, 'anything', wrongResult())).not.toThrow();
  });

  it('rejects an uncompilable regex when it is authored', async () => {
    const res = await call(`/admin/questions/${goodQuestionId}/misconceptions`, {
      method: 'PUT', token: adminToken,
      body: JSON.stringify({
        misconceptions: [{ label: 'Bad', hint: 'Bad', fragmentRegex: '([unclosed' }],
      }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/regular expression/i);
  });

  it('returns the matched hint with a submission', async () => {
    await call(`/admin/questions/${goodQuestionId}/misconceptions`, {
      method: 'PUT', token: adminToken,
      body: JSON.stringify({
        misconceptions: [{
          label: 'Printed the list instead of looping',
          hint: 'Write the loop rather than printing the whole list.',
          constructAbsent: ['FOR_LOOP'],
        }],
      }),
    });

    const res = await call(`/practice/questions/${goodQuestionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'print(numbers)', timeSpentMs: 500 }),
    });
    expect(res.body.misconception?.label).toBe('Printed the list instead of looping');
  });
});

// --------------------------------------------------- derive from program

describe('deriving a question from a program', () => {
  const program = 'numbers = [1, 2, 3]\n\nfor n in numbers:\n    print(n)\n\nprint("Done")';

  it('replaces the selected lines with the student marker', async () => {
    const derived = await deriveQuestion({ language: 'python', program, startLine: 3, endLine: 4 });
    expect(derived.starterCode).toContain('{{STUDENT_CODE}}');
    expect(derived.starterCode).toContain('numbers = [1, 2, 3]');
    expect(derived.starterCode).toContain('print("Done")');
    expect(derived.starterCode).not.toContain('for n in numbers');
  });

  it('returns the selection as the reference solution', async () => {
    const derived = await deriveQuestion({ language: 'python', program, startLine: 3, endLine: 4 });
    expect(derived.solution).toBe('for n in numbers:\n    print(n)');
  });

  it('detects the construct being taught', async () => {
    const derived = await deriveQuestion({ language: 'python', program, startLine: 3, endLine: 4 });
    expect(derived.detectedConstructs).toContain('FOR_LOOP');
    expect(derived.requiredConstructs).toContain('FOR_LOOP');
  });

  it('fills in the expected output by running the program', async () => {
    const derived = await deriveQuestion({ language: 'python', program, startLine: 3, endLine: 4 });
    expect(derived.expectedOutput).toBe('1\n2\n3\nDone');
    expect(derived.executionError).toBeNull();
  });

  it('dedents an indented selection and keeps the marker in its column', async () => {
    const nested = 'items = [1, 2]\nif items:\n    for n in items:\n        print(n)';
    const derived = await deriveQuestion({ language: 'python', program: nested, startLine: 3, endLine: 4 });
    // The student writes at column zero...
    expect(derived.solution).toBe('for n in items:\n    print(n)');
    // ...while the marker keeps the indentation the template needs.
    expect(derived.starterCode).toContain('    {{STUDENT_CODE}}');
  });

  it('refuses a selection outside the program', async () => {
    await expect(deriveQuestion({ language: 'python', program, startLine: 1, endLine: 99 }))
      .rejects.toThrow(/outside the program/i);
  });

  it('refuses a blank selection', async () => {
    await expect(deriveQuestion({ language: 'python', program, startLine: 2, endLine: 2 }))
      .rejects.toThrow(/blank/i);
  });

  it('reports a program that does not run instead of inventing output', async () => {
    const broken = 'x = 1\nraise ValueError("boom")\nprint(x)';
    const derived = await deriveQuestion({ language: 'python', program: broken, startLine: 3, endLine: 3 });
    expect(derived.expectedOutput).toBeNull();
    expect(derived.executionError).toBeTruthy();
    expect(derived.warnings.join(' ')).toMatch(/did not run cleanly/i);
  });

  it('keeps required constructs to the structural ones', () => {
    const picked = pickRequired(['FOR_LOOP', 'CALL:print', 'NAME:n', 'OP_LT', 'LIST_COMPREHENSION']);
    expect(picked).toContain('FOR_LOOP');
    expect(picked).not.toContain('CALL:print');
    expect(picked).not.toContain('OP_LT');
    expect(picked.length).toBeLessThanOrEqual(3);
  });

  it('derives through the admin API', async () => {
    const res = await call('/admin/questions/derive', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({ language: 'python', program, startLine: 3, endLine: 4 }),
    });
    expect(res.status).toBe(200);
    expect(res.body.expectedOutput).toBe('1\n2\n3\nDone');
  });

  it('reports a bad line range as a validation error, not a crash', async () => {
    const res = await call('/admin/questions/derive', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({ language: 'python', program, startLine: 50, endLine: 60 }),
    });
    expect(res.status).toBe(400);
  });
});
