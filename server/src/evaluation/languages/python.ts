import { analyzePython, execute } from '../../sandbox/index.js';
import type {
  AnalysisResult, EvaluableQuestion, ExecutionOutcome, LanguageAdapter, TestCaseSpec,
} from '../types.js';

/**
 * Python adapter.
 *
 * Static analysis runs through the CPython AST (see sandbox/harness/py_ast.py),
 * so "did the student use a for loop?" is answered by the parse tree rather
 * than by string matching - `print(*numbers)` can never masquerade as a loop.
 */
export const pythonAdapter: LanguageAdapter = {
  slug: 'python',
  runtime: 'python',
  monacoId: 'python',
  displayName: 'Python',
  executable: true,

  async analyzeFragment(fragment: string): Promise<AnalysisResult> {
    const raw = await analyzePython(fragment, { mode: 'analyze', kind: 'auto' });
    return toAnalysis(raw);
  },

  async analyzeProgram(program: string): Promise<AnalysisResult> {
    const raw = await analyzePython(program, { mode: 'analyze', kind: 'exec' });
    return toAnalysis(raw);
  },

  async isEquivalent(fragment: string, candidates: string[]): Promise<boolean> {
    if (candidates.length === 0) return false;
    const raw = await analyzePython(fragment, { mode: 'compare', candidates });
    return raw.ok === true && raw.equivalent === true;
  },

  async execute(program: string, test: TestCaseSpec, question: EvaluableQuestion): Promise<ExecutionOutcome> {
    const result = await execute({
      runtime: 'python',
      source: program,
      stdin: test.stdin ?? '',
      timeoutMs: question.timeLimitMs,
      memoryMb: question.memoryLimitMb,
    });

    const detail = result.detail as
      | { type?: string; message?: string; line?: number | null }
      | undefined;

    return {
      status: mapStatus(result.status),
      stdout: result.stdout,
      stderr: result.stderr,
      executionMs: result.durationMs,
      memoryKb: result.memoryKb,
      errorMessage: detail?.message
        ? `${detail.type ?? 'Error'}: ${detail.message}${detail.line ? ` (line ${detail.line})` : ''}`
        : result.status === 'ok'
          ? null
          : result.stderr || null,
    };
  },
};

function mapStatus(status: string): ExecutionOutcome['status'] {
  switch (status) {
    case 'ok': return 'ok';
    case 'compile_error': return 'compile_error';
    case 'timeout': return 'timeout';
    case 'restricted': return 'restricted';
    case 'memory_exceeded': return 'runtime_error';
    case 'internal_error': return 'internal_error';
    default: return 'runtime_error';
  }
}

function toAnalysis(raw: any): AnalysisResult {
  if (!raw || raw.ok !== true) {
    return {
      ok: false,
      constructs: [],
      error: raw?.error ?? { type: 'SyntaxError', message: 'Could not parse your code.' },
    };
  }
  return {
    ok: true,
    constructs: raw.constructs ?? [],
    dump: raw.dump,
    details: {
      parsedAs: raw.parsedAs,
      statements: raw.statements,
      nodeTypes: raw.nodeTypes,
      calls: raw.calls,
      methods: raw.methods,
      names: raw.names,
      imports: raw.imports,
      maxLoopDepth: raw.maxLoopDepth,
    },
  };
}
