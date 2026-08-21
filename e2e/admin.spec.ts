import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, openQuestion, signIn, signOut, submit, typeFragment, verdict,
} from './helpers';

/**
 * The admin journey: authoring a question with no developer involvement,
 * managing the bank, running an assessment and reading analytics.
 */

test.describe('access control', () => {
  test('a student cannot reach the admin area', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

    await page.goto('/admin/questions');
    await page.waitForURL('**/practice');
  });

  test('an admin sees the admin navigation', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    const adminLink = page.getByRole('link', { name: 'Admin', exact: true });
    await expect(adminLink).toBeVisible();
    await adminLink.click();
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
    await expect(page.getByText('staff area')).toBeVisible();
  });
});

test.describe('admin overview', () => {
  test.beforeEach(async ({ page }) => signIn(page, ACCOUNTS.admin));

  test('shows platform totals and shortcuts', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Published questions')).toBeVisible();

    const published = Number(
      await page.locator('.card', { hasText: 'Published questions' }).first().locator('.text-2xl').innerText(),
    );
    expect(published).toBeGreaterThanOrEqual(140);

    const stats = page.locator('.card').filter({ hasText: /^(Students|Submissions)/ });
    await expect(stats.filter({ hasText: 'Students' }).first()).toBeVisible();
    await expect(stats.filter({ hasText: 'Submissions' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /New question/ })).toBeVisible();
  });
});

test.describe('question management', () => {
  test.beforeEach(async ({ page }) => signIn(page, ACCOUNTS.admin));

  test('lists and filters the bank', async ({ page }) => {
    await page.goto('/admin/questions');
    await expect(page.getByText(/\d+ questions/)).toBeVisible();

    await page.getByRole('combobox').first().selectOption('mysql');
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.waitForTimeout(500);

    const languages = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
    expect(languages.length).toBeGreaterThan(0);
    for (const cell of languages) expect(cell).toContain('SQL');
  });

  test('verifies a stored reference solution', async ({ page }) => {
    await page.goto('/admin/questions?search=Print every number');
    await page.getByRole('button', { name: 'Verify' }).first().click();
    await expect(page.getByText(/reference solution passes every test case/i)).toBeVisible({ timeout: 45_000 });
  });

  test('authors a new question end to end and a student can then solve it', async ({ page, context }) => {
    const marker = Date.now();
    const title = `E2E squares ${marker}`;

    await page.goto('/admin/questions/new');
    await expect(page.getByRole('heading', { name: 'New question' })).toBeVisible();

    // --- content
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Statement').fill('Write a for loop that prints each number squared.');
    await page.getByLabel('Instructions (optional)').fill('The list is provided. Write only the loop.');
    await page.getByLabel('Language').selectOption('python');
    await page.getByLabel('Topic').selectOption('loops');
    await page.getByLabel('Subtopic').selectOption('for');
    await page.getByLabel('Difficulty').selectOption('Easy');
    await page.getByLabel('Question type').selectOption('COMPLETE_LOOP');
    await page.getByLabel('Evaluation type').selectOption('OUTPUT');
    await page.getByLabel('Status').selectOption('published');

    // --- template
    await page.getByRole('tab', { name: 'Code template' }).click();
    await expect(page.getByText('{{STUDENT_CODE}} present')).toBeVisible();
    await page.getByLabel('Starter code (shown to the student)')
      .fill('{{SETUP_CODE}}\n\n{{STUDENT_CODE}}\n\nprint("End")');

    // --- grading
    await page.getByRole('tab', { name: 'Grading rules' }).click();
    await page.getByPlaceholder(/Or type custom ids/).first().fill('FOR_LOOP');

    // --- tests, including a hidden one
    await page.getByRole('tab', { name: 'Test cases' }).click();
    await page.getByLabel('Setup code / extra rows ({{SETUP_CODE}})').first().fill('numbers = [1, 2, 3]');
    await page.getByLabel('Expected output').first().fill('1\n4\n9\nEnd');
    await page.getByRole('button', { name: /Add test case/ }).click();
    await page.getByLabel('Setup code / extra rows ({{SETUP_CODE}})').nth(1).fill('numbers = [5]');
    await page.getByLabel('Expected output').nth(1).fill('25\nEnd');

    // --- hints, explanation, solution
    await page.getByRole('tab', { name: 'Hints & solution' }).click();
    await page.getByPlaceholder('Hint 1').fill('Square a number by multiplying it by itself.');
    await page.getByLabel(/Explanation shown after submission/).fill('Each iteration squares the current item.');
    await page.locator('textarea.font-mono').last().fill('for n in numbers:\n    print(n * n)');

    // --- dry-run against the real engine before saving
    await page.getByRole('tab', { name: 'Preview & test' }).click();
    await page.getByRole('button', { name: /Load reference solution/ }).click();
    await page.getByRole('button', { name: /Test question/ }).click();
    await expect(page.getByText('Correct', { exact: false }).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('✓ Required construct')).toBeVisible();

    // --- save
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Save question/ }).click();
    await page.waitForURL(/\/admin\/questions\/\d+/);
    await expect(page.getByRole('heading', { name: /Edit PYT?-LOOPS-\d+/ })).toBeVisible();
    const qid = (await page.getByRole('heading', { name: /Edit / }).innerText()).replace('Edit ', '').trim();

    // --- a student can now practise it, with no code change anywhere
    const studentPage = await context.newPage();
    await signIn(studentPage, ACCOUNTS.student);
    await openQuestion(studentPage, qid);
    await expect(studentPage.getByText(title)).toBeVisible();
    await expect(studentPage.getByText('numbers = [1, 2, 3]')).toBeVisible();

    await typeFragment(studentPage, 'print(1)\nprint(4)\nprint(9)');
    await submit(studentPage);
    expect(await verdict(studentPage)).toMatch(/Wrong construct/i);

    await typeFragment(studentPage, 'for n in numbers:\n    print(n * n)');
    await submit(studentPage);
    expect(await verdict(studentPage)).toMatch(/Correct/i);
    await studentPage.close();
  });

  test('duplicates a question as an editable draft', async ({ page }) => {
    await page.goto('/admin/questions?search=Print every number in a list');
    await page.getByRole('button', { name: 'Duplicate' }).first().click();
    await page.waitForURL(/\/admin\/questions\/\d+/);
    await expect(page.getByLabel('Title')).toHaveValue(/\(copy\)$/);
    await expect(page.getByLabel('Status')).toHaveValue('draft');
  });

  test('refuses a template without the student marker', async ({ page }) => {
    await page.goto('/admin/questions/new');
    await page.getByLabel('Title').fill('Broken template');
    await page.getByLabel('Statement').fill('This template is missing its marker.');
    await page.getByLabel('Topic').selectOption('loops');

    await page.getByRole('tab', { name: 'Code template' }).click();
    await page.getByLabel('Starter code (shown to the student)').fill('print("no marker here")');
    await expect(page.getByText('{{STUDENT_CODE}} missing')).toBeVisible();

    await page.getByRole('button', { name: /Save question/ }).click();
    await expect(page.getByText(/must contain the \{\{STUDENT_CODE\}\} marker/i)).toBeVisible();
  });

  test('deletes a question', async ({ page }) => {
    await page.goto('/admin/questions?search=Broken');
    // Create something disposable first.
    await page.goto('/admin/questions/new');
    await page.getByLabel('Title').fill('Disposable question');
    await page.getByLabel('Statement').fill('This one exists only to be deleted.');
    await page.getByLabel('Topic').selectOption('loops');
    await page.getByLabel('Evaluation type').selectOption('AST');
    await page.getByRole('tab', { name: 'Grading rules' }).click();
    await page.getByPlaceholder(/Or type custom ids/).first().fill('FOR_LOOP');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Save question/ }).click();
    await page.waitForURL(/\/admin\/questions\/\d+/);

    await page.goto('/admin/questions?search=Disposable question');
    await expect(page.getByText('Disposable question')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByText('Disposable question')).toHaveCount(0);
  });
});

