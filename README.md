# Syntax Practice — Code Fragment Evaluation Platform

Practise programming **constructs**, not whole programs. A student writes only
the fragment they are learning — a `for` loop, a JOIN clause, a condition — and
the platform supplies everything around it, assembles a complete program, runs it
in an isolated sandbox and grades whether the *right construct* was used.

```python
numbers = [1, 2, 3, 4, 5]      # provided by the platform

for number in numbers:         # ← the only thing the student writes
    print(number)

print("Done")                  # provided by the platform
```

Submitting `print(*numbers, sep="\n")` for that question produces the right
output — and is still marked wrong:

> ⚠ **Wrong construct** — Output is correct, but this question is practising the
> FOR loop, so write the loop rather than a one-line print trick.

That rule is the point of the platform.

---

## Quick start

```bash
npm run setup     # install, create the database, seed 142 questions
npm run dev       # API on :4000, UI on :5173
```

Then open <http://localhost:5173> and use a demo account:

| Role    | Email                          | Password     |
| ------- | ------------------------------ | ------------ |
| Student | `student@syntaxpractice.dev`   | `student123` |
| Admin   | `admin@syntaxpractice.dev`     | `admin123`   |
| Teacher | `teacher@syntaxpractice.dev`   | `admin123`   |

Requirements: Node 20+ and `python3`. `javac`, `gcc` and `g++` are optional —
they unlock the Java/C/C++ questions and the platform reports a clear message if
a toolchain is missing.

```bash
npm run build     # production build (server + client)
npm start         # serve API and the built UI from one process on :4000
npm test          # 113 tests
```

---

## How the evaluation works

Every submission goes through the same pipeline, short-circuiting at the first
hard failure:

```
fragment
   │
   ├─ 1. guard       length, forbidden/required keywords, dangerous patterns
   ├─ 2. syntax      does the fragment parse at all?
   ├─ 3. construct   did the student use the construct being taught?
   ├─ 4. assemble    {{STUDENT_CODE}} → full program (re-indented to the marker)
   ├─ 5. execute     isolated sandbox: time, memory, process, FS and net limits
   └─ 6. tests       public tests on Run; public + hidden tests on Submit
   │
   ▼
verdict · score · per-stage feedback · per-test diff
```

The construct stage is decisive: a fragment that produces the expected output
without the required construct returns `WRONG_CONSTRUCT` and scores 0.

### Evaluation types

| Type         | How it grades                                                        |
| ------------ | -------------------------------------------------------------------- |
| `OUTPUT`     | Runs the assembled program, compares stdout against each test case.   |
| `SQL_RESULT` | Runs the query against a seeded, read-only sandbox DB; compares rows. |
| `SYNTAX`     | Parses the fragment and compares it structurally with accepted forms — `[5,10,15]` and `[5, 10, 15]` are the same answer. |
| `AST`        | Passes on the presence/absence of constructs alone; nothing executes. |
| `STATIC`     | HTML/CSS: parses the markup and asserts tags, attributes, declarations. |
| `TEXT`       | Predict-the-output questions, compared case- and whitespace-tolerantly. |
| `COMPOSITE`  | Constructs *and* execution, both must pass.                            |

### Construct vocabulary

Adapters emit a shared vocabulary (`FOR_LOOP`, `LIST_COMPREHENSION`,
`LEFT_JOIN`, `METHOD:append`, `TAG:a`, …) so one question can say
`requiredConstructs: ["FOR_LOOP"]` and have it mean the same thing in Python,
JavaScript, Java, C and C++. `ANY:FOR_LOOP|WHILE_LOOP` accepts either.

Python and JavaScript detect constructs from a **real parse tree** (CPython's
`ast`, acorn) — never from string matching. HTML/CSS use real parsers
(node-html-parser, postcss). Java/C/C++ use token analysis over a
comment-and-string-stripped copy, with the compiler proving syntax validity.

---

## Safety

Student code never runs in the API process.

- **Python** runs in a hardened child process: `RLIMIT_AS`/`CPU`/`NPROC`/`FSIZE`,
  an import guard that blocks `subprocess`/`socket`/`ctypes`/…, disabled
  `os.system`-family calls, neutralised sockets, no filesystem access, a
  wall-clock watchdog on top of the CPU limit, and a hard kill of the process
  group from the parent.
- **JavaScript** runs under Node's permission model (`--permission`): no
  filesystem writes, no child processes, no native addons.
- **Java/C/C++** compile and run under `ulimit` with CPU, address-space, file
  size and file-descriptor caps.
