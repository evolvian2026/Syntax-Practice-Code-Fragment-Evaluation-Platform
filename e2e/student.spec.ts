import { expect, test } from '@playwright/test';
import {
  ACCOUNTS, expectFragment, feedback, openQuestion, openTab, providedCode, run, score,
  signIn, signOut, submit, typeFragment, verdict,
} from './helpers';

/**
 * The student journey, end to end, against the real evaluation sandbox.
 */

test.describe('authentication', () => {
  test('rejects bad credentials and accepts good ones', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(ACCOUNTS.student.email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
    await page.getByRole('button', { name: /^Sign in$/ }).click();
    await expect(page.getByText(/Email or password is incorrect/i)).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(ACCOUNTS.student.password);
    await page.getByRole('button', { name: /^Sign in$/ }).click();
    await page.waitForURL('**/practice');
    await expect(page.getByRole('link', { name: /Practice/ }).first()).toBeVisible();
  });

  test('registers a brand-new student and starts them at zero', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto('/login');
    await page.getByRole('button', { name: /Create an account/ }).click();
    await page.getByLabel('Full name').fill('E2E Newcomer');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('secret123');
    await page.getByRole('button', { name: /Create account/ }).click();
    await page.waitForURL('**/practice');

    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible();
    await expect(page.getByText('Solved').first()).toBeVisible();
    const solved = await page.locator('.card', { hasText: 'Solved' }).first().locator('.text-2xl').innerText();
    expect(solved.trim()).toBe('0');
  });

  test('redirects an anonymous visitor to the login page', async ({ page }) => {
    await signOut(page);
    await page.goto('/progress');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: /Sign in to practise/ })).toBeVisible();
  });
});

test.describe('browsing the question bank', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
  });

  test('lists every seeded language with counts', async ({ page }) => {
    await expect(page.getByRole('button', { name: /All languages/ })).toBeVisible();
    for (const language of ['Python', 'SQL / MySQL', 'Java', 'C++', 'JavaScript', 'HTML', 'CSS']) {
      await expect(page.getByRole('button', { name: new RegExp(language.replace('+', '\\+')) }).first()).toBeVisible();
    }
    await expect(page.getByText(/\d+ solved/)).toBeVisible();
  });

  test('filters by language, topic and difficulty', async ({ page }) => {
    await page.getByRole('button', { name: /Python/ }).first().click();
    await expect(page).toHaveURL(/language=python/);
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();

    await page.getByRole('button', { name: /^Loops/ }).first().click();
    await expect(page).toHaveURL(/topic=loops/);

    const cards = page.locator('a[href^="/practice/"]');
    const beforeDifficulty = await cards.count();
    await page.getByRole('button', { name: 'Hard', exact: true }).click();
    await expect(page).toHaveURL(/difficulty=Hard/);

    // The URL changes as soon as the button is clicked, but the list is
    // refetched — counting straight away reads the unfiltered list.
    await expect
      .poll(() => cards.count(), { timeout: 15_000, message: 'the list should shrink once filtered' })
      .toBeLessThan(beforeDifficulty);
    expect(await cards.count()).toBeGreaterThan(0);

    for (const card of await page.locator('a[href^="/practice/"]').all()) {
      await expect(card.getByText('Hard', { exact: true })).toBeVisible();
    }
  });

  test('searches by title', async ({ page }) => {
    await page.getByPlaceholder(/Search questions/).fill('JOIN');
    await page.keyboard.press('Enter');
    await expect(page.locator('a[href^="/practice/"]').first()).toBeVisible();
    const titles = await page.locator('a[href^="/practice/"]').allInnerTexts();
    expect(titles.join(' ')).toMatch(/JOIN/i);
  });
});