test.describe('import and export', () => {
  test.beforeEach(async ({ page }) => signIn(page, ACCOUNTS.admin));

  test('validates an import before applying it, then imports', async ({ page }) => {
    await page.goto('/admin/import-export');

    const payload = JSON.stringify({
      questions: [
        {
          qid: 'E2E-IMPORT-0001',
          language: 'python', topic: 'loops', difficulty: 'Easy',
          questionType: 'COMPLETE_LOOP', evaluationType: 'OUTPUT',
          title: 'Imported loop question',
          statement: 'Print each number in the list.',
          starterCode: 'numbers = [7, 8]\n\n{{STUDENT_CODE}}',
          requiredConstructs: ['FOR_LOOP'],
          testCases: [{ visibility: 'public', expectedOutput: '7\n8', matcher: 'trimmed' }],
          solutions: [{ code: 'for n in numbers:\n    print(n)', isPrimary: true }],
          status: 'published',
        },
        {
          language: 'python', topic: 'does-not-exist', difficulty: 'Easy',
          questionType: 'FILL_CODE', evaluationType: 'AST',
          title: 'Bad topic question',
          statement: 'This row names a topic that does not exist.',
          starterCode: '{{STUDENT_CODE}}',
          requiredConstructs: ['FOR_LOOP'],
        },
      ],
    });

    await page.getByPlaceholder(/"questions"/).fill(payload);
    await page.getByRole('button', { name: /Validate only/ }).click();
    await expect(page.getByText(/1 failed/)).toBeVisible();
    await expect(page.getByText(/Unknown topic/)).toBeVisible();

    await page.getByRole('button', { name: /^Import$/ }).click();
    await expect(page.getByText(/1 created/)).toBeVisible();

    await page.goto('/admin/questions?search=Imported loop question');
    await expect(page.getByText('E2E-IMPORT-0001')).toBeVisible();
  });

  test('exports the bank as JSON', async ({ page }) => {
    await page.goto('/admin/import-export');
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: /Download questions-export/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('questions-export.json');

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(parsed.questions.length).toBeGreaterThanOrEqual(140);
    expect(parsed.questions[0]).toHaveProperty('starterCode');
    expect(JSON.stringify(parsed)).toContain('{{STUDENT_CODE}}');
  });
});

