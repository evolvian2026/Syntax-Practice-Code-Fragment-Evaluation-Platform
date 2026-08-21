# API reference

Base URL `/api`. Authenticated endpoints take `Authorization: Bearer <token>`.
Errors are `{ "error": "message" }`, with `issues[]` added for validation
failures.

## Auth

| Method | Path                    | Auth   | Purpose |
| ------ | ----------------------- | ------ | ------- |
| POST   | `/auth/register`        | –      | Create a student account, returns a token. |
| POST   | `/auth/login`           | –      | Sign in, returns a token. |
| GET    | `/auth/me`              | user   | Current user plus practice profile (XP, level, streaks). |
| PATCH  | `/auth/me`              | user   | Update name, theme or batch. |
| POST   | `/auth/change-password` | user   | Change password. |

## Catalogue

| Method | Path                       | Auth | Purpose |
| ------ | -------------------------- | ---- | ------- |
| GET    | `/practice/catalog`        | –    | Languages → topics → subtopics with question counts. |
| GET    | `/practice/languages`      | –    | Flat language list with runtime/executable flags. |
| GET    | `/practice/topics`         | –    | Topics, optionally `?language=`. |
| GET    | `/practice/constructs`     | –    | Grouped construct vocabulary for the builder. |
| GET    | `/practice/datasets`       | –    | SQL sandbox datasets. |
| GET    | `/practice/datasets/:slug` | –    | Tables, columns and sample rows for one dataset. |

## Practice

| Method | Path                              | Auth    | Purpose |
| ------ | --------------------------------- | ------- | ------- |
| GET    | `/practice/questions`             | opt.    | Filter by `language`, `topic`, `subtopic`, `difficulty`, `questionType`, `tag`, `search`, `limit`, `offset`, `sort`. Adds per-student solved/attempts when signed in. |
| GET    | `/practice/questions/:idOrQid`    | opt.    | Student view: statement, read-only context, public tests, hidden test *count*, hints available, dataset schema, progress. Hidden expectations and solutions are never included. |
| GET    | `/practice/questions/:id/next`    | user    | Next unsolved question in the same topic. |
| POST   | `/practice/questions/:id/run`     | user    | Evaluate against public tests only. |
| POST   | `/practice/questions/:id/submit`  | user    | Evaluate against every test; updates progress, XP, badges. |
| GET    | `/practice/questions/:id/hints`   | user    | Hint list; text only for hints already unlocked. |
| POST   | `/practice/questions/:id/hint`    | user    | Unlock hint `{ index }`; records the score penalty. |
| POST   | `/practice/questions/:id/solution`| user    | Reveal the solution; the question then scores 0. |
| GET    | `/practice/submissions`           | user    | Submission history. |
| GET    | `/practice/submissions/:id`       | user    | One submission with its full evaluation trace. |
| GET    | `/practice/daily-challenge`       | opt.    | Today's challenge and its XP bonus. |

Run/Submit body: `{ code, timeSpentMs?, selectedOption?, assessmentId? }`.

Response:

```jsonc
{
  "result": {
    "verdict": "WRONG_CONSTRUCT",       // CORRECT | PARTIAL | WRONG_OUTPUT | WRONG_CONSTRUCT
                                        // | SYNTAX_ERROR | COMPILE_ERROR | RUNTIME_ERROR
                                        // | TIMEOUT | RESTRICTED | EMPTY | ERROR
    "isCorrect": false,
    "score": 0,
    "maxScore": 100,
    "errorType": "conceptual",          // none|syntax|runtime|timeout|restricted|conceptual|sql|internal
    "errorMessage": "…",
    "feedback": "Output is correct, but the question requires a FOR loop.",
    "stages": [{ "stage": "construct", "passed": false, "title": "Required construct", "message": "…" }],
    "tests":  [{ "name": "Test 1", "visibility": "public", "passed": true, "expected": "…", "actual": "…" }],
    "testsPassed": 2, "testsFailed": 0,
    "generatedCode": "numbers = [1, 2, 3]\n\nfor n in numbers:\n    print(n)",
    "stdout": "1\n2\n3", "stderr": "",
    "executionMs": 31, "memoryKb": 11172,
    "detectedConstructs": ["FOR_LOOP", "PRINT"],
    "missingConstructs": [], "usedForbiddenConstructs": [],
    "resultSet": null                    // populated for SQL questions
  },
  "submissionId": 42, "attemptNumber": 3,
  "award": { "xpEarned": 12, "totalXp": 120, "level": 1, "leveledUp": false,
             "streak": 3, "streakExtended": true, "newBadges": [] },
  "explanation": "…",                    // only once solved or revealed
  "solutions": []                        // only once solved or revealed
}
```

Hidden test cases appear in `tests` with `passed` only — never their expected or
actual output.

## Progress

