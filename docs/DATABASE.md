# Database

The full schema lives in [`server/src/db/schema.sql`](../server/src/db/schema.sql)
and is applied by `npm run migrate` (also on server start).

## Tables

### Identity
| Table      | Purpose |
| ---------- | ------- |
| `users`    | Account, password hash, role (`student` / `teacher` / `admin`). |
| `students` | Practice profile: XP, level, streaks, batch, theme. Every account gets one so admins can practise too. |

### Catalogue
| Table          | Purpose |
| -------------- | ------- |
| `languages`    | Slug, display name, evaluation `runtime`, Monaco id, accent colour. |
| `topics`       | Per language, ordered. |
| `subtopics`    | Per topic, ordered. |
| `sql_datasets` | Schema + seed SQL for the SQL sandbox, rebuilt per execution. |

### Questions
| Table                 | Purpose |
| --------------------- | ------- |
| `questions`           | One row per question, with its `qid`, template, evaluation type, grading rules and limits. |
| `question_test_cases` | Public and hidden cases: setup, stdin, expected output, matcher, weight. |
| `question_hints`      | Ordered hints with a score penalty each. |
| `question_solutions`  | Reference solution plus accepted alternatives. |
| `question_tags`       | Free-form tags. |

JSON-shaped columns (`required_constructs`, `forbidden_constructs`,
`required_keywords`, `forbidden_keywords`, `options`, `config`) are stored as
TEXT and parsed by the repository layer.

### Attempts and progress
| Table                | Purpose |
| -------------------- | ------- |
| `submissions`        | Every run and submit: fragment, generated program, verdict, score, timings, error type, hints used, attempt number, full evaluation JSON. |
| `submission_results` | Per-test and per-stage rows for a submission. |
| `student_progress`   | One row per (student, question): attempts, solved, best score, error counters, time. |
| `hint_usage`         | Which hints a student unlocked. |
| `solution_reveals`   | Which solutions a student revealed. |

### Learning path, assessments, assignments
`learning_paths`, `learning_path_nodes`, `assessments`,
`assessment_questions`, `student_assessments`, `student_assessment_answers`,
`collections`, `collection_questions`, `assignments`, `assignment_questions`,
`assignment_students`.

### Gamification
`badges`, `student_badges`, `daily_challenges`, `xp_events`.

## Why SQLite by default

The platform runs with no external services: `npm run setup` produces a working
instance in seconds, and tests use a throwaway database file. SQLite 3.49 (via
better-sqlite3) supports `RIGHT`/`FULL OUTER JOIN`, window functions and CTEs, so
the SQL questions exercise the same constructs students meet in MySQL.

## Moving to PostgreSQL or MySQL

All database access goes through `server/src/db/` — `index.ts` for the connection
and `repositories/*.ts` for queries. Feature code never issues SQL directly, so
the port is confined to that directory.

1. Translate `schema.sql`: `INTEGER PRIMARY KEY AUTOINCREMENT` →
   `SERIAL`/`BIGSERIAL` or `AUTO_INCREMENT`; `TEXT` timestamps default
   `datetime('now')` → `TIMESTAMP DEFAULT NOW()`; JSON columns → `JSONB`/`JSON`.
2. Replace `db()` in `index.ts` with a `pg`/`mysql2` pool, and adapt
   `parseJson`/`toJson` if the driver already returns parsed JSON.
3. Update the repositories: named parameters are `@name` in better-sqlite3,
   `$1` in `pg` and `?` in `mysql2`; `.get()`/`.all()`/`.run()` become awaited
   query calls; `ON CONFLICT … DO UPDATE` works in Postgres as-is and becomes
   `ON DUPLICATE KEY UPDATE` in MySQL.
4. Leave the SQL *sandbox* on SQLite — it is deliberately in-memory and
   throwaway, and must never share a connection with the application database.

## Backups

The SQLite database is a single file at `DATABASE_FILE` (`data/` by default,
git-ignored). Back it up with `sqlite3 data/syntax-practice.db ".backup out.db"`
or by copying the file while the server is stopped. Questions can be exported
independently as JSON from the admin panel.