test.describe('the core practice loop', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
  });

  test('shows the provided code around a protected editable region', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');

    await expect(page.getByText('PROVIDED CODE')).toBeVisible();
    await expect(page.getByText('YOUR CODE')).toBeVisible();
    await expect(page.getByText('numbers = [1, 2, 3, 4, 5]')).toBeVisible();
    await expect(page.getByText('print("Done")')).toBeVisible();
    await expect(page.locator('p', { hasText: 'Must use:' })).toContainText('FOR loop');
    await expect(page.getByText(/1 public, 2 hidden/)).toBeVisible();

    // The template marker itself is never shown to the student.
    await expect(page.locator('body')).not.toContainText('{{STUDENT_CODE}}');
    await expect(page.locator('body')).not.toContainText('{{SETUP_CODE}}');
  });

  test('protected code cannot be edited', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    const providedPane = providedCode(page).first();
    const before = await providedPane.innerText();

    await providedPane.click({ force: true });
    await page.keyboard.type('CORRUPTED');
    await page.waitForTimeout(300);

    expect(await providedPane.innerText()).toBe(before);
  });

  test('Run exercises only the public test', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for n in numbers:\n    print(n)');
    await run(page);

    expect(await verdict(page)).toMatch(/Correct/i);
    await openTab(page, 'Test cases');
    const testPanel = page.locator('.card').filter({ has: page.getByRole('tab', { name: /Test cases/ }) });
    await expect(testPanel.getByText('Test 1')).toBeVisible();
    await expect(testPanel.getByText('hidden')).toHaveCount(0);
  });

  test('Submit runs the hidden tests too and awards XP', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for n in numbers:\n    print(n)');
    await submit(page);

    expect(await verdict(page)).toMatch(/Correct/i);
    expect(await score(page)).toMatch(/100\/100/);

    await openTab(page, 'Test cases');
    await expect(page.getByText('hidden').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /Test cases/ })).toContainText('3/3');
  });

  test('correct output with the wrong construct is rejected', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'print(*numbers, sep="\\n")');
    await submit(page);

    expect(await verdict(page)).toMatch(/Wrong construct/i);
    expect(await feedback(page)).toMatch(/Output is correct, but/i);
    expect(await score(page)).toMatch(/0\/100/);

    // Every test passed, yet the construct stage failed — that is the point.
    await expect(page.getByText('✗ Required construct')).toBeVisible();
    await expect(page.getByText('✓ Test cases')).toBeVisible();
  });

  test('a syntax error is reported with the message and location', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for n in numbers\n    print(n)');
    await submit(page);

    expect(await verdict(page)).toMatch(/Syntax error/i);
    expect(await feedback(page)).toMatch(/expected ':'/);
  });

  test('a runtime error names the exception', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for n in numbers:\n    print(n / 0)');
    await submit(page);

    expect(await verdict(page)).toMatch(/Runtime error/i);
    expect(await feedback(page)).toMatch(/ZeroDivisionError/);
  });

  test('an infinite loop is stopped at the time limit', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0004');
    await typeFragment(page, 'while True:\n    pass');
    await submit(page);

    expect(await verdict(page)).toMatch(/Timed out/i);
    expect(await feedback(page)).toMatch(/did not finish/i);
  });

  test('restricted code is blocked before it runs', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'import os\nos.system("ls")');
    await submit(page);

    expect(await verdict(page)).toMatch(/Restricted/i);
    expect(await feedback(page)).toMatch(/not allowed/i);
  });

  test('a hardcoded answer passes the visible test and fails a hidden one', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for n in [1, 2, 3, 4, 5]:\n    print(n)');
    await submit(page);

    expect(await verdict(page)).toMatch(/Wrong output/i);
    expect(await feedback(page)).toMatch(/hidden test/i);

    await openTab(page, 'Test cases');
    const testPanel = page.locator('.card').filter({ has: page.getByRole('tab', { name: /Test cases/ }) });
    await expect(testPanel.getByText('hidden').first()).toBeVisible();
    await expect(testPanel.getByText('Hidden test case failed.').first()).toBeVisible();
    // A hidden test never discloses what it expected.
    await expect(testPanel.getByText('Expected', { exact: true })).toHaveCount(0);
  });

  test('the generated program is shown for transparency', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0001');
    await typeFragment(page, 'for n in numbers:\n    print(n)');
    await run(page);
    await openTab(page, 'Generated code');

    const generated = await page.locator('pre').first().innerText();
    expect(generated).toContain('numbers = [1, 2, 3, 4, 5]');
    expect(generated).toContain('for n in numbers:');
    expect(generated).toContain('print("Done")');
  });

  test('hints unlock one at a time and reduce the score', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0002');
    await expect(page.getByRole('button', { name: /Hint \(3 left\)/ })).toBeVisible();

    await page.getByRole('button', { name: /Hint/ }).click();
    await expect(page.getByText(/Which loop|range|generates/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Hint \(2 left\)/ })).toBeVisible();

    await typeFragment(page, 'for i in range(1, 6):\n    print(i)');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
    // One hint used: 15% deducted.
    expect(await score(page)).toMatch(/85\/100/);
  });

  test('the explanation and alternative solutions unlock after solving', async ({ page }) => {
    await openQuestion(page, 'PY-LISTS-0002');
    await openTab(page, 'Explanation');
    await expect(page.getByText(/unlock once you solve/i)).toBeVisible();

    await typeFragment(page, 'first = fruits[0]');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    await openTab(page, 'Explanation');
    await expect(page.getByText(/positions start at 0/i)).toBeVisible();
    await expect(page.getByText('Your answer')).toBeVisible();
  });

  test('revealing the solution scores the question zero', async ({ page }) => {
    await openQuestion(page, 'PY-LISTS-0003');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Show solution/ }).click();

    await expect(page.locator('pre', { hasText: 'fruits[-1]' }).first()).toBeVisible();

    await typeFragment(page, 'last = fruits[-1]');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
    expect(await score(page)).toMatch(/0\/100/);
  });

  test('Reset restores the editor to its starting state', async ({ page }) => {
    await openQuestion(page, 'PY-BASICS-0001');
    await typeFragment(page, 'name = "Nonsense"');
    await page.getByRole('button', { name: /Reset/ }).click();
    await expectFragment(page, 'Reset should empty the editor').toBe('');
  });

  test('moves to the next unsolved question in the topic', async ({ page }) => {
    await openQuestion(page, 'PY-BASICS-0002');
    await typeFragment(page, 'age = 25');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    const before = page.url();
    await page.getByRole('button', { name: /Next question/ }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
    expect(page.url()).not.toContain('PY-BASICS-0002');
  });
});

