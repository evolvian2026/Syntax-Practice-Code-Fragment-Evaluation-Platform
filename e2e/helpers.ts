import { expect, type Page, type Response } from '@playwright/test';

/** Shared page objects for the end-to-end suite. */

export const ACCOUNTS = {
  student: { email: 'student@syntaxpractice.dev', password: 'student123' },
  admin: { email: 'admin@syntaxpractice.dev', password: 'admin123' },
};

export async function signIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.waitForURL('**/practice', { timeout: 30_000 });
}

/** Clears the stored session. The page must already be on the app origin. */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
}

/** Opens a question and waits for the fragment editor to be interactive. */
export async function openQuestion(page: Page, qid: string): Promise<void> {
  await page.goto(`/practice/${qid}`);
  await expect(page.getByText(qid, { exact: false }).first()).toBeVisible();
  await expect(editableTextarea(page)).toBeAttached({ timeout: 60_000 });
  await expect(page.locator('div.relative.border-y-2 .view-lines')).toBeVisible();
}

/**
 * The editable region's hidden Monaco textarea. Provided-code panes are
 * read-only editors inside `.select-none`; the editable one lives inside the
 * dashed-bordered container.
 */
export function editableTextarea(page: Page) {
  return page.locator('div.relative.border-y-2 textarea.inputarea');
}

/** The read-only provided-code panes above and below the editable region. */
export function providedCode(page: Page) {
  return page.locator('.select-none .monaco-editor');
}

/**
 * Replaces the fragment.
 *
 * The whole string goes in with one `insertText` call: typing it key by key
 * would let Monaco re-indent as it went. Monaco still normalises line endings
 * and may deepen the indentation of a block body, so the check afterwards
 * compares the content of each line rather than a byte count.
 */
export async function typeFragment(page: Page, code: string): Promise<void> {
  const textarea = editableTextarea(page);
  await textarea.click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);

  const expected = code.split('\n').map((line) => line.trim()).filter(Boolean);
  await expect
    .poll(
      async () => (await readFragment(page)).split('\n').map((line) => line.trim()).filter(Boolean),
      { timeout: 15_000, message: `editor should hold the fragment ${JSON.stringify(code)}` },
    )
    .toEqual(expected);
}

/**
 * The fragment as rendered.
 *
 * Monaco recycles `.view-line` nodes, so DOM order does not track visual order:
 * the lines are sorted by vertical offset before being joined.
 */
export async function readFragment(page: Page): Promise<string> {
  return page.evaluate(() => {
    const container = document.querySelector('div.relative.border-y-2 .view-lines');
    if (!container) return '';
    const NBSP = String.fromCharCode(160);
    return Array.from(container.querySelectorAll<HTMLElement>('.view-line'))
      .map((el) => ({
        top: parseFloat(el.style.top || '0'),
        text: (el.innerText ?? '').split(NBSP).join(' '),
      }))
      .sort((a, b) => a.top - b.top)
      .map((line) => line.text)
      .join('\n');
  });
}

/** Clicks Submit and waits for the evaluation to come back. */
export async function submit(page: Page): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => /\/(submit|answer)$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 90_000 },
    ),
    page.getByRole('button', { name: /Submit|Save answer/ }).first().click(),
  ]);
  await expect(page.getByRole('button', { name: /Checking/ })).toHaveCount(0, { timeout: 30_000 });
  return response;
}

/** Clicks Run and waits for the evaluation to come back. */
export async function run(page: Page): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/run') && r.request().method() === 'POST', { timeout: 90_000 }),
    page.getByRole('button', { name: /Run/ }).click(),
  ]);
  await expect(page.getByRole('button', { name: /Running/ })).toHaveCount(0, { timeout: 30_000 });
  return response;
}

const banner = (page: Page) => page.locator('.animate-fade-in').first();

/** The verdict shown in the result banner, e.g. "Correct". */
export async function verdict(page: Page): Promise<string> {
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  return (await banner(page).locator('.chip').first().innerText()).trim();
}

export async function feedback(page: Page): Promise<string> {
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  return banner(page).locator('span.text-sm.font-medium').first().innerText();
}

export async function score(page: Page): Promise<string> {
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  return banner(page).locator('.font-mono').first().innerText();
}

export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(name, 'i') }).click();
}

/**
 * Records submissions straight through the API.
 *
 * Analytics and the roster only have something to rank once students have
 * practised, and `admin.spec.ts` runs before `student.spec.ts`. Seeding that
 * history through the UI would cost minutes, so tests that need it post the
 * attempts directly.
 */
export async function seedSubmissions(
  page: Page,
  attempts: Array<{ qid: string; code: string }>,
): Promise<void> {
  const origin = new URL(page.url()).origin;
  const login = await page.request.post(`${origin}/api/auth/login`, { data: ACCOUNTS.student });
  const { token } = (await login.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };

  const list = await page.request.get(`${origin}/api/practice/questions?limit=200`, { headers });
  const { questions } = (await list.json()) as { questions: Array<{ id: number; qid: string }> };

  for (const attempt of attempts) {
    const question = questions.find((q) => q.qid === attempt.qid);
    if (!question) throw new Error(`seedSubmissions: no question ${attempt.qid}`);
    await page.request.post(`${origin}/api/practice/questions/${question.id}/submit`, {
      headers,
      data: { code: attempt.code, timeSpentMs: 5_000 },
    });
  }
}

/**
 * A polling assertion on the fragment.
 *
 * A freshly mounted Monaco paints in stages, so a single read can catch a
 * half-rendered line — one read of a prefilled editor returned just "f" of
 * "for n in numbers". Every assertion about editor content polls until it
 * settles.
 *
 *   await expectFragment(page).toContain('for n in numbers');
 */
export function expectFragment(page: Page, message = 'editor content should settle') {
  return expect.poll(async () => (await readFragment(page)).trim(), { timeout: 15_000, message });
}
