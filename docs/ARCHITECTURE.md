# Architecture

## Layers

```
Student / Admin (React + TypeScript + Tailwind + Monaco)
        │  fetch /api/*
        ▼
API (Express + TypeScript)
        │
        ├── services/      practice orchestration, gamification, learning path, AI
        ├── db/            repositories over SQLite
        └── evaluation/    ── engine ── language adapters ── sandbox
                                                              │
                                                    child process / container
                                                              │
                                            python · node · javac · gcc · g++ · sqlite
```

Untrusted code never executes inside the API process. The evaluation engine
hands a fully assembled program to a sandbox driver, which forks a child process
(or starts a container) with hard resource limits and returns a structured
result.

## Request flow for one submission

```
POST /api/practice/questions/:id/submit  { code, timeSpentMs }
  │
  ├─ routes/practice.ts         auth, validation
  ├─ services/practice.ts       loads the question, counts hints, calls the engine
  ├─ evaluation/engine.ts       guard → assemble → syntax → construct → execute → tests
  │     ├─ checks/guards.ts     §14 restrictions
  │     ├─ languages/*.ts       parse, analyse, execute for this language
  │     ├─ assembler.ts         {{STUDENT_CODE}} substitution and re-indentation
  │     └─ comparators.ts       output / result-set comparison
  ├─ db/repositories/…          records the submission, results and progress
  ├─ services/gamification.ts   XP, streak, level, badges
  └─ response                   verdict, per-stage feedback, per-test diffs, award
```

## The assembler

`assembler.ts` turns a fragment into an executable program:

- Splits the template on `{{STUDENT_CODE}}`, keeping the marker's indentation.
- Re-indents every line of a multi-line fragment so it fits the marker's column,
  preserving relative indentation inside the fragment. This is what lets a
  student write `for n in numbers:` at column 0 while the marker sits inside an
  `if` block.
- Substitutes `{{SETUP_CODE}}` with the current test case's setup, so hidden
  tests can vary the data.
- Wraps the result in the question's hidden prefix/suffix.
- Records where the fragment starts, so runtime errors reported at "line 7" of
  the generated program are rewritten as "line 2 of your answer".

## Language adapters

```ts
interface LanguageAdapter {
  slug: string; runtime: string; monacoId: string; executable: boolean;
  setupIsData?: boolean;                 // test setup seeds data instead of code

  analyzeFragment(fragment, question): Promise<AnalysisResult>;
  analyzeProgram?(program, question): Promise<AnalysisResult>;
  isEquivalent?(fragment, candidates, question): Promise<boolean>;
  execute?(program, test, question): Promise<ExecutionOutcome>;
  staticEvaluate?(fragment, question): Promise<StaticEvaluation>;
}
```

| Adapter    | Parsing                       | Execution                          |
| ---------- | ----------------------------- | ---------------------------------- |
| Python     | CPython `ast` (child process) | hardened child process             |
| SQL        | clause tokeniser              | fresh in-memory SQLite, read-only  |
| JavaScript | acorn                         | Node with `--permission`           |
| HTML       | node-html-parser              | none (static)                      |
| CSS        | postcss                       | none (static)                      |
| Java/C/C++ | token analysis                | javac/gcc/g++ under `ulimit`       |

Registering a new adapter in `languages/registry.ts` is the only code change
needed to support a new language; aliases let dialects share one adapter
(`postgresql` → the SQL adapter).

## Sandbox drivers

`sandbox/index.ts` picks a driver and enforces a concurrency limit.

**subprocess (default)** — `python3 -I -B harness/py_exec.py` receives the job as
JSON on stdin and writes its result to file descriptor 3. Inside the harness:
`RLIMIT_AS`, `RLIMIT_DATA`, `RLIMIT_CPU`, `RLIMIT_FSIZE`, `RLIMIT_NOFILE`,
`RLIMIT_NPROC` and `RLIMIT_CORE` are set before any student code runs; an import
guard blocks dangerous modules; `os.system` and friends are replaced; sockets
are neutralised; `open` is disabled; a `SIGALRM` watchdog catches sleeps that
`RLIMIT_CPU` would miss. The parent kills the whole process group on timeout and
runs the child with a minimal environment in a temporary working directory.

**docker** — one `docker run --rm --network=none --cap-drop=ALL
--security-opt=no-new-privileges --read-only --pids-limit=64 --memory=…
--user=65534` per execution. Enabled with `SANDBOX_DRIVER=docker`; falls back to
the subprocess driver when no daemon responds.

## Static analysis harness

`sandbox/harness/py_ast.py` parses a fragment with CPython's `ast` and reports:

