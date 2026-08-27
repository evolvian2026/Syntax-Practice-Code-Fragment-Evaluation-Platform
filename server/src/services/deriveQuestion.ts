import { db } from '../db/index.js';
import { STUDENT_MARKER, assemble } from '../evaluation/assembler.js';
import { getAdapter } from '../evaluation/languages/registry.js';
import type { EvaluableQuestion, SqlDataset, TestCaseSpec } from '../evaluation/types.js';

/**
 * Authoring a question from a program that already works.
 *
 * Writing a question by hand means transcribing the template, naming the
 * constructs and typing the expected output — three chances to get it wrong,
 * and the last one is why questions rot. Here the author pastes a working
 * program, says which lines the student should write, and everything else is
 * derived from the program itself:
 *
 *   template          — the selected lines replaced with {{STUDENT_CODE}}
 *   solution          — the selected lines, dedented
 *   requiredConstructs— what the analyser finds in that selection
 *   expectedOutput    — what the program actually prints when run
 *
 * The seeder has always resolved `expected: 'AUTO'` this way. This exposes the
 * same idea to the question builder.
 */

export interface DeriveRequest {
  language: string;
  program: string;
  /** 1-based, inclusive line range the student will write. */
  startLine: number;
  endLine: number;
  dataset?: string | null;
  stdin?: string | null;
  timeLimitMs?: number;
}

export interface DeriveResult {
  starterCode: string;
  solution: string;
  requiredConstructs: string[];
  detectedConstructs: string[];
  expectedOutput: string | null;
  /** Populated when the program could not be run, e.g. a missing toolchain. */
  executionError: string | null;
  warnings: string[];
}

export class DeriveError extends Error {}

export async function deriveQuestion(request: DeriveRequest): Promise<DeriveResult> {
  const adapter = getAdapter(request.language);
  const lines = request.program.replace(/\r\n/g, '\n').split('\n');

  const start = request.startLine;
  const end = request.endLine;
  if (start < 1 || end < start || end > lines.length) {
    throw new DeriveError(
      `Selected lines ${start}-${end} are outside the program, which has ${lines.length} lines.`,
    );
  }

  const selected = lines.slice(start - 1, end);
  if (selected.every((line) => line.trim() === '')) {
    throw new DeriveError('The selected lines are blank — select the code the student should write.');
  }

  // The marker inherits the selection's indentation so the assembler can
  // re-indent a fragment the student writes at column zero.
  const indent = commonIndent(selected);
  const solution = selected.map((line) => line.slice(indent)).join('\n').replace(/\s+$/, '');

  const starterCode = [
    ...lines.slice(0, start - 1),
    `${' '.repeat(indent)}${STUDENT_MARKER}`,
    ...lines.slice(end),
  ].join('\n').replace(/\s+$/, '');

  const warnings: string[] = [];

  // What the student's own lines contain — that is what the question is about.
  let detected: string[] = [];
  const probe = minimalQuestion(request, starterCode, null);
  const analysis = await adapter.analyzeFragment(solution, probe).catch(() => null);
  if (!analysis || !analysis.ok) {
    warnings.push(
      'The selected lines could not be parsed on their own, so no constructs were detected. '
      + 'Pick the required constructs by hand.',
    );
  } else {
    detected = analysis.constructs;
  }

  const { expectedOutput, executionError } = await runProgram(request, adapter, starterCode, solution);
  if (executionError) {
    warnings.push('The program did not run cleanly, so no expected output was filled in.');
  }

  return {
    starterCode,
    solution,
    requiredConstructs: pickRequired(detected),
    detectedConstructs: detected,
    expectedOutput,
    executionError,
    warnings,
  };
}

/**
 * Executes the program exactly as a submission would, so the recorded
 * expectation is what the platform will actually compare against — not what
 * the author believes the program prints.
 */
