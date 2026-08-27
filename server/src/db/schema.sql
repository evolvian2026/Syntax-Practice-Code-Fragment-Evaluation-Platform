-- =====================================================================
-- Syntax Practice & Code Fragment Evaluation Platform — core schema
-- Dialect: SQLite (portable subset; see docs/DATABASE.md for Postgres/MySQL notes)
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin','teacher')),
  avatar_color   TEXT NOT NULL DEFAULT 'indigo',
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS students (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  batch              TEXT,
  enrollment_no      TEXT,
  xp                 INTEGER NOT NULL DEFAULT 0,
  level              INTEGER NOT NULL DEFAULT 1,
  streak_current     INTEGER NOT NULL DEFAULT 0,
  streak_best        INTEGER NOT NULL DEFAULT 0,
  last_practice_date TEXT,
  preferred_theme    TEXT NOT NULL DEFAULT 'dark',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch);
CREATE INDEX IF NOT EXISTS idx_students_xp ON students(xp DESC);

-- ------------------------------------------------------------- taxonomy
CREATE TABLE IF NOT EXISTS languages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,          -- python, mysql, java, c, cpp, javascript, html, css
  name          TEXT NOT NULL,
  runtime       TEXT NOT NULL,                 -- evaluation adapter key (see evaluation/languages/registry.ts)
  monaco_id     TEXT NOT NULL DEFAULT 'plaintext',
  file_extension TEXT NOT NULL DEFAULT 'txt',
  icon          TEXT,
  accent        TEXT NOT NULL DEFAULT '#6366f1',
  description   TEXT,
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  language_id   INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (language_id, slug)
);

CREATE TABLE IF NOT EXISTS subtopics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id      INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (topic_id, slug)
);

-- ------------------------------------------------------- SQL sandbox DBs
CREATE TABLE IF NOT EXISTS sql_datasets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  dialect     TEXT NOT NULL DEFAULT 'mysql',
  description TEXT,
  schema_sql  TEXT NOT NULL,   -- DDL executed into a throwaway in-memory database
  seed_sql    TEXT NOT NULL,   -- INSERTs executed after the DDL
  preview     TEXT             -- JSON: table -> sample rows, shown to students
);

-- ------------------------------------------------------------- questions
CREATE TABLE IF NOT EXISTS questions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  qid                 TEXT NOT NULL UNIQUE,      -- human-facing stable id e.g. PY-LOOP-0007
  language_id         INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  topic_id            INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  subtopic_id         INTEGER REFERENCES subtopics(id) ON DELETE SET NULL,
  difficulty          TEXT NOT NULL DEFAULT 'Easy' CHECK (difficulty IN ('Easy','Medium','Hard')),
  question_type       TEXT NOT NULL DEFAULT 'FILL_CODE',
  evaluation_type     TEXT NOT NULL DEFAULT 'OUTPUT',
  title               TEXT NOT NULL,
  statement           TEXT NOT NULL,
  instructions        TEXT,
  learning_objective  TEXT,
  -- Fragment template. Must contain the {{STUDENT_CODE}} marker.
  starter_code        TEXT NOT NULL,
  -- Code appended before/after the template and never shown to the student.
  hidden_prefix       TEXT,
  hidden_suffix       TEXT,
  -- Content pre-loaded inside the editable region.
  editable_prefill    TEXT,
  editable_placeholder TEXT,
  indent_fragment     INTEGER NOT NULL DEFAULT 1,   -- re-indent fragment to the marker's column
  dataset_id          INTEGER REFERENCES sql_datasets(id) ON DELETE SET NULL,
  -- Evaluation configuration (all JSON-encoded text)
  required_constructs TEXT NOT NULL DEFAULT '[]',
  forbidden_constructs TEXT NOT NULL DEFAULT '[]',
  required_keywords   TEXT NOT NULL DEFAULT '[]',
  forbidden_keywords  TEXT NOT NULL DEFAULT '[]',
  options             TEXT NOT NULL DEFAULT '[]',   -- for CHOOSE_AND_WRITE / PREDICT_OUTPUT
  config              TEXT NOT NULL DEFAULT '{}',   -- evaluator-specific extras
  max_code_length     INTEGER NOT NULL DEFAULT 2000,
  time_limit_ms       INTEGER NOT NULL DEFAULT 4000,
  memory_limit_mb     INTEGER NOT NULL DEFAULT 128,
  max_score           INTEGER NOT NULL DEFAULT 100,
  explanation         TEXT,
  status              TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_language ON questions(language_id);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_subtopic ON questions(subtopic_id);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);

