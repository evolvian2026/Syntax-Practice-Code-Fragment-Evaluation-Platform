/** Canonical evaluation vocabulary shared by the API, engine and UI. */

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

/** §11 — question types */
export type QuestionType =
  | 'FILL_CODE'            // Type 1 — fill the missing fragment
  | 'COMPLETE_STATEMENT'   // Type 2 — numbers.{{STUDENT_CODE}}
  | 'COMPLETE_CONDITION'   // Type 3 — if {{STUDENT_CODE}}:
  | 'COMPLETE_LOOP'        // Type 4
  | 'COMPLETE_SQL_CLAUSE'  // Type 5
  | 'CHOOSE_AND_WRITE'     // Type 6 — pick an option, then write the fragment
  | 'FIX_SYNTAX'           // Type 7 — broken code, fix one region
  | 'PREDICT_OUTPUT'       // Type 8 — write/select the output
  | 'IDENTIFY_SYNTAX';     // Type 9 — write the construct for a requirement

/** §3 + §12 — evaluation mechanisms */
export type EvaluationType =
  | 'OUTPUT'      // execute and compare stdout
  | 'SYNTAX'      // parse the fragment and compare structurally with accepted forms
  | 'AST'         // required/forbidden constructs only
  | 'SQL_RESULT'  // execute against the sandbox database, compare result sets
  | 'VALUE'       // evaluate an expression and compare the resulting value
  | 'STATIC'      // markup/style analysis (HTML/CSS)
  | 'TEXT'        // free-text answer (predict output)
  | 'COMPOSITE';  // constructs + execution + syntax, all must pass

export type Verdict =
  | 'CORRECT'
  | 'PARTIAL'
  | 'WRONG_OUTPUT'
  | 'WRONG_CONSTRUCT'
  | 'SYNTAX_ERROR'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIMEOUT'
  | 'RESTRICTED'
  | 'EMPTY'
  | 'ERROR';

export type ErrorType =
  | 'none' | 'syntax' | 'runtime' | 'timeout' | 'restricted'
  | 'conceptual' | 'sql' | 'internal';

export type StageName = 'guard' | 'syntax' | 'construct' | 'execution' | 'tests' | 'equivalence';

