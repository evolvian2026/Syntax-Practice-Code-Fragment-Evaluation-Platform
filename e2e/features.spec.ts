import { expect, test } from '@playwright/test';
import { ACCOUNTS, openQuestion, signIn, submit, typeFragment, verdict } from './helpers';

/**
 * The five features layered on top of the platform, driven through the UI:
 * question health, construct mastery, spaced repetition, misconception hints
 * and deriving a question from a working program.
 */

test.describe('question health', () => {
  test.beforeEach(async ({ page }) => signIn(page, ACCOUNTS.admin));

  test('sweeps the seeded bank and reports every question healthy', async ({ page }) => {
    await page.goto('/admin/health');
    await page.getByRole('button', { name: /Run sweep/ }).click();

    // The sweep runs every seeded question's reference solution for real.
    await expect(page.getByText(/Checked \d+ questions/)).toBeVisible({ timeout: 300_000 });

    const summary = await page.getByText(/Checked \d+ questions/).innerText();
    const failing = Number(/(\d+) failing/.exec(summary)?.[1] ?? '-1');
    expect(failing, `sweep reported failures: ${summary}`).toBe(0);
  });

  test('a question whose reference solution fails is reported on save', async ({ page }) => {
    await page.goto('/admin/questions/new');
    await page.getByLabel('Title').fill('Deliberately rotten question');
    await page.getByLabel('Statement').fill('Its expected output is not what the solution prints.');
    await page.getByLabel('Topic', { exact: true }).selectOption('loops');
    await page.getByLabel('Status').selectOption('published');

    await page.getByRole('tab', { name: 'Code template' }).click();
    await page.getByLabel('Starter code (shown to the student)')
      .fill('numbers = [1, 2, 3]\n\n{{STUDENT_CODE}}');

    await page.getByRole('tab', { name: 'Test cases' }).click();
    await page.getByLabel('Expected output').first().fill('this is never printed');

    await page.getByRole('tab', { name: 'Hints & solution' }).click();
    await page.getByLabel('Reference solution code').fill('for n in numbers:\n    print(n)');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Save question/ }).click();

    await expect(page.getByText(/reference solution fails/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/students can open a question nobody can answer/i)).toBeVisible();
  });
});

test.describe('construct mastery', () => {
  test('records the constructs a solved question used', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for number in numbers:\n    print(number)');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    await page.goto('/mastery');
    await expect(page.getByRole('heading', { name: 'Mastery' })).toBeVisible();
    await expect(page.getByText('FOR_LOOP').first()).toBeVisible();

    // Solved with a for loop, so it must not also be listed as a gap.
    const gapPanel = page.locator('.card', { hasText: 'Not written correctly yet' });
    if (await gapPanel.count() > 0) {
      await expect(gapPanel.getByText('FOR_LOOP', { exact: true })).toHaveCount(0);
    }
  });

  test('shows constructs never yet written correctly as gaps', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/mastery');
    await expect(page.getByRole('heading', { name: 'Mastery' })).toBeVisible();
    await expect(page.getByText(/Proficient|Developing|Not yet/).first()).toBeVisible();
  });
});

test.describe('spaced repetition', () => {
  test('schedules a solved question and shows it in the queue', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await openQuestion(page, 'PY-BASICS-0002');
    await typeFragment(page, 'age = 25');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    // The banner tells the student when it comes back.
    await expect(page.getByText(/Scheduled for review on \d{4}-\d{2}-\d{2}/)).toBeVisible();

    await page.goto('/mastery');
    await page.getByRole('tab', { name: /Review queue/ }).click();
    await expect(page.getByText(/scheduled|due/i).first()).toBeVisible();
  });
});

test.describe('misconception hints', () => {
  test('an authored misconception reaches the student who makes that mistake', async ({ page, browser }) => {
    await signIn(page, ACCOUNTS.admin);

    // Find the loop question and attach a misconception to it.
    await page.goto('/admin/questions?search=Print every number');
    await page.getByRole('link', { name: /Print every number/ }).first().click();
    await page.waitForURL(/\/admin\/questions\/\d+/);

    await page.getByRole('tab', { name: 'Misconceptions' }).click();
    await page.getByRole('button', { name: /Add misconception/ }).click();
    await page.getByLabel('What the student did').fill('Printed the list instead of looping');
    await page.getByLabel('Hint shown when it matches')
      .fill('That prints the whole list at once. Write the loop so each number prints on its own line.');
    await page.getByLabel('Constructs the answer must NOT contain').fill('FOR_LOOP');
    await page.getByRole('button', { name: /Save misconceptions/ }).click();
    await expect(page.getByText(/Matched|Add misconception/).first()).toBeVisible();

    // A student who makes exactly that mistake is told about it.
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const student = await context.newPage();
    await signIn(student, ACCOUNTS.student);
    await openQuestion(student, 'PY-LOOPS-0001');
    await typeFragment(student, 'print(numbers)');
    await submit(student);

    await expect(student.getByText('Printed the list instead of looping')).toBeVisible();
    await expect(student.getByText(/Write the loop so each number prints/)).toBeVisible();
    await context.close();
  });

  test('a correct answer is never given a misconception hint', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for number in numbers:\n    print(number)');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
    await expect(page.getByText('Printed the list instead of looping')).toHaveCount(0);
  });
});

test.describe('deriving a question from a program', () => {
  test('derives template, constructs and output, then a student solves it', async ({ page, browser }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/questions/new');

    const title = `Derived question ${Date.now()}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Statement').fill('Write the loop that squares each number.');
    await page.getByLabel('Topic', { exact: true }).selectOption('loops');
    await page.getByLabel('Status').selectOption('published');

    await page.getByRole('tab', { name: 'From a program' }).click();
    await page.getByLabel('Complete, working program').fill(
      'numbers = [1, 2, 3]\n\nfor n in numbers:\n    print(n * n)\n\nprint("Done")',
    );

    // Select lines 3-4 — the loop the student will write.
    const lines = page.locator('button', { has: page.locator('span.w-8') });
    await lines.nth(2).click();
    await lines.nth(3).click();
    await expect(page.getByText('Student writes lines 3–4')).toBeVisible();

    await page.getByRole('button', { name: /Derive question/ }).click();

    // Everything comes from the program itself.
    await expect(page.getByText('{{STUDENT_CODE}}').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('FOR_LOOP').first()).toBeVisible();
    await expect(page.getByText('1\n4\n9\nDone').first()).toBeVisible();

    await page.getByRole('button', { name: /^Use this$/ }).click();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Save question/ }).click();
    await page.waitForURL(/\/admin\/questions\/\d+/);
    await expect(page.getByText(/reference solution passes/i)).toBeVisible({ timeout: 60_000 });

    const qid = (await page.getByRole('heading', { name: /Edit / }).innerText()).replace('Edit ', '').trim();

    // The derived question works for a student, wrong construct and all.
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const student = await context.newPage();
    await signIn(student, ACCOUNTS.student);
    await openQuestion(student, qid);

    await typeFragment(student, 'print(1)\nprint(4)\nprint(9)');
    await submit(student);
    expect(await verdict(student)).toMatch(/Wrong construct/i);

    await typeFragment(student, 'for n in numbers:\n    print(n * n)');
    await submit(student);
    expect(await verdict(student)).toMatch(/Correct/i);
    await context.close();
  });
});
