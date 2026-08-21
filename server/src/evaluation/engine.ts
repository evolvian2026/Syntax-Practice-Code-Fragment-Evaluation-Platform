import { assemble, mapLineToFragment, TemplateError } from './assembler.js';
import { runGuards } from './checks/guards.js';
import { compareOutput, compareText, resultSetToText } from './comparators.js';
import { getAdapter, UnsupportedLanguageError } from './languages/registry.js';
import { describeConstruct } from './constructs.js';
import type {
  AnalysisResult, EvaluableQuestion, EvaluationRequest, EvaluationResult,
  ExecutionOutcome, StageResult, TestCaseSpec, TestOutcome, Verdict,
} from './types.js';

/**
 * Fragment evaluation engine (§2, §3, §12).
 *
 * Pipeline, short-circuiting on the first hard failure:
 *
 *   guard      restrictions, length, required/forbidden keywords
 *   syntax     does the fragment parse at all?
 *   construct  did the student use the construct the question is teaching?
 *   execution  assemble the full program and run it in the sandbox
 *   tests      public + hidden test cases
 *
 * The construct stage runs *before* execution results are trusted, which is
 * what lets the platform say "output is correct, but the question requires a
 * FOR loop" instead of silently accepting `print(*numbers)`.
 */

const MAX_STORED_OUTPUT = 8000;

export async function evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
  const { question, fragment } = request;
  const stages: StageResult[] = [];
  const base = emptyResult(question);

  let adapter;
  try {
    adapter = getAdapter(question.languageSlug);
  } catch (err) {
    if (err instanceof UnsupportedLanguageError) {
      return fail(base, stages, 'ERROR', 'internal', err.message, err.message);
    }
    throw err;
  }

  // ---------------------------------------------------------- 1. guards
  const guard = runGuards(fragment, question);
  stages.push(guard.stage);
  if (guard.blocked) {
    const verdict: Verdict = fragment.trim() ? 'RESTRICTED' : 'EMPTY';
    return fail(base, stages, verdict, 'restricted', guard.stage.message ?? 'Restricted code.', guard.stage.message ?? '');
  }

  // ------------------------------------------------ 2. assemble program
  // Assembly is textual, so it happens before parsing: a student whose
  // fragment does not compile can still see exactly what would have run.
  let assembled;
  try {
    assembled = assemble(question, fragment, adapter.setupIsData ? null : question.testCases[0] ?? null);
  } catch (err) {
    if (err instanceof TemplateError) {
      return fail(base, stages, 'ERROR', 'internal', err.message, err.message);
    }
    throw err;
  }
  base.generatedCode = assembled.program;

  // ------------------------------------------------- 3. fragment syntax
  const analysis = await adapter.analyzeFragment(fragment, question);
  if (!analysis.ok) {
    const message = formatSyntaxError(analysis);
    stages.push({ stage: 'syntax', passed: false, title: 'Syntax', message, details: analysis.error ?? undefined });
    return fail(base, stages, 'SYNTAX_ERROR', 'syntax', message, message);
  }
  stages.push({ stage: 'syntax', passed: true, title: 'Syntax', message: 'Your fragment parses correctly.' });
  base.detectedConstructs = analysis.constructs;

  // --------------------------------------------- 4. required constructs
  const constructCheck = checkConstructs(analysis.constructs, question);
  stages.push(constructCheck.stage);
  base.missingConstructs = constructCheck.missing;
  base.usedForbiddenConstructs = constructCheck.forbidden;

  // -------------------------------------------------- 5. grade the body
  const graded = await gradeByType(request, adapter, analysis, stages);
  Object.assign(base, graded.patch);
  base.stages = stages;

  // The construct rule is decisive: correct output with the wrong construct
  // is still wrong, and that is the whole point of the platform (§12).
  if (!constructCheck.passed) {
    const outputWasFine = graded.outputCorrect;
    const message = constructMessage(question, constructCheck, outputWasFine);
    base.verdict = 'WRONG_CONSTRUCT';
    base.isCorrect = false;
    base.errorType = 'conceptual';
    base.errorMessage = message;
    base.feedback = message;
    base.score = 0;
    return finalize(base, request);
  }

  return finalize(base, request);
}

// --------------------------------------------------------------- stages

interface ConstructCheck {
  passed: boolean;
  missing: string[];
  forbidden: string[];
  stage: StageResult;
}