export interface StageResult {
  stage: StageName;
  passed: boolean;
  title: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface TestCaseSpec {
  id?: number;
  visibility: 'public' | 'hidden';
  name?: string | null;
  setupCode?: string | null;
  stdin?: string | null;
  expectedOutput?: string | null;
  expectedValue?: string | null;
  matcher: 'exact' | 'trimmed' | 'normalized' | 'contains' | 'regex' | 'unordered_rows' | 'rows';
  weight: number;
  displayOrder?: number;
}

export interface TestOutcome {
  testCaseId?: number;
  name: string;
  visibility: 'public' | 'hidden';
  passed: boolean;
  expected?: string;
  actual?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
  executionMs: number;
  weight: number;
}

/** Everything the engine needs about a question. Mirrors the `questions` row. */
export interface EvaluableQuestion {
  id: number;
  qid: string;
  languageSlug: string;
  runtime: string;
  difficulty: Difficulty;
  questionType: QuestionType;
  evaluationType: EvaluationType;
  title: string;
  statement: string;
  starterCode: string;
  hiddenPrefix?: string | null;
  hiddenSuffix?: string | null;
  indentFragment: boolean;
  requiredConstructs: string[];
  forbiddenConstructs: string[];
  requiredKeywords: string[];
  forbiddenKeywords: string[];
  maxCodeLength: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  maxScore: number;
  testCases: TestCaseSpec[];
  /** Accepted fragment forms for SYNTAX/equivalence grading. */
  acceptedSolutions: string[];
  config: QuestionConfig;
  dataset?: SqlDataset | null;
  explanation?: string | null;
}

/** Free-form evaluator extras stored in questions.config */
export interface QuestionConfig {
  /** SYNTAX: also accept anything matching these regexes. */
  acceptRegex?: string[];
  /** STATIC (HTML): required tag/attribute assertions. */
  html?: {
    tag?: string;
    minCount?: number;
    attributes?: Record<string, string>;
    textEquals?: string;
    textContains?: string;
    selector?: string;
  };
  /** STATIC (CSS): required declarations. */
  css?: {
    selector?: string;
    declarations?: Record<string, string>;
    requireProperties?: string[];
  };
  /** VALUE: expression whose value is compared (defaults to the fragment). */
  valueExpression?: string;
  /** TEXT: accepted answers for predict-output questions. */
  acceptedText?: string[];
  caseSensitive?: boolean;
  /** SQL: forbid clauses the question is not about. */
  sqlForbidClauses?: string[];
  /** SQL: compare row order strictly (defaults to false unless ORDER BY is required). */
  sqlOrdered?: boolean;
  /** OUTPUT: normalise whitespace before comparing (default true). */
  normalizeWhitespace?: boolean;
  /** Message shown when the required construct is missing. */
  constructMessage?: string;
  [key: string]: unknown;
}

export interface SqlDataset {
  id?: number;
  slug: string;
  name: string;
  dialect: string;
  schemaSql: string;
  seedSql: string;
  preview?: unknown;
}

export interface EvaluationRequest {
  question: EvaluableQuestion;
  fragment: string;
  mode: 'run' | 'submit';
  hintsUsed?: number;
  solutionRevealed?: boolean;
  /** CHOOSE_AND_WRITE: option the student picked. */
  selectedOption?: string | null;
}

export interface EvaluationResult {
  verdict: Verdict;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  errorType: ErrorType;
  errorMessage?: string | null;
  /** Short, student-facing headline, e.g. "Output is correct, but the question requires a FOR loop." */
  feedback: string;
  stages: StageResult[];
  tests: TestOutcome[];
  testsPassed: number;
  testsFailed: number;
  generatedCode: string;
  stdout: string;
  stderr: string;
  executionMs: number;
  memoryKb: number;
  /** Constructs the analyser actually found — powers admin analytics. */
  detectedConstructs: string[];
  missingConstructs: string[];
  usedForbiddenConstructs: string[];
  /** SQL result grid for the student-facing output panel. */
  resultSet?: { columns: string[]; rows: unknown[][] } | null;
}

export interface AnalysisResult {
  ok: boolean;
  constructs: string[];
  error?: { type: string; message: string; line?: number | null; offset?: number | null; text?: string } | null;
  /** structural fingerprint for equivalence checks */
  dump?: string;
  details?: Record<string, unknown>;
}

/** Contract every language plugs into (§6, §29 — new languages need no engine change). */
export interface LanguageAdapter {
  readonly slug: string;
  readonly runtime: string;
  readonly monacoId: string;
  readonly displayName: string;
  readonly executable: boolean;
  /**
   * When true, a test case's `setupCode` is extra *data* for the runtime (e.g.
   * additional rows seeded into the SQL sandbox) rather than source code to be
   * spliced into the template.
   */
  readonly setupIsData?: boolean;

  /** Static parse + construct extraction of the *fragment* (never executes). */
  analyzeFragment(fragment: string, question: EvaluableQuestion): Promise<AnalysisResult>;

  /** Static parse of the fully assembled program, when it differs meaningfully. */
  analyzeProgram?(program: string, question: EvaluableQuestion): Promise<AnalysisResult>;

  /** Structural equivalence with accepted solutions (SYNTAX evaluation). */
  isEquivalent?(fragment: string, candidates: string[], question: EvaluableQuestion): Promise<boolean>;

  /** Execute one test case against the assembled program. */
  execute?(program: string, test: TestCaseSpec, question: EvaluableQuestion): Promise<ExecutionOutcome>;

  /** Fully custom grading for non-executable languages (HTML/CSS). */
  staticEvaluate?(fragment: string, question: EvaluableQuestion): Promise<StaticEvaluation>;
}

export interface ExecutionOutcome {
  status: 'ok' | 'compile_error' | 'runtime_error' | 'timeout' | 'restricted' | 'internal_error';
  stdout: string;
  stderr: string;
  executionMs: number;
  memoryKb: number;
  errorMessage?: string | null;
  resultSet?: { columns: string[]; rows: unknown[][] } | null;
}

export interface StaticEvaluation {
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
  constructs?: string[];
}
