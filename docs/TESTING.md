# Testing

Two layers, both against real behaviour: no mocked sandbox, no mocked database,
no stubbed API.

```bash
npm test          # unit + integration (vitest)  — seconds
npm run test:e2e  # browser end to end (Playwright) — minutes
npm run test:all  # both
```

## Unit and integration — `server/tests`

Run with vitest against a throwaway SQLite file (`.tmp/test.db`) and the real
execution sandbox.

| File                 | Covers |
| -------------------- | ------ |
| `evaluation.test.ts` | Template assembly and re-indentation; correct fragments; syntax errors; correct-output-wrong-construct; hidden tests; runtime errors; infinite loops; restricted and required keywords; syntax equivalence; multiple valid solutions; AST-only grading; hint and solution scoring. |
| `sql.test.ts`        | Clause detection (including keywords inside string literals); the read-only sandbox database; DDL/DML refusal; stacked statements; unknown-column messages; hidden tests seeding extra rows; JOIN grading; injection attempts and dataset integrity afterwards. |
| `sandbox.test.ts`    | Python isolation (`os.system`, `subprocess`, sockets, files, infinite loops, sleeps, memory); AST construct detection, including a block header whose body lives in the template; JavaScript execution under Node's permission model; HTML/CSS parsing; C, C++ and Java compile-and-run. |
| `features.test.ts`   | Question health (healthy, failing and unverifiable questions, the sweep, the HTTP surface); construct mastery and gaps; SM-2 grading, interval growth, lapses, the ease floor and the interval cap; misconception matching, inert rules and uncompilable regexes; deriving a question from a program, including dedenting and a program that will not run. |
| `api.test.ts`        | The HTTP surface end to end: auth, the practice loop, hidden-test redaction, hints, XP and badges, submission history, dashboard, leaderboard, admin CRUD, validation, the import dry run (including that it rejects an unresolvable row without writing), duplicate, import/export, analytics, and the assessment lifecycle. |

## End to end — `e2e/`

Playwright drives Chromium against the **production client bundle served by the
API process**, with a freshly migrated and fully seeded database. `e2e/server.mjs`
builds the client if needed, migrates, seeds all 142 questions, and starts the
server; `playwright.config.ts` waits for `/api/health` before the first test.

| File               | Covers |
| ------------------ | ------ |
| `features.spec.ts` | The five layered features through the UI: a health sweep over the whole seeded bank, a rotten question reported on save, mastery recorded from a solve, a review scheduled and queued, an authored misconception reaching the student who makes that mistake, and deriving a question that a student then solves. |
| `student.spec.ts`  | Sign-in and registration; browsing, filtering and search; the provided-code/editable-region layout; protected code being uneditable; Run vs Submit; wrong-construct rejection; syntax, runtime, timeout and restricted verdicts; hardcoded answers caught by hidden tests; the generated program; hints; explanations; solution reveal; Reset; Next; SQL with its schema browser and injection blocking; LEFT vs INNER JOIN; syntax equivalence; HTML, CSS, JavaScript and C questions; predict-output, fix-syntax and choose-and-write types; dashboard, learning path, leaderboard, history; theme toggle and tablet layout. |
| `admin.spec.ts`    | Role separation; the overview; listing and filtering; verifying a reference solution; **authoring a question through the builder and then solving it as a student**; duplicate; template validation; delete; import validation and import; export; composing an assessment and taking it; the student roster; creating an account that can then sign in; analytics. |

### Notes for maintainers

- `e2e/helpers.ts` holds the page objects. `typeFragment` inserts the whole
  fragment in one `insertText` call — typing key by key lets Monaco re-indent as
  it goes, which changes the meaning of Python code. It then verifies the editor
  content line by line rather than by character count, because Monaco normalises
  line endings and may deepen a block body's indentation.
- `submit()` and `run()` wait for the actual API response before reading the
  verdict banner. The banner persists between attempts, so reading it without
  waiting yields the previous result.
- Monaco recycles `.view-line` nodes, so DOM order does not follow visual order;
  `readFragment` sorts by vertical offset.
- Tests that act as two people at once need two browser *contexts*, not two
  tabs: `context.newPage()` shares localStorage, so the second user still
  carries the first one's token and is redirected straight past `/login`.
  `signInAsOther` handles this, passing `baseURL` explicitly because a manually
  created context does not inherit it from the config.
- `admin.spec.ts` runs before `student.spec.ts`, so anything that ranks practice
  history has to create it — `seedSubmissions` posts attempts through the API.
- A full E2E run takes roughly 27 minutes: every test signs in for real and every
  submission compiles or executes real code in the sandbox.

### Artifacts

Failures keep a screenshot and a trace under `test-results/`. Open one with:

```bash
npx playwright show-trace test-results/<folder>/trace.zip
```
