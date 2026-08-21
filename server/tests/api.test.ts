import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser } from '../src/auth/index.js';
import { db, resetDatabase } from '../src/db/index.js';
import { createQuestion } from '../src/db/repositories/questions.js';

/**
 * End-to-end API coverage: auth, the practice loop, hidden tests, hints,
 * gamification and the admin question lifecycle — against a throwaway database.
 */

let server: Server;
let baseUrl: string;
let studentToken = '';
let adminToken = '';
let questionId = 0;

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
  const topicId = (conn.prepare('SELECT id FROM topics WHERE slug = ?').get('loops') as { id: number }).id;
  conn.prepare('INSERT INTO subtopics (topic_id, slug, name, display_order) VALUES (?, ?, ?, 0)')
    .run(topicId, 'for', 'for');
  conn.prepare(`
    INSERT INTO badges (slug, name, description, icon, criteria_type, criteria_value, xp_reward)
    VALUES ('first-steps', 'First Steps', 'Solve your first question', '🌱', 'solved_total', 1, 25)
  `).run();

  const admin = await createUser({
    email: 'admin@test.dev', password: 'admin123', fullName: 'Test Admin', role: 'admin',
  });
  await createUser({ email: 'student@test.dev', password: 'student123', fullName: 'Test Student' });

  const created = createQuestion({
    qid: 'PY-LOOPS-9001',
    language: 'python',
    topic: 'loops',
    subtopic: 'for',
    difficulty: 'Easy',
    questionType: 'COMPLETE_LOOP',
    evaluationType: 'OUTPUT',
    title: 'Print every number',
    statement: 'Write a for loop that prints every number in the list.',
    starterCode: '{{SETUP_CODE}}\n\n{{STUDENT_CODE}}',
    requiredConstructs: ['FOR_LOOP'],
    explanation: 'A for loop iterates over each element.',
    testCases: [
      { visibility: 'public', setupCode: 'numbers = [1, 2, 3]', expectedOutput: '1\n2\n3', matcher: 'trimmed' },
      { visibility: 'hidden', setupCode: 'numbers = [9]', expectedOutput: '9', matcher: 'trimmed' },
    ],
    hints: [{ body: 'Which loop walks a list?', penalty: 10 }, { body: 'It starts with "for".', penalty: 15 }],
    solutions: [{ code: 'for n in numbers:\n    print(n)', isPrimary: true }],
    tags: ['loops'],
  }, admin.id);
  questionId = created.question.id;

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('auth', () => {
  it('rejects bad credentials', async () => {
    const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'student@test.dev', password: 'wrong1' }) });
    expect(res.status).toBe(401);
  });

  it('signs a student in', async () => {
    const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'student@test.dev', password: 'student123' }) });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    studentToken = res.body.token;
  });

  it('signs an admin in', async () => {
    const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@test.dev', password: 'admin123' }) });
    adminToken = res.body.token;
    expect(res.body.user.role).toBe('admin');
  });

  it('registers a new student', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@test.dev', password: 'secret123', fullName: 'New Learner' }),
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('student');
  });

  it('refuses a duplicate email', async () => {
    const res = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@test.dev', password: 'secret123', fullName: 'Dup' }),
    });
    expect(res.status).toBe(409);
  });

  it('requires a token for protected routes', async () => {
    const res = await call('/progress/dashboard');
    expect(res.status).toBe(401);
  });
});