CREATE TABLE IF NOT EXISTS question_test_cases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','hidden')),
  name            TEXT,
  -- Optional per-test override of the template context (e.g. different list values)
  setup_code      TEXT,
  stdin           TEXT,
  expected_output TEXT,
  expected_value  TEXT,                       -- JSON literal for VALUE evaluation
  matcher         TEXT NOT NULL DEFAULT 'exact' CHECK (matcher IN ('exact','trimmed','normalized','contains','regex','unordered_rows','rows')),
  weight          REAL NOT NULL DEFAULT 1,
  display_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_testcases_question ON question_test_cases(question_id);

CREATE TABLE IF NOT EXISTS question_hints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  body          TEXT NOT NULL,
  penalty       INTEGER NOT NULL DEFAULT 10   -- percent of max_score deducted
);
CREATE INDEX IF NOT EXISTS idx_hints_question ON question_hints(question_id);

CREATE TABLE IF NOT EXISTS question_solutions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_solutions_question ON question_solutions(question_id);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  PRIMARY KEY (question_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON question_tags(tag);

-- ----------------------------------------------------------- submissions
CREATE TABLE IF NOT EXISTS submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id        INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  assessment_id      INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  mode               TEXT NOT NULL DEFAULT 'submit' CHECK (mode IN ('run','submit')),
  fragment_code      TEXT NOT NULL,
  generated_code     TEXT NOT NULL,
  verdict            TEXT NOT NULL,   -- CORRECT | WRONG_OUTPUT | WRONG_CONSTRUCT | SYNTAX_ERROR | RUNTIME_ERROR | TIMEOUT | RESTRICTED | ERROR
  is_correct         INTEGER NOT NULL DEFAULT 0,
  score              REAL NOT NULL DEFAULT 0,
  max_score          REAL NOT NULL DEFAULT 100,
  tests_passed       INTEGER NOT NULL DEFAULT 0,
  tests_failed       INTEGER NOT NULL DEFAULT 0,
  execution_ms       INTEGER NOT NULL DEFAULT 0,
  memory_kb          INTEGER NOT NULL DEFAULT 0,
  error_type         TEXT,            -- syntax | runtime | timeout | restricted | conceptual | sql | none
  error_message      TEXT,
  hints_used         INTEGER NOT NULL DEFAULT 0,
  attempt_number     INTEGER NOT NULL DEFAULT 1,
  time_spent_ms      INTEGER NOT NULL DEFAULT 0,
  feedback           TEXT NOT NULL DEFAULT '{}',  -- JSON EvaluationResult (redacted for students)
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_question ON submissions(question_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_assessment ON submissions(assessment_id);

CREATE TABLE IF NOT EXISTS submission_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  test_case_id   INTEGER REFERENCES question_test_cases(id) ON DELETE SET NULL,
  stage          TEXT NOT NULL DEFAULT 'test',  -- guard | syntax | construct | test
  visibility     TEXT NOT NULL DEFAULT 'public',
  name           TEXT,
  passed         INTEGER NOT NULL DEFAULT 0,
  expected       TEXT,
  actual         TEXT,
  message        TEXT,
  execution_ms   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_results_submission ON submission_results(submission_id);

-- -------------------------------------------------------------- progress
CREATE TABLE IF NOT EXISTS student_progress (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id      INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  attempts         INTEGER NOT NULL DEFAULT 0,
  solved           INTEGER NOT NULL DEFAULT 0,
  best_score       REAL NOT NULL DEFAULT 0,
  hints_used       INTEGER NOT NULL DEFAULT 0,
  total_time_ms    INTEGER NOT NULL DEFAULT 0,
  syntax_errors    INTEGER NOT NULL DEFAULT 0,
  runtime_errors   INTEGER NOT NULL DEFAULT 0,
  construct_errors INTEGER NOT NULL DEFAULT 0,
  first_solved_at  TEXT,
  last_attempt_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_user ON student_progress(user_id);

CREATE TABLE IF NOT EXISTS hint_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  hint_id     INTEGER NOT NULL REFERENCES question_hints(id) ON DELETE CASCADE,
  used_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, question_id, hint_id)
);

CREATE TABLE IF NOT EXISTS solution_reveals (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  revealed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, question_id)
);