| Method | Path                              | Auth | Purpose |
| ------ | --------------------------------- | ---- | ------- |
| GET    | `/progress/dashboard`             | user | Totals, accuracy, streaks, error breakdown, per-language/topic/difficulty accuracy, weak and strong topics, recent activity, recent submissions, badges. |
| GET    | `/progress/breakdown/:dimension`  | user | `language`, `topic` or `difficulty`. |
| GET    | `/progress/badges`                | user | All badges with earned state. |
| GET    | `/progress/leaderboard`           | user | Ranked by XP; `?batch=`, `?limit=`. |
| GET    | `/progress/learning-path`         | user | Path for `?language=` with unlock state and reasons. |
| GET    | `/progress/learning-paths`        | user | Available paths. |
| GET    | `/progress/activity`              | user | Daily attempt/solve counts for `?days=`. |

## Assessments (student)

| Method | Path                                     | Auth | Purpose |
| ------ | ---------------------------------------- | ---- | ------- |
| GET    | `/assessments`                           | user | Published assessments with the student's attempt state. |
| POST   | `/assessments/:id/start`                 | user | Start or resume an attempt; returns the questions. |
| GET    | `/assessments/attempts/:attemptId`       | user | Attempt state, questions and saved answers. |
| POST   | `/assessments/attempts/:attemptId/answer`| user | Grade one answer `{ questionId, code, timeSpentMs? }`; minimal feedback only. |
| POST   | `/assessments/attempts/:attemptId/submit`| user | Finish and score the attempt. |
| GET    | `/assessments/attempts/:attemptId/report`| user | Per-question report. |

Attempts expire automatically once `durationMinutes` has elapsed.

## Admin (`admin` or `teacher`)

### Questions
| Method | Path                              | Purpose |
| ------ | --------------------------------- | ------- |
| GET    | `/admin/questions`                | Filterable list, all statuses. |
| GET    | `/admin/questions/:id`            | Full question in authoring format, plus a student preview. |
| POST   | `/admin/questions`                | Create. Validates the `{{STUDENT_CODE}}` marker, the language adapter, and that the evaluation type has what it needs. |
| PUT    | `/admin/questions/:id`            | Replace. |
| DELETE | `/admin/questions/:id`            | Delete (cascades to test cases, hints, solutions, submissions). |
| POST   | `/admin/questions/:id/duplicate`  | Copy as a draft. |
| POST   | `/admin/questions/preview`        | Render the student view of an unsaved draft. |
| POST   | `/admin/questions/dry-run`        | Run a candidate answer against an unsaved draft through the real engine. |
| POST   | `/admin/questions/:id/verify`     | Re-run the stored reference solution. |
| GET    | `/admin/questions-export`         | Download every question as JSON. |
| POST   | `/admin/questions-import`         | Bulk import `{ questions, mode: "upsert"\|"create", dryRun }`; reports per-row results. |

### Taxonomy, assessments, students, analytics
| Method | Path                              | Purpose |
| ------ | --------------------------------- | ------- |
| POST   | `/admin/topics`, `/admin/subtopics` | Extend the catalogue. |
| GET/POST/PUT/DELETE | `/admin/assessments[/:id]` | Manage assessments. |
| GET    | `/admin/assessments/:id/results`  | Every student attempt. |
| GET    | `/admin/students`                 | Roster with accuracy and XP. |
| POST   | `/admin/students`                 | Create an account with a role. |
| GET    | `/admin/students/:id`             | One student's dashboard and recent attempts. |
| POST   | `/admin/assignments`, `/admin/collections` | Assign questions to students, group questions. |
| GET    | `/admin/analytics/overview`       | Platform totals, weak concepts, hardest questions, common errors, top students. |
| GET    | `/admin/analytics/questions`      | Per-question stats; `?order=hardest\|easiest\|most_attempted`. |
| GET    | `/admin/analytics/topics`         | Topic accuracy across the cohort. |
| GET    | `/admin/analytics/submissions`    | Raw submission feed. |

## AI (optional)

| Method | Path                     | Auth  | Purpose |
| ------ | ------------------------ | ----- | ------- |
| GET    | `/ai/status`             | user  | Whether AI features are configured. |
| POST   | `/ai/tutor`              | user  | Progressive hint `{ questionId, code, level: 1..3 }`. Never returns the answer. |
| POST   | `/ai/explain-error`      | user  | Plain-language explanation of a failed submission. |
| GET    | `/ai/recommendations`    | user  | What to practise next. |
| POST   | `/ai/generate-question`  | admin | Draft a new question or a variation; returned as an unsaved draft. |

Without `ANTHROPIC_API_KEY` these endpoints still respond, using deterministic
fallbacks (`source: "fallback"`).

## Health

`GET /api/health` — status, environment and sandbox driver information.