test.describe('assessments', () => {
  const title = `E2E assessment ${Date.now()}`;

  test('an admin composes one and a student takes it', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/assessments');
    await page.getByRole('button', { name: /New assessment/ }).click();

    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Duration (minutes)').fill('20');
    await page.getByLabel('Status').selectOption('published');

    await page.getByPlaceholder('Search…').fill('Print every number in a list');
    await page.waitForTimeout(800);
    await page.locator('input[type="checkbox"]').first().check();
    await expect(page.getByText(/1 picked/)).toBeVisible();

    await page.getByRole('button', { name: /Create assessment/ }).click();
    await expect(page.getByText(title)).toBeVisible();

    // --- student takes it
    const studentPage = await context.newPage();
    await signIn(studentPage, ACCOUNTS.student);
    await studentPage.goto('/assessments');
    await expect(studentPage.getByText(title)).toBeVisible();

    await studentPage.locator('div.card', { hasText: title }).getByRole('button', { name: /Start/ }).click();
    await studentPage.waitForURL(/\/assessments\/\d+/);
    await expect(studentPage.getByText(/Question 1 of 1/)).toBeVisible();
    await expect(studentPage.getByText(/⏱ \d\d:\d\d/)).toBeVisible();

    await typeFragment(studentPage, 'for n in numbers:\n    print(n)');
    await studentPage.getByRole('button', { name: /Save answer/ }).click();
    await expect(studentPage.getByText(/10\/10 points/)).toBeVisible({ timeout: 45_000 });

    await studentPage.getByRole('button', { name: /Finish & submit/ }).click();
    await expect(studentPage.getByText('Assessment complete')).toBeVisible();
    await expect(studentPage.getByText('10', { exact: false }).first()).toBeVisible();

    // --- admin sees the result
    await page.goto('/admin/assessments');
    await page.locator('tr', { hasText: title }).getByRole('button', { name: 'Results' }).click();
    await expect(page.getByRole('cell', { name: 'Sam Student' })).toBeVisible();
    await expect(page.getByText('submitted').first()).toBeVisible();
    await studentPage.close();
  });
});

test.describe('students and analytics', () => {
  test.beforeEach(async ({ page }) => signIn(page, ACCOUNTS.admin));

  test('the roster drills down into one student', async ({ page }) => {
    await page.goto('/admin/students');
    await expect(page.getByText('Sam Student')).toBeVisible();
    await page.getByText('Sam Student').click();

    await expect(page.getByText('solved')).toBeVisible();
    await expect(page.getByText('accuracy')).toBeVisible();
    await expect(page.getByText('Recent attempts')).toBeVisible();
  });

  test('creates a student account that can then sign in', async ({ page, context }) => {
    const email = `e2e-created-${Date.now()}@example.com`;
    await page.goto('/admin/students');
    await page.getByRole('button', { name: /Add student/ }).click();
    await page.getByPlaceholder('Full name').fill('Created By Admin');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill('created123');
    await page.getByPlaceholder('Batch').fill('Batch E2E');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByText('Created By Admin')).toBeVisible();

    const newPage = await context.newPage();
    await signIn(newPage, { email, password: 'created123' });
    await expect(newPage.getByRole('link', { name: /Practice/ }).first()).toBeVisible();
    await newPage.close();
  });

  test('analytics rank questions, topics and errors', async ({ page }) => {
    await page.goto('/admin/analytics');
    await expect(page.getByRole('tab', { name: 'Question stats' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();

    await page.getByRole('button', { name: 'most attempted' }).click();
    await page.waitForTimeout(600);
    await expect(page.locator('tbody tr').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Topic accuracy' }).click();
    await expect(page.getByText(/Weakest concepts/)).toBeVisible();

    await page.getByRole('tab', { name: 'Common errors' }).click();
    await expect(page.locator('li').first()).toBeVisible();
  });
});

test.describe('sign out', () => {
  test('clears the session', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.goto('/progress');
    await page.waitForURL('**/login');
  });
});