describe('practice', () => {
  it('serves the catalog', async () => {
    const res = await call('/practice/catalog');
    expect(res.body.languages[0].slug).toBe('python');
    expect(res.body.languages[0].topics[0].questionCount).toBe(1);
  });

  it('serves a question without leaking hidden expectations', async () => {
    const res = await call('/practice/questions/PY-LOOPS-9001', { token: studentToken });
    expect(res.status).toBe(200);
    const q = res.body.question;
    expect(q.contextBefore).toContain('numbers = [1, 2, 3]');
    expect(q.contextBefore).not.toContain('SETUP_CODE');
    expect(q.publicTests).toHaveLength(1);
    expect(q.hiddenTestCount).toBe(1);
    expect(JSON.stringify(q)).not.toContain('for n in numbers');
  });

  it('runs a fragment against public tests only', async () => {
    const res = await call(`/practice/questions/${questionId}/run`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'for n in numbers:\n    print(n)' }),
    });
    expect(res.body.result.tests).toHaveLength(1);
    expect(res.body.result.isCorrect).toBe(true);
  });

  it('rejects correct output with the wrong construct', async () => {
    const res = await call(`/practice/questions/${questionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'print(*numbers, sep="\\n")' }),
    });
    expect(res.body.result.verdict).toBe('WRONG_CONSTRUCT');
    expect(res.body.result.score).toBe(0);
    expect(res.body.explanation).toBeNull();
  });

  it('awards XP and a badge on the first correct submission', async () => {
    const res = await call(`/practice/questions/${questionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'for n in numbers:\n    print(n)', timeSpentMs: 5000 }),
    });
    expect(res.body.result.verdict).toBe('CORRECT');
    expect(res.body.result.tests).toHaveLength(2);
    expect(res.body.award.xpEarned).toBeGreaterThan(0);
    expect(res.body.award.newBadges.map((b: { slug: string }) => b.slug)).toContain('first-steps');
    expect(res.body.explanation).toContain('for loop');
  });

  it('does not award XP twice for the same question', async () => {
    const res = await call(`/practice/questions/${questionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'for n in numbers:\n    print(n)' }),
    });
    expect(res.body.award.xpEarned).toBe(0);
  });

  it('catches a hardcoded answer with the hidden test', async () => {
    const res = await call(`/practice/questions/${questionId}/submit`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ code: 'for n in [1, 2, 3]:\n    print(n)' }),
    });
    expect(res.body.result.isCorrect).toBe(false);
    const hidden = res.body.result.tests.find((t: { visibility: string }) => t.visibility === 'hidden');
    expect(hidden.passed).toBe(false);
    expect(hidden.expected).toBeUndefined();
  });

  it('reveals hints one at a time', async () => {
    const before = await call(`/practice/questions/${questionId}/hints`, { token: studentToken });
    expect(before.body.hints.every((h: { unlocked: boolean }) => !h.unlocked)).toBe(true);

    const res = await call(`/practice/questions/${questionId}/hint`, {
      method: 'POST', token: studentToken, body: JSON.stringify({ index: 0 }),
    });
    expect(res.body.hint.body).toMatch(/Which loop/);
    expect(res.body.remaining).toBe(1);

    const after = await call(`/practice/questions/${questionId}/hints`, { token: studentToken });
    expect(after.body.hints[0].unlocked).toBe(true);
    expect(after.body.hints[1].body).toBeNull();
  });

  it('reveals the solution on request', async () => {
    const res = await call(`/practice/questions/${questionId}/solution`, { method: 'POST', token: studentToken });
    expect(res.body.solutions[0].code).toContain('for n in numbers');
    expect(res.body.warning).toMatch(/scores this question 0/i);
  });

  it('records submissions in the history', async () => {
    const res = await call('/practice/submissions', { token: studentToken });
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.submissions[0].qid).toBe('PY-LOOPS-9001');
  });

  it('reports progress on the dashboard', async () => {
    const res = await call('/progress/dashboard', { token: studentToken });
    expect(res.body.summary.solved).toBe(1);
    expect(res.body.summary.attempted).toBe(1);
    expect(res.body.summary.errors.conceptual).toBeGreaterThan(0);
    expect(res.body.summary.byLanguage[0].key).toBe('python');
  });

  it('ranks the student on the leaderboard', async () => {
    const res = await call('/progress/leaderboard', { token: studentToken });
    expect(res.body.myRank).toBe(1);
    expect(res.body.leaderboard[0].isMe).toBe(true);
  });
});

describe('admin', () => {
  it('refuses students access to the admin API', async () => {
    const res = await call('/admin/questions', { token: studentToken });
    expect(res.status).toBe(403);
  });

  it('rejects a question template without the student marker', async () => {
    const res = await call('/admin/questions', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({
        language: 'python', topic: 'loops', difficulty: 'Easy',
        questionType: 'FILL_CODE', evaluationType: 'OUTPUT',
        title: 'Broken question', statement: 'This template has no marker.',
        starterCode: 'print(1)',
        testCases: [{ visibility: 'public', expectedOutput: '1' }],
      }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.issues)).toContain('STUDENT_CODE');
  });

  it('creates a question through the API and generates a QID', async () => {
    const res = await call('/admin/questions', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({
        language: 'python', topic: 'loops', difficulty: 'Easy',
        questionType: 'COMPLETE_LOOP', evaluationType: 'OUTPUT',
        title: 'Print doubles', statement: 'Print each number doubled.',
        starterCode: 'numbers = [1, 2]\n\n{{STUDENT_CODE}}',
        requiredConstructs: ['FOR_LOOP'],
        testCases: [{ visibility: 'public', expectedOutput: '2\n4' }],
        solutions: [{ code: 'for n in numbers:\n    print(n * 2)', isPrimary: true }],
        status: 'published',
      }),
    });
    expect(res.status).toBe(201);
    expect(res.body.qid).toMatch(/^PYT-LOOPS-\d{4}$/);
  });

  it('verifies the reference solution of a stored question', async () => {
    const res = await call(`/admin/questions/${questionId}/verify`, { method: 'POST', token: adminToken });
    expect(res.body.ok).toBe(true);
  });

  it('dry-runs a candidate answer without saving', async () => {
    const before = await call('/admin/questions', { token: adminToken });
    const res = await call('/admin/questions/dry-run', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({
        question: {
          language: 'python', topic: 'loops', difficulty: 'Easy',
          questionType: 'FILL_CODE', evaluationType: 'OUTPUT',
          title: 'Draft', statement: 'Draft question.',
          starterCode: 'xs = [1]\n\n{{STUDENT_CODE}}',
          requiredConstructs: ['FOR_LOOP'],
          testCases: [{ visibility: 'public', expectedOutput: '1' }],
        },
        code: 'for x in xs:\n    print(x)',
      }),
    });
    const after = await call('/admin/questions', { token: adminToken });
    expect(res.body.result.verdict).toBe('CORRECT');
    expect(after.body.total).toBe(before.body.total);
  });

  it('duplicates a question as a draft', async () => {
    const res = await call(`/admin/questions/${questionId}/duplicate`, { method: 'POST', token: adminToken });
    expect(res.status).toBe(201);
    const copy = await call(`/admin/questions/${res.body.id}`, { token: adminToken });
    expect(copy.body.question.status).toBe('draft');
    expect(copy.body.question.title).toMatch(/\(copy\)$/);
  });

  it('exports and re-imports questions', async () => {
    const exported = await call('/admin/questions-export', { token: adminToken });
    expect(exported.body.questions.length).toBeGreaterThan(0);

    const res = await call('/admin/questions-import', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({ questions: exported.body.questions, mode: 'upsert' }),
    });
    expect(res.body.failed).toBe(0);
    expect(res.body.updated).toBe(exported.body.questions.length);
  });

  it('reports import failures per row without aborting the batch', async () => {
    const res = await call('/admin/questions-import', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({
        questions: [
          { language: 'python', topic: 'loops', difficulty: 'Easy', questionType: 'FILL_CODE', evaluationType: 'AST', title: 'Valid one', statement: 'Write a loop.', starterCode: '{{STUDENT_CODE}}', requiredConstructs: ['FOR_LOOP'] },
          { language: 'python', topic: 'nope', difficulty: 'Easy', questionType: 'FILL_CODE', evaluationType: 'AST', title: 'Bad topic', statement: 'This one names a topic that does not exist.', starterCode: '{{STUDENT_CODE}}', requiredConstructs: ['FOR_LOOP'] },
        ],
      }),
    });
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.results[1].error).toMatch(/Unknown topic/);
  });

  it('surfaces analytics for the cohort', async () => {
    const res = await call('/admin/analytics/overview', { token: adminToken });
    expect(res.body.overview.submissions).toBeGreaterThan(0);
    expect(res.body.hardestQuestions.length).toBeGreaterThan(0);
    expect(res.body.weakConcepts.length).toBeGreaterThan(0);
  });

  it('deletes a question', async () => {
    const created = await call('/admin/questions', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({
        language: 'python', topic: 'loops', difficulty: 'Easy',
        questionType: 'FILL_CODE', evaluationType: 'AST',
        title: 'Disposable', statement: 'Write a loop.',
        starterCode: '{{STUDENT_CODE}}', requiredConstructs: ['FOR_LOOP'],
      }),
    });
    const res = await call(`/admin/questions/${created.body.id}`, { method: 'DELETE', token: adminToken });
    expect(res.status).toBe(200);
    const gone = await call(`/admin/questions/${created.body.id}`, { token: adminToken });
    expect(gone.status).toBe(404);
  });
});

describe('assessments', () => {
  let assessmentId = 0;
  let attemptId = 0;

  it('creates and publishes an assessment', async () => {
    const res = await call('/admin/assessments', {
      method: 'POST', token: adminToken,
      body: JSON.stringify({
        title: 'Python syntax test',
        durationMinutes: 30,
        status: 'published',
        questions: [{ questionId, points: 10 }],
      }),
    });
    expect(res.status).toBe(201);
    assessmentId = res.body.id;
  });

  it('lists it for students', async () => {
    const res = await call('/assessments', { token: studentToken });
    expect(res.body.assessments.map((a: { id: number }) => a.id)).toContain(assessmentId);
  });

  it('starts an attempt', async () => {
    const res = await call(`/assessments/${assessmentId}/start`, { method: 'POST', token: studentToken });
    expect(res.status).toBe(200);
    attemptId = res.body.attempt.id;
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.attempt.maxScore).toBe(10);
  });

  it('scores an answer', async () => {
    const res = await call(`/assessments/attempts/${attemptId}/answer`, {
      method: 'POST', token: studentToken,
      body: JSON.stringify({ questionId, code: 'for n in numbers:\n    print(n)' }),
    });
    expect(res.body.result.isCorrect).toBe(true);
    expect(res.body.earned).toBe(10);
  });

  it('submits the attempt and produces a report', async () => {
    const res = await call(`/assessments/attempts/${attemptId}/submit`, { method: 'POST', token: studentToken });
    expect(res.body.attempt.status).toBe('submitted');
    expect(res.body.attempt.score).toBe(10);
    expect(res.body.result[0].qid).toBe('PY-LOOPS-9001');
  });

  it('refuses a second attempt once the limit is reached', async () => {
    const res = await call(`/assessments/${assessmentId}/start`, { method: 'POST', token: studentToken });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attempt/i);
  });
});