async function runProgram(
  request: DeriveRequest,
  adapter: ReturnType<typeof getAdapter>,
  starterCode: string,
  solution: string,
): Promise<{ expectedOutput: string | null; executionError: string | null }> {
  if (!adapter.execute) return { expectedOutput: null, executionError: null };

  let dataset: SqlDataset | null = null;
  if (request.dataset) {
    const row = db().prepare('SELECT * FROM sql_datasets WHERE slug = ?').get(request.dataset) as any;
    if (!row) throw new DeriveError(`Unknown SQL dataset "${request.dataset}".`);
    dataset = {
      id: row.id, slug: row.slug, name: row.name, dialect: row.dialect,
      schemaSql: row.schema_sql, seedSql: row.seed_sql,
    };
  }

  const spec: TestCaseSpec = {
    visibility: 'public',
    setupCode: null,
    stdin: request.stdin ?? null,
    expectedOutput: null,
    matcher: 'trimmed',
    weight: 1,
  };

  const assembled = assemble(
    { starterCode, hiddenPrefix: null, hiddenSuffix: null, indentFragment: true },
    solution,
    adapter.setupIsData ? null : spec,
  );

  try {
    const outcome = await adapter.execute(
      assembled.program,
      spec,
      minimalQuestion(request, starterCode, dataset),
    );

    if (outcome.status !== 'ok') {
      return {
        expectedOutput: null,
        executionError: outcome.errorMessage || outcome.stderr || `Execution ${outcome.status}.`,
      };
    }

    return {
      expectedOutput: outcome.resultSet
        ? resultSetToText(outcome.resultSet)
        : outcome.stdout.replace(/\n+$/, ''),
      executionError: null,
    };
  } catch (err) {
    return { expectedOutput: null, executionError: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A question shaped just enough for an adapter to work with. No adapter reads
 * more than the runtime limits and the dataset today, but passing a real
 * object rather than an empty cast keeps that from becoming a silent failure.
 */
function minimalQuestion(
  request: DeriveRequest,
  starterCode: string,
  dataset: SqlDataset | null,
): EvaluableQuestion {
  return {
    id: 0,
    qid: 'DERIVED',
    languageSlug: request.language,
    runtime: getAdapter(request.language).runtime,
    difficulty: 'Easy',
    questionType: 'FILL_CODE',
    evaluationType: dataset ? 'SQL_RESULT' : 'OUTPUT',
    title: 'Derived',
    statement: '',
    starterCode,
    hiddenPrefix: null,
    hiddenSuffix: null,
    indentFragment: true,
    requiredConstructs: [],
    forbiddenConstructs: [],
    requiredKeywords: [],
    forbiddenKeywords: [],
    maxCodeLength: 20000,
    timeLimitMs: request.timeLimitMs ?? 4000,
    memoryLimitMb: 128,
    maxScore: 100,
    testCases: [],
    acceptedSolutions: [],
    config: {},
    dataset,
  };
}

/**
 * The smallest indentation across non-blank lines — the column the marker
 * belongs in.
 */
function commonIndent(lines: string[]): number {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    min = Math.min(min, line.length - line.trimStart().length);
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * Which detected constructs to require by default.
 *
 * Requiring everything the analyser saw would make a question reject any
 * reasonable variation — a student who writes the loop with a different
 * comparison operator would fail. Structural constructs are what the question
 * is teaching; incidental ones (a name, a literal, an operator) are not.
 */
const INCIDENTAL = /^(NAME|ASSIGNMENT|CALL|OP_|COMPARISON|STRING|NUMBER|PASS|EXPRESSION)/;

export function pickRequired(detected: string[]): string[] {
  const structural = detected.filter((c) => !INCIDENTAL.test(c));
  // Keep it to a handful: a question with eight requirements is a question
  // with eight ways to be wrong for the wrong reason.
  return structural.slice(0, 3);
}

function resultSetToText(resultSet: { columns: string[]; rows: unknown[][] }): string {
  const header = resultSet.columns.join(' | ');
  const body = resultSet.rows.map((row) => row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | '));
  return [header, ...body].join('\n');
}