test.describe('other languages and question types', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
  });

  test('SQL: the schema browser is shown and a JOIN fragment is graded', async ({ page }) => {
    await openQuestion(page, 'MYS-INNERJ-0001');

    await expect(page.getByRole('heading', { name: 'Company HR' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Employees/ })).toBeVisible();
    await expect(providedCode(page).first()).toContainText('SELECT');

    await typeFragment(page, 'JOIN Departments d ON e.department_id = d.department_id');
    await submit(page);

    expect(await verdict(page)).toMatch(/Correct/i);
    await openTab(page, 'Output');
    await expect(page.getByRole('cell', { name: 'Anita Sharma' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'department_name' })).toBeVisible();
  });

  test('SQL: an injection attempt is blocked', async ({ page }) => {
    await openQuestion(page, 'MYS-INNERJ-0001');
    await typeFragment(page, 'JOIN Departments d ON 1=1; DROP TABLE Employees;--');
    await submit(page);

    expect(await verdict(page)).toMatch(/Restricted/i);

    // The dataset is untouched: the next correct query still returns rows.
    await typeFragment(page, 'JOIN Departments d ON e.department_id = d.department_id');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });

  test('SQL: a LEFT JOIN question rejects an INNER JOIN', async ({ page }) => {
    await openQuestion(page, 'MYS-LEFTJO-0001');
    await typeFragment(page, 'JOIN Departments d ON e.department_id = d.department_id');
    await submit(page);

    expect(await verdict(page)).toMatch(/Wrong construct/i);
    expect(await feedback(page)).toMatch(/LEFT JOIN/i);

    await typeFragment(page, 'LEFT JOIN Departments d ON e.department_id = d.department_id');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });

  test('SYNTAX: formatting differences are accepted', async ({ page }) => {
    await openQuestion(page, 'PY-LISTS-0001');
    await typeFragment(page, '[5,10,15]');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    await typeFragment(page, '[ 5 , 10 , 15 ]');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    await typeFragment(page, '[5, 10]');
    await submit(page);
    expect(await verdict(page)).not.toMatch(/Correct/i);
  });

  test('HTML: a static markup question is graded structurally', async ({ page }) => {
    await openQuestion(page, 'HTM-ELEMEN-0001');
    await typeFragment(page, `<a href='https://google.com'>Google</a>`);
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    await typeFragment(page, '<a href="https://bing.com">Google</a>');
    await submit(page);
    expect(await verdict(page)).toMatch(/Wrong output/i);
    expect(await feedback(page)).toMatch(/href/i);
  });

  test('CSS: a declaration question accepts an equivalent value', async ({ page }) => {
    await openQuestion(page, 'CSS-TEXT-0001');
    await typeFragment(page, 'font-weight: bold;');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });

  test('JavaScript: an arrow function is graded structurally', async ({ page }) => {
    await openQuestion(page, 'JS-FUNCTI-0001');
    await typeFragment(page, 'n => n * n');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });

  test('C: a condition fragment compiles and runs', async ({ page }) => {
    await openQuestion(page, 'C-CONDIT-0001');
    await typeFragment(page, 'num % 2 == 0');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });

  test('PREDICT_OUTPUT: the answer is typed, not coded', async ({ page }) => {
    await page.goto('/practice/PY-LOOPS-0017');
    await expect(page.getByRole('heading', { name: /Predict the output/ })).toBeVisible();

    const answer = page.getByPlaceholder(/Type the expected output/);
    await answer.fill('2\n4\n6');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);

    await answer.fill('1\n2\n3');
    await submit(page);
    expect(await verdict(page)).toMatch(/Wrong output/i);
  });

  test('FIX_SYNTAX: the broken line is prefilled for repair', async ({ page }) => {
    await openQuestion(page, 'PY-LOOPS-0016');
    await expectFragment(page, 'the broken line should be prefilled').toContain('for n in numbers');

    await typeFragment(page, 'for n in numbers:');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });

  test('CHOOSE_AND_WRITE: an option is offered alongside the editor', async ({ page }) => {
    await openQuestion(page, 'PY-LISTS-0012');
    await expect(page.getByText('Choose the construct')).toBeVisible();
    await page.getByRole('button', { name: 'append()', exact: true }).click();

    await typeFragment(page, 'numbers.append(4)');
    await submit(page);
    expect(await verdict(page)).toMatch(/Correct/i);
  });
});