- canonical constructs (`FOR_LOOP`, `LIST_COMPREHENSION`, `METHOD:append`, …),
- node-type counts, called functions, methods, names and imports,
- a normalised `ast.dump` used for structural equivalence.

Because it is a parse tree and not a regex, `print(*numbers)` can never register
as a loop, and `[5,10,15]` and `[5, 10, 15]` produce identical dumps.

A fragment may be a block *header* whose body lives in the template — a
fix-the-syntax question can ask for the `for` line alone. On its own that is an
incomplete block, so the harness retries it with a synthetic body and leaves the
stand-in out of the reported constructs. A header that is genuinely broken
raises `SyntaxError` rather than `IndentationError` and is reported unchanged,
so `for n in numbers` still yields "expected ':'".

## Judging a fragment in its template

Some fragments mean nothing alone. `append(4)` is a plain call until the
template puts `numbers.` in front of it; `finally:` is invalid without the
`try` above it; `name, salary` contains no SELECT because SELECT is in the
template. So the engine analyses the assembled program as well:

- **Syntax** fails only when neither the fragment nor the assembled program
  parses.
- **A required construct** may be satisfied anywhere in the program. A
  requirement the template already guarantees is vacuous, not failed.
- **Attribution** — what the student personally wrote, which is what mastery
  records — subtracts a baseline analysis of the same template with a neutral
  stand-in fragment. Without a trustworthy baseline nothing is subtracted,
  which errs toward crediting the student with less rather than more.
- **Forbidden constructs** stay fragment-only: a construct in the template is
  not the student's doing.

This does not soften §12. A required construct absent from the whole program is
still `WRONG_CONSTRUCT` at zero, and the wrong method in the same slot is still
rejected.

## Scoring

- Correct: `maxScore`, reduced 15% per hint (capped at 60%), zero if the
  solution was revealed. Those penalties apply to free practice only — inside an
  assessment the assessment's own points decide the score.
- `WRONG_CONSTRUCT`: always 0, regardless of output.
- `WRONG_OUTPUT` with several weighted tests: partial credit up to 50% — but
  only when at least one *hidden* test passed. Passing just the visible example
  is what a hardcoded answer looks like, so it earns nothing.

Assembly happens before parsing, so a student whose fragment does not compile
can still open the "Generated code" tab and see exactly what would have run.

## Frontend

React Router with a shared layout. The practice workspace renders the provided
code as read-only Monaco panes above and below a single editable instance, so
protected code is not part of the editable model at all — there is nothing to
overwrite and the editable region is visually unmistakable. Monaco is bundled
with the app (not loaded from a CDN) so the platform runs on an isolated
network.

## Extension points

| To add…            | Do this                                                          |
| ------------------ | ---------------------------------------------------------------- |
| a question         | Admin → Question builder, or bulk import                          |
| a topic/subtopic   | `POST /api/admin/topics`, or the seed taxonomy                     |
| a language         | new `LanguageAdapter` + registry entry                            |
| an evaluation type | new branch in `engine.ts` `gradeByType` + a `types.ts` union entry |
| a badge            | a row in `badges` (criteria types live in `gamification.ts`)       |
| a SQL dataset      | a row in `sql_datasets`                                           |

## Question health

`services/questionHealth.ts` re-runs every published question's own reference
solution through the real engine and stores the verdict in `question_health`.
A question whose solution fails is unanswerable by anyone, and nothing else
surfaces that — its pass rate of zero looks like difficulty. Saving a question
records its health; `POST /admin/questions-health/sweep` does the whole bank.

## Construct mastery and review

`submission_constructs` records the constructs attributed to the student on
each submission — the same data that used to exist only inside the
`submissions.feedback` blob, now indexed. `services/mastery.ts` reads accuracy
per construct and names the constructs the bank teaches that a student has
never got right.

`services/review.ts` schedules solved questions with SM-2. A lapse collapses
the interval to a day but only decays the ease, so one slip does not erase a
long record; intervals cap at a year and ease at 1.3. Assessments never
schedule reviews — an assessment is a measurement, not a study session.

## Misconception hints

`question_misconceptions` attaches a hint to a *detected pattern* rather than a
position in a list: constructs present, constructs absent, a regex over the
fragment, a verdict, an error type. Rules are ANDed, the first match wins, and
a rule with no criteria is inert rather than universal. An uncompilable regex
is rejected when authored and guarded when matched.

## Deriving a question

`services/deriveQuestion.ts` turns a working program plus a line range into a
template, a reference solution, required constructs and expected output. The
expectation comes from executing the program through the same adapter a
submission uses, so it cannot disagree with what the platform will compare
against. Only structural constructs are required by default — requiring every
detected one would reject reasonable variations.
