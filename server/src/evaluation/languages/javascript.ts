import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { execute } from '../../sandbox/index.js';
import type {
  AnalysisResult, EvaluableQuestion, ExecutionOutcome, LanguageAdapter, TestCaseSpec,
} from '../types.js';

/** ESTree node type -> canonical construct names (shared vocabulary with Python). */
const CANONICAL: Record<string, string[]> = {
  ForStatement: ['FOR_LOOP', 'LOOP'],
  ForOfStatement: ['FOR_LOOP', 'FOR_OF', 'LOOP'],
  ForInStatement: ['FOR_LOOP', 'FOR_IN', 'LOOP'],
  WhileStatement: ['WHILE_LOOP', 'LOOP'],
  DoWhileStatement: ['DO_WHILE_LOOP', 'LOOP'],
  IfStatement: ['IF'],
  ConditionalExpression: ['TERNARY', 'CONDITIONAL_EXPRESSION'],
  SwitchStatement: ['SWITCH'],
  ArrayExpression: ['LIST_LITERAL', 'ARRAY_LITERAL'],
  ObjectExpression: ['DICT_LITERAL', 'OBJECT_LITERAL'],
  FunctionDeclaration: ['FUNCTION_DEF'],
  FunctionExpression: ['FUNCTION_DEF', 'FUNCTION_EXPRESSION'],
  ArrowFunctionExpression: ['ARROW_FUNCTION', 'FUNCTION_DEF', 'LAMBDA'],
  ReturnStatement: ['RETURN'],
  ClassDeclaration: ['CLASS_DEF'],
  ClassExpression: ['CLASS_DEF'],
  TryStatement: ['TRY_EXCEPT', 'EXCEPTION_HANDLING'],
  ThrowStatement: ['RAISE', 'THROW', 'EXCEPTION_HANDLING'],
  VariableDeclaration: ['ASSIGNMENT', 'VARIABLE_DECLARATION'],
  AssignmentExpression: ['ASSIGNMENT'],
  TemplateLiteral: ['TEMPLATE_LITERAL', 'STRING_FORMATTING'],
  SpreadElement: ['UNPACKING', 'SPREAD'],
  RestElement: ['REST_PARAMETER', 'ARGS'],
  BreakStatement: ['BREAK'],
  ContinueStatement: ['CONTINUE'],
  AwaitExpression: ['AWAIT'],
  YieldExpression: ['YIELD'],
  BinaryExpression: ['ARITHMETIC'],
  LogicalExpression: ['BOOLEAN_OPERATOR'],
  MemberExpression: ['MEMBER_ACCESS'],
  NewExpression: ['NEW'],
};

function parseAny(source: string): { node: acorn.Node; kind: 'expression' | 'program' } {
  const options: acorn.Options = { ecmaVersion: 2023, sourceType: 'module', allowAwaitOutsideFunction: true };
  // Try as an expression first so `n => n * n` compares structurally.
  try {
    const wrapped = acorn.parse(`(${source})`, options) as any;
    const expr = wrapped.body[0]?.expression;
    if (expr) return { node: expr, kind: 'expression' };
  } catch { /* fall through */ }
  return { node: acorn.parse(source, options), kind: 'program' };
}