test.describe('progress, path and history', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
  });

  test('the dashboard reflects solved questions and errors', async ({ page }) => {
    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible();

    const solved = Number(await page.locator('.card', { hasText: 'Solved' }).first().locator('.text-2xl').innerText());
    expect(solved).toBeGreaterThan(0);

    await expect(page.getByText('Error breakdown')).toBeVisible();
    await expect(page.getByText('Wrong construct')).toBeVisible();
    await expect(page.getByText('Python').first()).toBeVisible();

    await page.getByRole('tab', { name: 'By topic' }).click();
    await expect(page.getByText(/Loops/).first()).toBeVisible();

    await expect(page.getByText('Badges')).toBeVisible();
    await expect(page.getByText('First Steps')).toBeVisible();
  });

  test('the learning path unlocks as topics are completed', async ({ page }) => {
    await page.goto('/learning-path');
    await expect(page.getByRole('heading', { name: 'Learning path' })).toBeVisible();
    await expect(page.getByText('Python foundations')).toBeVisible();

    await expect(page.getByText('Basics').first()).toBeVisible();
    await expect(page.getByText(/To unlock:/).first()).toBeVisible();

    await page.getByRole('button', { name: /SQL/ }).click();
    await expect(page.getByText('SQL query builder')).toBeVisible();
  });

  test('the leaderboard ranks the signed-in student', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
    await expect(page.getByText('you', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Sam Student' })).toBeVisible();
  });

  test('submission history stores the fragment and the generated program', async ({ page }) => {
    await page.goto('/submissions');
    await expect(page.getByRole('heading', { name: 'Submission history' })).toBeVisible();

    await page.locator('tbody tr').first().click();
    await expect(page.getByText('Your fragment')).toBeVisible();
    await expect(page.getByText('Generated program')).toBeVisible();
    const generated = await page.locator('pre').nth(1).innerText();
    expect(generated.length).toBeGreaterThan(0);
  });
});

test.describe('presentation', () => {
  test('the theme toggle switches between dark and light', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
    const before = await isDark();

    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    await page.waitForTimeout(300);
    expect(await isDark()).toBe(!before);
  });

  test('the layout works on a tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await signIn(page, ACCOUNTS.student);
    await openQuestion(page, 'PY-LOOPS-0001');

    await expect(page.getByText('PROVIDED CODE')).toBeVisible();
    await expect(page.getByRole('button', { name: /Submit/ })).toBeVisible();
    await expect.poll(() => measureOverflow(page), { timeout: 10_000 }).toBeLessThanOrEqual(1);
  });

  /**
   * The header is the thing that overflows: its nav, stats cluster and account
   * menu all compete for one row. It broke once between the md and lg
   * breakpoints, so every width where the layout changes shape is checked —
   * including just below each breakpoint, where the row is tightest.
   */
  test('no viewport width scrolls the page sideways', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);

    // One load, then resize: the layout is pure CSS, and reloading the Monaco
    // bundle ten times does not fit in a test timeout.
    await page.goto('/practice');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('.card').first()).toBeVisible();

    for (const width of [390, 640, 767, 768, 900, 1023, 1024, 1279, 1280, 1536]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => measureOverflow(page), { timeout: 10_000, message: `page overflows at ${width}px` })
        .toBeLessThanOrEqual(1);
    }
  });
});

/**
 * How far the page scrolls horizontally, and what is sticking out. Monaco's
 * internal scroller is deliberately wider than its container, so only elements
 * that actually push the document are reported.
 */
async function measureOverflow(page: import('@playwright/test').Page): Promise<number> {
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.right > doc.clientWidth + 1 && rect.width > 0 && rect.height > 0) {
        offenders.push(`${el.tagName}.${String(el.className).slice(0, 50)} right=${Math.round(rect.right)}`);
      }
    }
    return { overflow: doc.scrollWidth - doc.clientWidth, offenders: offenders.slice(0, 5) };
  });
  if (layout.overflow > 1) console.log(`  overflow ${layout.overflow}px from: ${layout.offenders.join(' | ')}`);
  return layout.overflow;
}