function checkConstructs(detected: string[], question: EvaluableQuestion): ConstructCheck {
  const present = new Set(detected);
  const missing = (question.requiredConstructs ?? []).filter((c) => !satisfies(present, c));
  const forbidden = (question.forbiddenConstructs ?? []).filter((c) => satisfies(present, c));
  const passed = missing.length === 0 && forbidden.length === 0;

  let message: string;
  if (passed) {
    message = question.requiredConstructs?.length
      ? `Uses the required construct${question.requiredConstructs.length === 1 ? '' : 's'}: ${question.requiredConstructs.map(describeConstruct).join(', ')}.`
      : 'No construct restrictions on this question.';
  } else {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.map(describeConstruct).join(', ')}`);
    if (forbidden.length) parts.push(`uses disallowed ${forbidden.map(describeConstruct).join(', ')}`);
    message = `Your answer ${parts.join(' and ')}.`;
  }

  return {
    passed,
    missing,
    forbidden,
    stage: {
      stage: 'construct',
      passed,
      title: 'Required construct',
      message,
      details: { detected, required: question.requiredConstructs, forbidden: question.forbiddenConstructs },
    },
  };
}

/** Supports `ANY:A|B` (either construct satisfies the requirement). */
function satisfies(present: Set<string>, requirement: string): boolean {
  if (requirement.startsWith('ANY:')) {
    return requirement.slice(4).split('|').some((r) => present.has(r.trim()));
  }
  return present.has(requirement);
}

function constructMessage(question: EvaluableQuestion, check: ConstructCheck, outputWasFine: boolean): string {
  const custom = question.config.constructMessage;
  if (custom) return custom;

  const missingLabel = check.missing.map(describeConstruct).join(', ');
  const forbiddenLabel = check.forbidden.map(describeConstruct).join(', ');

  if (check.missing.length > 0) {
    return outputWasFine
      ? `Output is correct, but the question requires ${missingLabel}.`
      : `Your answer does not use ${missingLabel}, which this question is practising.`;
  }
  return `This question does not allow ${forbiddenLabel}.`;
}

// ------------------------------------------------------------- grading

interface GradeOutcome {
  patch: Partial<EvaluationResult>;
  outputCorrect: boolean;
}

async function gradeByType(
  request: EvaluationRequest,
  adapter: ReturnType<typeof getAdapter>,
  analysis: AnalysisResult,
  stages: StageResult[],
): Promise<GradeOutcome> {
  const { question } = request;

  switch (question.evaluationType) {
    case 'AST':
      return gradeAstOnly(stages);
    case 'SYNTAX':
      return gradeSyntax(request, adapter, stages);
    case 'TEXT':
      return gradeText(request, stages);
    case 'STATIC':
      return gradeStatic(request, adapter, analysis, stages);
    case 'VALUE':
    case 'OUTPUT':
    case 'SQL_RESULT':
    case 'COMPOSITE':
    default:
      return gradeByExecution(request, adapter, stages);
  }
}

/** AST-only questions are already decided by the construct stage. */
function gradeAstOnly(stages: StageResult[]): GradeOutcome {
  const construct = stages.find((s) => s.stage === 'construct');
  const passed = construct?.passed ?? true;
  stages.push({
    stage: 'tests',
    passed,
    title: 'Structure check',
    message: passed ? 'Your code has the required structure.' : (construct?.message ?? 'Structure check failed.'),
  });
  return {
    outputCorrect: passed,
    patch: {
      verdict: passed ? 'CORRECT' : 'WRONG_CONSTRUCT',
      isCorrect: passed,
      testsPassed: passed ? 1 : 0,
      testsFailed: passed ? 0 : 1,
      feedback: passed ? 'Correct - the required construct is present.' : (construct?.message ?? ''),
      errorType: passed ? 'none' : 'conceptual',
    },
  };
}

async function gradeSyntax(
  request: EvaluationRequest,
  adapter: ReturnType<typeof getAdapter>,
  stages: StageResult[],
): Promise<GradeOutcome> {
  const { question, fragment } = request;
  let matched = false;

  if (adapter.isEquivalent && question.acceptedSolutions.length > 0) {
    matched = await adapter.isEquivalent(fragment, question.acceptedSolutions, question);
  }
  if (!matched) {
    for (const pattern of question.config.acceptRegex ?? []) {
      try {
        if (new RegExp(pattern, 'm').test(fragment.trim())) { matched = true; break; }
      } catch { /* an invalid admin-supplied pattern must not crash grading */ }
    }
  }

  stages.push({
    stage: 'equivalence',
    passed: matched,
    title: 'Syntax match',
    message: matched
      ? 'Your fragment matches the expected construct (formatting differences are ignored).'
      : 'Your fragment is valid code, but it is not the construct this question asks for.',
  });

  return {
    outputCorrect: matched,
    patch: {
      verdict: matched ? 'CORRECT' : 'WRONG_OUTPUT',
      isCorrect: matched,
      testsPassed: matched ? 1 : 0,
      testsFailed: matched ? 0 : 1,
      feedback: matched
        ? 'Correct syntax.'
        : 'That is not the construct this question asks for. Check the question statement and try again.',
      errorType: matched ? 'none' : 'conceptual',
    },
  };
}

function gradeText(request: EvaluationRequest, stages: StageResult[]): GradeOutcome {
  const { question, fragment } = request;
  const accepted = question.config.acceptedText
    ?? question.testCases.map((t) => t.expectedOutput ?? '').filter(Boolean);
  const passed = compareText(fragment, accepted, question.config.caseSensitive ?? false);

  stages.push({
    stage: 'tests',
    passed,
    title: 'Answer check',
    message: passed ? 'Your answer matches the expected output.' : 'That is not the output this code produces.',
  });

  return {
    outputCorrect: passed,
    patch: {
      verdict: passed ? 'CORRECT' : 'WRONG_OUTPUT',
      isCorrect: passed,
      testsPassed: passed ? 1 : 0,
      testsFailed: passed ? 0 : 1,
      stdout: fragment,
      feedback: passed ? 'Correct.' : 'Not quite - trace the code line by line and try again.',
      errorType: passed ? 'none' : 'conceptual',
    },
  };
}

async function gradeStatic(
  request: EvaluationRequest,
  adapter: ReturnType<typeof getAdapter>,
  analysis: AnalysisResult,
  stages: StageResult[],
): Promise<GradeOutcome> {
  const { question, fragment } = request;

  if (!adapter.staticEvaluate) {
    return gradeSyntax(request, adapter, stages);
  }
  const outcome = await adapter.staticEvaluate(fragment, question);

  // An accepted-solution match is always enough, even if the rule spec is thin.
  let passed = outcome.passed;
  if (!passed && adapter.isEquivalent && question.acceptedSolutions.length > 0) {
    passed = await adapter.isEquivalent(fragment, question.acceptedSolutions, question);
  }

  stages.push({
    stage: 'tests',
    passed,
    title: 'Markup check',
    message: passed ? 'Your answer meets every requirement.' : outcome.message,
    details: outcome.details,
  });

  return {
    outputCorrect: passed,
    patch: {
      verdict: passed ? 'CORRECT' : 'WRONG_OUTPUT',
      isCorrect: passed,
      testsPassed: passed ? 1 : 0,
      testsFailed: passed ? 0 : 1,
      feedback: passed ? 'Correct.' : outcome.message,
      errorType: passed ? 'none' : 'conceptual',
      stdout: fragment,
    },
  };
}

async function gradeByExecution(
  request: EvaluationRequest,
  adapter: ReturnType<typeof getAdapter>,
  stages: StageResult[],
): Promise<GradeOutcome> {
  const { question, fragment, mode } = request;

  if (!adapter.execute) {
    return gradeSyntax(request, adapter, stages);
  }

  // `run` only exercises public tests; `submit` runs the hidden ones too (§13).
  const tests = selectTests(question.testCases, mode);
  if (tests.length === 0) {
    return gradeSyntax(request, adapter, stages);
  }

  const outcomes: TestOutcome[] = [];
  let firstStdout = '';
  let firstStderr = '';
  let totalMs = 0;
  let peakMemory = 0;
  let resultSet: EvaluationResult['resultSet'] = null;
  let hardFailure: { verdict: Verdict; errorType: EvaluationResult['errorType']; message: string } | null = null;

  for (const [index, test] of tests.entries()) {
    const assembled = assemble(question, fragment, adapter.setupIsData ? null : test);
    let exec: ExecutionOutcome;
    try {
      exec = await adapter.execute(assembled.program, test, question);
    } catch (err) {
      exec = {
        status: 'internal_error',
        stdout: '', stderr: err instanceof Error ? err.message : String(err),
        executionMs: 0, memoryKb: 0,
        errorMessage: 'The evaluation service could not run your code.',
      };
    }

    totalMs += exec.executionMs;
    peakMemory = Math.max(peakMemory, exec.memoryKb);
    if (index === 0) {
      firstStdout = exec.stdout;
      firstStderr = exec.stderr;
      resultSet = exec.resultSet ?? null;
    }

    if (exec.status !== 'ok') {
      const mapped = mapExecutionFailure(exec, assembled, question);
      hardFailure = mapped;
      outcomes.push({
        testCaseId: test.id,
        name: test.name ?? `Test ${index + 1}`,
        visibility: test.visibility,
        passed: false,
        expected: test.visibility === 'public' ? (test.expectedOutput ?? '') : undefined,
        actual: test.visibility === 'public' ? exec.stdout : undefined,
        message: mapped.message,
        stderr: test.visibility === 'public' ? exec.stderr : undefined,
        executionMs: exec.executionMs,
        weight: test.weight,
      });
      break; // a crashing program fails every remaining test identically
    }

    const comparison = question.evaluationType === 'SQL_RESULT' && exec.resultSet
      ? compareSqlOutcome(exec, test, question)
      : compareOutput(exec.stdout, test);

    outcomes.push({
      testCaseId: test.id,
      name: test.name ?? `Test ${index + 1}`,
      visibility: test.visibility,
      passed: comparison.passed,
      expected: test.visibility === 'public' ? comparison.expected : undefined,
      actual: test.visibility === 'public' ? comparison.actual : undefined,
      message: comparison.passed ? undefined : (test.visibility === 'public' ? comparison.message : 'Hidden test failed.'),
      stdout: test.visibility === 'public' ? exec.stdout : undefined,
      executionMs: exec.executionMs,
      weight: test.weight,
    });
  }

  const passedCount = outcomes.filter((o) => o.passed).length;
  const failedCount = outcomes.length - passedCount;
  const allPassed = failedCount === 0 && outcomes.length > 0;

  stages.push({
    stage: 'execution',
    passed: hardFailure === null,
    title: 'Execution',
    message: hardFailure ? hardFailure.message : 'Your code ran without errors.',
  });
  stages.push({
    stage: 'tests',
    passed: allPassed,
    title: 'Test cases',
    message: `${passedCount} of ${outcomes.length} test case${outcomes.length === 1 ? '' : 's'} passed.`,
  });

  const verdict: Verdict = hardFailure ? hardFailure.verdict : allPassed ? 'CORRECT' : 'WRONG_OUTPUT';

  return {
    outputCorrect: allPassed,
    patch: {
      verdict,
      isCorrect: allPassed,
      tests: outcomes,
      testsPassed: passedCount,
      testsFailed: failedCount,
      stdout: truncate(firstStdout),
      stderr: truncate(firstStderr),
      executionMs: totalMs,
      memoryKb: peakMemory,
      resultSet,
      errorType: hardFailure ? hardFailure.errorType : allPassed ? 'none' : 'conceptual',
      errorMessage: hardFailure ? hardFailure.message : null,
      feedback: hardFailure
        ? hardFailure.message
        : allPassed
          ? 'All test cases passed.'
          : firstFailureMessage(outcomes),
    },
  };
}

function compareSqlOutcome(exec: ExecutionOutcome, test: TestCaseSpec, question: EvaluableQuestion) {
  // The expected result is stored as text; comparing the rendered grid keeps
  // authoring simple while still ignoring column aliases.
  const actualText = exec.resultSet ? resultSetToText(exec.resultSet) : exec.stdout;
  const ordered = question.config.sqlOrdered
    ?? (question.requiredConstructs ?? []).includes('ORDER_BY');
  const effective: TestCaseSpec = {
    ...test,
    matcher: test.matcher === 'exact' ? 'trimmed' : ordered ? 'normalized' : 'unordered_rows',
  };
  return compareOutput(actualText, effective);
}

function selectTests(all: TestCaseSpec[], mode: 'run' | 'submit'): TestCaseSpec[] {
  const sorted = [...all].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  if (mode === 'run') {
    const publics = sorted.filter((t) => t.visibility === 'public');
    return publics.length > 0 ? publics : sorted.slice(0, 1);
  }
  return sorted;
}

function mapExecutionFailure(
  exec: ExecutionOutcome,
  assembled: ReturnType<typeof assemble>,
  question: EvaluableQuestion,
): { verdict: Verdict; errorType: EvaluationResult['errorType']; message: string } {
  const detail = exec.errorMessage ?? exec.stderr ?? 'Execution failed.';
  switch (exec.status) {
    case 'timeout':
      return {
        verdict: 'TIMEOUT',
        errorType: 'timeout',
        message: `Your code did not finish within ${question.timeLimitMs} ms. Check for a loop that never ends.`,
      };
    case 'restricted':
      return { verdict: 'RESTRICTED', errorType: 'restricted', message: detail };
    case 'compile_error':
      return {
        verdict: question.runtime === 'python' ? 'SYNTAX_ERROR' : 'COMPILE_ERROR',
        errorType: 'syntax',
        message: relocateLine(detail, assembled),
      };
    case 'internal_error':
      return { verdict: 'ERROR', errorType: 'internal', message: detail };
    case 'runtime_error':
    default:
      return {
        verdict: 'RUNTIME_ERROR',
        errorType: question.runtime === 'sql' ? 'sql' : 'runtime',
        message: relocateLine(detail, assembled),
      };
  }
}

/** Rewrites "line N" of the generated program into the student's own numbering. */
function relocateLine(message: string, assembled: ReturnType<typeof assemble>): string {
  return message.replace(/\bline (\d+)\b/gi, (whole, num) => {
    const mapped = mapLineToFragment(assembled, Number(num));
    if (!mapped) return whole;
    return mapped.inFragment
      ? `line ${mapped.line} of your answer`
      : 'the provided code (check what your fragment passes to it)';
  });
}

function firstFailureMessage(outcomes: TestOutcome[]): string {
  const failed = outcomes.find((o) => !o.passed);
  if (!failed) return 'Some test cases failed.';
  if (failed.visibility === 'hidden') {
    return 'Your answer passes the visible tests but fails a hidden test case. Check the edge cases.';
  }
  return failed.message ?? 'Your output did not match the expected output.';
}

// ------------------------------------------------------------ finishing

function finalize(result: EvaluationResult, request: EvaluationRequest): EvaluationResult {
  result.score = computeScore(result, request);
  return result;
}

/** §15 + §23 - hints reduce the score, a revealed solution zeroes it. */
export function computeScore(result: EvaluationResult, request: EvaluationRequest): number {
  if (!result.isCorrect) {
    // Partial credit for passing some tests, never for the wrong construct.
    if (result.verdict === 'WRONG_OUTPUT' && result.tests.length > 1) {
      // Passing only the visible example is not partial progress — it is what a
      // hardcoded answer looks like (§13), so it earns nothing.
      const hidden = result.tests.filter((t) => t.visibility === 'hidden');
      if (hidden.length > 0 && !hidden.some((t) => t.passed)) return 0;

      const total = result.tests.reduce((sum, t) => sum + t.weight, 0) || 1;
      const earned = result.tests.filter((t) => t.passed).reduce((sum, t) => sum + t.weight, 0);
      const partial = Math.round((earned / total) * result.maxScore * 0.5);
      if (partial > 0) result.verdict = 'PARTIAL';
      return partial;
    }
    return 0;
  }
  if (request.solutionRevealed) return 0;

  const hints = request.hintsUsed ?? 0;
  const penaltyPercent = Math.min(hints * 15, 60);
  return Math.round(result.maxScore * (1 - penaltyPercent / 100));
}

function emptyResult(question: EvaluableQuestion): EvaluationResult {
  return {
    verdict: 'ERROR',
    isCorrect: false,
    score: 0,
    maxScore: question.maxScore,
    errorType: 'none',
    errorMessage: null,
    feedback: '',
    stages: [],
    tests: [],
    testsPassed: 0,
    testsFailed: 0,
    generatedCode: '',
    stdout: '',
    stderr: '',
    executionMs: 0,
    memoryKb: 0,
    detectedConstructs: [],
    missingConstructs: [],
    usedForbiddenConstructs: [],
    resultSet: null,
  };
}

/** Short-circuits the pipeline, preserving anything already computed. */
function fail(
  base: EvaluationResult,
  stages: StageResult[],
  verdict: Verdict,
  errorType: EvaluationResult['errorType'],
  message: string,
  feedback: string,
): EvaluationResult {
  base.stages = stages;
  base.verdict = verdict;
  base.errorType = errorType;
  base.errorMessage = message;
  base.feedback = feedback || message;
  base.isCorrect = false;
  base.score = 0;
  return base;
}

function formatSyntaxError(analysis: AnalysisResult): string {
  const err = analysis.error;
  if (!err) return 'Your code could not be parsed.';
  const where = err.line ? ` (line ${err.line}${err.offset ? `, column ${err.offset}` : ''})` : '';
  return `${err.type}: ${err.message}${where}`;
}

function truncate(value: string): string {
  return value.length > MAX_STORED_OUTPUT
    ? `${value.slice(0, MAX_STORED_OUTPUT)}\n... output truncated ...`
    : value;
}