export function analyzeJavaScript(source: string): AnalysisResult {
  let parsed: { node: acorn.Node; kind: string };
  try {
    parsed = parseAny(source);
  } catch (err) {
    const e = err as Error & { loc?: { line: number; column: number } };
    return {
      ok: false,
      constructs: [],
      error: {
        type: 'SyntaxError',
        message: e.message.replace(/\s*\(\d+:\d+\)$/, ''),
        line: e.loc?.line ?? null,
        offset: e.loc?.column ?? null,
      },
    };
  }

  const constructs = new Set<string>();
  const calls: string[] = [];
  const methods: string[] = [];
  let loopDepth = 0;
  let maxLoopDepth = 0;

  const loopTypes = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement']);

  walk.full(parsed.node as any, (node: any) => {
    for (const name of CANONICAL[node.type] ?? []) constructs.add(name);
    if (node.type === 'IfStatement' && node.alternate) {
      constructs.add(node.alternate.type === 'IfStatement' ? 'ELIF' : 'IF_ELSE');
    }
    if (node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier') {
        calls.push(node.callee.name);
        constructs.add(`CALL:${node.callee.name}`);
      } else if (node.callee.type === 'MemberExpression' && node.callee.property?.name) {
        methods.push(node.callee.property.name);
        constructs.add(`METHOD:${node.callee.property.name}`);
        if (node.callee.object?.name === 'console' && node.callee.property.name === 'log') {
          constructs.add('PRINT');
        }
      }
    }
    if (node.type === 'VariableDeclaration') constructs.add(`DECL:${node.kind.toUpperCase()}`);
    if (node.type === 'FunctionDeclaration' && node.id?.name) constructs.add(`DEF:${node.id.name}`);
    if (node.type === 'ClassDeclaration' && node.id?.name) constructs.add(`CLASS:${node.id.name}`);
    if (node.type === 'ClassDeclaration' && node.superClass) constructs.add('INHERITANCE');
    if (node.type === 'MethodDefinition') {
      constructs.add('METHOD_DEF');
      if (node.kind === 'constructor') constructs.add('CONSTRUCTOR');
    }
    if (node.type === 'CatchClause') constructs.add('EXCEPT');
    if (node.type === 'TryStatement' && node.finalizer) constructs.add('FINALLY');
  });

  // Loop nesting depth: acorn-walk has no depth-aware generic hook, so recurse.
  const countNested = (node: any, depth: number) => {
    if (!node || typeof node.type !== 'string') return;
    const isLoop = loopTypes.has(node.type);
    const next = isLoop ? depth + 1 : depth;
    if (isLoop) {
      maxLoopDepth = Math.max(maxLoopDepth, next);
      if (next > 1) constructs.add('NESTED_LOOP');
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((c) => countNested(c, next));
      else if (child && typeof child === 'object' && typeof child.type === 'string') countNested(child, next);
    }
  };
  countNested(parsed.node, 0);
  loopDepth = maxLoopDepth;

  return {
    ok: true,
    constructs: [...constructs].sort(),
    dump: structuralDump(parsed.node),
    details: {
      parsedAs: parsed.kind,
      calls: [...new Set(calls)].sort(),
      methods: [...new Set(methods)].sort(),
      maxLoopDepth: loopDepth,
    },
  };
}

/** Formatting-insensitive structural fingerprint (mirrors Python's ast.dump). */
export function structuralDump(node: any): string {
  if (node === null || node === undefined) return 'null';
  if (Array.isArray(node)) return `[${node.map(structuralDump).join(',')}]`;
  if (typeof node !== 'object') return JSON.stringify(node);
  const keys = Object.keys(node)
    .filter((k) => !['start', 'end', 'loc', 'range', 'raw', 'comments'].includes(k))
    .sort();
  return `${node.type ?? ''}(${keys.map((k) => `${k}=${structuralDump(node[k])}`).join(',')})`;
}

export const javascriptAdapter: LanguageAdapter = {
  slug: 'javascript',
  runtime: 'node',
  monacoId: 'javascript',
  displayName: 'JavaScript',
  executable: true,

  async analyzeFragment(fragment: string): Promise<AnalysisResult> {
    return analyzeJavaScript(fragment);
  },

  async analyzeProgram(program: string): Promise<AnalysisResult> {
    return analyzeJavaScript(program);
  },

  async isEquivalent(fragment: string, candidates: string[]): Promise<boolean> {
    const mine = analyzeJavaScript(fragment);
    if (!mine.ok) return false;
    return candidates.some((c) => {
      const other = analyzeJavaScript(c);
      return other.ok && other.dump === mine.dump;
    });
  },

  async execute(program: string, test: TestCaseSpec, question: EvaluableQuestion): Promise<ExecutionOutcome> {
    const result = await execute({
      runtime: 'node',
      source: program,
      stdin: test.stdin ?? '',
      timeoutMs: question.timeLimitMs,
      memoryMb: question.memoryLimitMb,
    });
    return {
      status: result.status === 'memory_exceeded' ? 'runtime_error' : result.status,
      stdout: result.stdout,
      stderr: cleanNodeStderr(result.stderr),
      executionMs: result.durationMs,
      memoryKb: result.memoryKb,
      errorMessage: result.status === 'ok' ? null : firstErrorLine(result.stderr),
    };
  },
};

function cleanNodeStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !line.includes('node:internal') && !line.trimStart().startsWith('at '))
    .join('\n')
    .trim();
}

function firstErrorLine(stderr: string): string | null {
  const match = /^(?:.*\n)*?([A-Za-z]*Error(?::.*)?)$/m.exec(stderr);
  if (match) return match[1];
  const cleaned = cleanNodeStderr(stderr);
  return cleaned ? cleaned.split('\n')[0] : null;
}