-- --------------------------------------------------------- learning path
CREATE TABLE IF NOT EXISTS learning_paths (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_enabled  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS learning_path_nodes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  path_id           INTEGER NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  parent_id         INTEGER REFERENCES learning_path_nodes(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  topic_id          INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  subtopic_id       INTEGER REFERENCES subtopics(id) ON DELETE SET NULL,
  display_order     INTEGER NOT NULL DEFAULT 0,
  -- Unlock rule: accuracy (%) required across the prerequisite node's questions
  unlock_accuracy   INTEGER NOT NULL DEFAULT 0,
  unlock_solved     INTEGER NOT NULL DEFAULT 0,
  description       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pathnodes_path ON learning_path_nodes(path_id);

-- ----------------------------------------------------------- assessments
CREATE TABLE IF NOT EXISTS assessments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  description      TEXT,
  language_id      INTEGER REFERENCES languages(id) ON DELETE SET NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  shuffle          INTEGER NOT NULL DEFAULT 0,
  allow_hints      INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  starts_at        TEXT,
  ends_at          TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assessment_questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  points        REAL NOT NULL DEFAULT 10,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (assessment_id, question_id)
);

CREATE TABLE IF NOT EXISTS student_assessments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','expired')),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at  TEXT,
  score         REAL NOT NULL DEFAULT 0,
  max_score     REAL NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  hints_used    INTEGER NOT NULL DEFAULT 0,
  time_spent_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_studentassess_user ON student_assessments(user_id);

CREATE TABLE IF NOT EXISTS student_assessment_answers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  student_assessment_id INTEGER NOT NULL REFERENCES student_assessments(id) ON DELETE CASCADE,
  question_id           INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  submission_id         INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
  score                 REAL NOT NULL DEFAULT 0,
  points                REAL NOT NULL DEFAULT 10,
  is_correct            INTEGER NOT NULL DEFAULT 0,
  attempts              INTEGER NOT NULL DEFAULT 0,
  hints_used            INTEGER NOT NULL DEFAULT 0,
  time_spent_ms         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (student_assessment_id, question_id)
);

-- ----------------------------------------------- collections/assignments
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_questions (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, question_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  due_at      TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignment_questions (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (assignment_id, question_id)
);

CREATE TABLE IF NOT EXISTS assignment_students (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (assignment_id, user_id)
);

-- --------------------------------------------------------- gamification
CREATE TABLE IF NOT EXISTS badges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT '🏅',
  criteria_type TEXT NOT NULL,   -- solved_total | streak | topic_solved | language_accuracy | perfect_streak | xp
  criteria_value REAL NOT NULL DEFAULT 0,
  scope_language TEXT,           -- language slug for scoped badges
  scope_topic    TEXT,           -- topic slug for scoped badges
  xp_reward     INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS student_badges (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS daily_challenges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  xp_bonus    INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS xp_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id);

-- --------------------------------------------------------------- system
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ------------------------------------------------------ question health
-- Every question's own reference solution, re-run through the real engine.
-- A question whose reference solution fails is unanswerable by anyone, and
-- nothing else in the platform would ever surface that.
CREATE TABLE IF NOT EXISTS question_health (
  question_id  INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('healthy','failing','unverifiable')),
  verdict      TEXT,
  message      TEXT,
  score        REAL,
  max_score    REAL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  checked_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_question_health_status ON question_health(status);

-- --------------------------------------------------- construct mastery
-- One row per construct the analyser found in a submitted fragment. The data
-- already existed inside submissions.feedback; this makes it queryable.
CREATE TABLE IF NOT EXISTS submission_constructs (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  construct     TEXT NOT NULL,
  was_required  INTEGER NOT NULL DEFAULT 0,
  is_correct    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (submission_id, construct)
);
CREATE INDEX IF NOT EXISTS idx_submission_constructs_user ON submission_constructs(user_id, construct);
CREATE INDEX IF NOT EXISTS idx_submission_constructs_construct ON submission_constructs(construct);

-- ---------------------------------------------------- spaced repetition
-- SM-2 scheduling over solved questions. Syntax decays fast and is cheap to
-- re-test, which is close to the ideal case for spaced repetition.
CREATE TABLE IF NOT EXISTS review_schedule (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id    INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  ease           REAL NOT NULL DEFAULT 2.5,
  interval_days  INTEGER NOT NULL DEFAULT 1,
  repetitions    INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  due_at         TEXT NOT NULL,
  last_review_at TEXT,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_schedule(user_id, due_at);

-- ------------------------------------------------ misconception hints
-- A hint attached to a *detected pattern* rather than a position in a list,
-- so feedback can name the actual mistake the student made.
CREATE TABLE IF NOT EXISTS question_misconceptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  hint            TEXT NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  -- match rules, all optional and ANDed together
  construct_used  TEXT NOT NULL DEFAULT '[]',   -- JSON: constructs that must be present
  construct_absent TEXT NOT NULL DEFAULT '[]',  -- JSON: constructs that must be absent
  fragment_regex  TEXT,                         -- matched against the fragment
  error_type      TEXT,                         -- restrict to one error type
  verdict         TEXT,                         -- restrict to one verdict
  times_matched   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_misconceptions_question ON question_misconceptions(question_id);