- **SQL** gets a brand-new in-memory database per execution, seeded from the
  question's dataset and switched to `query_only` before the student's query
  runs. DDL/DML, stacked statements and injection patterns are rejected twice —
  by the guard patterns and by the engine.
- A bounded queue caps concurrent executions so a burst cannot exhaust the host.

Set `SANDBOX_DRIVER=docker` to run each execution in a throwaway container
(`--network=none --cap-drop=ALL --read-only --pids-limit=64`) instead; the
platform falls back to the subprocess driver when no daemon is available.

---

## What is in the box

**Student** — topic browser, practice workspace with Monaco and a protected
editable region, Run/Submit/Reset/Hint/Solution, public + hidden test results,
generated-program view, SQL schema browser, progressive hints, explanations and
alternative solutions, dashboard (accuracy by language/topic/difficulty, weak
topics, error breakdown, activity chart), learning path with unlocking,
assessments, submission history, XP/levels/streaks/badges/leaderboard/daily
challenge.

**Admin** — question CRUD, duplicate, verify-reference-solution, visual question
builder with a live student preview and a dry-run against the real engine,
bulk import/export, assessment composer with results, student roster with
drill-down, and analytics (hardest questions, weak concepts, common errors).

**AI (optional)** — set `ANTHROPIC_API_KEY` to enable progressive tutoring
(never reveals the answer), error explanations, practice recommendations and
admin question generation. Everything degrades to deterministic behaviour when
the key is absent.

---

## Seeded content

142 questions, every one verified at seed time by executing its own reference
solution:

| Language   | Questions | Coverage                                                   |
| ---------- | --------: | ---------------------------------------------------------- |
| Python     |        78 | variables, basics, lists, conditions, loops, functions, dicts, tuples, sets, strings, OOP, exceptions |
| SQL/MySQL  |        41 | SELECT, WHERE, ORDER BY, GROUP BY, HAVING, INNER/LEFT JOIN, multiple JOINs, self join, subquery join |
| CSS        |         5 | text, box model, selectors, flexbox                         |
| Java       |         4 | loops, conditions, arrays, methods                          |
| JavaScript |         4 | arrow functions, map/filter, template literals               |
| HTML       |         4 | links, images, lists, forms                                  |
| C          |         3 | conditions, loops, printf                                    |
| C++        |         3 | vectors, range-for, cout                                     |

All nine question types from the specification are represented, including
fix-the-syntax, predict-output and choose-and-write.

---

## Adding a question without writing code

Admin → Questions → **New question**. Fill in the statement, paste starter code
containing the `{{STUDENT_CODE}}` marker, pick the required constructs, add test
cases (public and hidden), hints, an explanation and a reference solution, then
use **Preview & test** to run a candidate answer through the real engine before
publishing. Bulk import accepts the same JSON the export produces.

---

## Adding a language

1. Write an adapter implementing `LanguageAdapter`
   (`server/src/evaluation/languages/`).
2. Register it in `languages/registry.ts`.
3. Add the language row and its topics (seed file or the admin API).

The engine, API, builder and UI need no changes.

---

## Configuration

Copy `.env.example` to `.env`. Everything has a working default; the settings you
are most likely to change:

| Variable            | Default                  | Purpose                                  |
| ------------------- | ------------------------ | ---------------------------------------- |
| `PORT`              | `4000`                   | API port                                 |
| `JWT_SECRET`        | dev value                | **Change this in production**            |
| `DATABASE_FILE`     | `data/syntax-practice.db`| SQLite database location                 |
| `SANDBOX_DRIVER`    | `subprocess`             | `subprocess` or `docker`                 |
| `SANDBOX_MAX_CONCURRENT` | `4`                 | Concurrent executions                    |
| `ANTHROPIC_API_KEY` | *(empty)*                | Enables the optional AI features         |

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, request flow, extension points
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema reference and the Postgres/MySQL path
- [`docs/API.md`](docs/API.md) — every endpoint
- [`docs/QUESTION_AUTHORING.md`](docs/QUESTION_AUTHORING.md) — the question format in full

## Repository layout

```
server/
  src/
    db/            schema, migrations, repositories
    evaluation/    engine, assembler, comparators, guards, language adapters
    sandbox/       drivers, runners, python harnesses
    routes/        auth, practice, progress, assessments, admin, ai
    services/      practice orchestration, gamification, learning path, AI
    seed/          taxonomy, datasets, 142 questions, seeder
  tests/           113 tests
client/
  src/
    components/    layout, fragment editor, UI kit
    pages/         student pages + admin panel
    lib/           API client, auth, Monaco setup
```
