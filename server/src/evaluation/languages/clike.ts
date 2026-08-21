import { execute } from '../../sandbox/index.js';
import type {
  AnalysisResult, EvaluableQuestion, ExecutionOutcome, LanguageAdapter, TestCaseSpec,
} from '../types.js';

/**
 * Java / C / C++ adapters (§8).
 *
 * These languages have no lightweight in-process parser, so construct detection
 * is token-based over a comment- and string-stripped copy of the fragment, and
 * *syntax* validity is proved by the real compiler in the sandbox. Correctness
 * therefore still rests on javac/gcc/g++, never on the regexes below.
 */

interface Rule { construct: string; test: RegExp }

const SHARED_RULES: Rule[] = [
  { construct: 'FOR_LOOP', test: /\bfor\s*\(/ },
  { construct: 'LOOP', test: /\b(for|while|do)\b/ },
  { construct: 'WHILE_LOOP', test: /\bwhile\s*\(/ },
  { construct: 'DO_WHILE_LOOP', test: /\bdo\s*\{/ },
  { construct: 'IF', test: /\bif\s*\(/ },
  { construct: 'IF_ELSE', test: /\belse\b/ },
  { construct: 'ELIF', test: /\belse\s+if\b/ },
  { construct: 'TERNARY', test: /\?[^:;]*:/ },
  { construct: 'SWITCH', test: /\bswitch\s*\(/ },
  { construct: 'BREAK', test: /\bbreak\b/ },
  { construct: 'CONTINUE', test: /\bcontinue\b/ },
  { construct: 'RETURN', test: /\breturn\b/ },
  { construct: 'ARRAY', test: /\[\s*\]|\[\s*\d+\s*\]/ },
  { construct: 'ASSIGNMENT', test: /[^=!<>+\-*/%&|^]=[^=]/ },
  { construct: 'COMPARISON', test: /[=!<>]=|[<>]/ },
  { construct: 'ARITHMETIC', test: /[+\-*/%]/ },
  { construct: 'OP_MOD', test: /%/ },
  { construct: 'BOOLEAN_OPERATOR', test: /&&|\|\|/ },
  { construct: 'INCREMENT', test: /\+\+|--/ },
  { construct: 'FUNCTION_CALL', test: /\b[A-Za-z_]\w*\s*\(/ },
  { construct: 'BLOCK', test: /\{/ },
];

const JAVA_RULES: Rule[] = [
  { construct: 'PRINT', test: /System\s*\.\s*out\s*\.\s*print/ },
  { construct: 'CLASS_DEF', test: /\bclass\s+\w+/ },
  { construct: 'INHERITANCE', test: /\bextends\b|\bimplements\b/ },
  { construct: 'FUNCTION_DEF', test: /\b(public|private|protected|static|final)[\w\s<>,\[\]]*\s+\w+\s*\([^)]*\)\s*\{/ },
  { construct: 'TRY_EXCEPT', test: /\btry\s*\{/ },
  { construct: 'EXCEPTION_HANDLING', test: /\b(try|catch|throw|throws|finally)\b/ },
  { construct: 'FINALLY', test: /\bfinally\b/ },
  { construct: 'RAISE', test: /\bthrow\b/ },
  { construct: 'ENHANCED_FOR', test: /\bfor\s*\([^;)]*:[^)]*\)/ },
  { construct: 'GENERIC', test: /<\s*[A-Z]\w*\s*(,\s*\w+\s*)*>/ },
  { construct: 'LIST_LITERAL', test: /\b(new\s+(ArrayList|LinkedList)|Arrays\s*\.\s*asList|List\s*\.\s*of)\b/ },
  { construct: 'DICT_LITERAL', test: /\b(new\s+HashMap|Map\s*\.\s*of)\b/ },
  { construct: 'LAMBDA', test: /->/ },
  { construct: 'VARIABLE_DECLARATION', test: /\b(int|long|double|float|char|boolean|String|var)\s+\w+/ },
  { construct: 'CONSTRUCTOR', test: /\bnew\s+[A-Z]\w*\s*\(/ },
];

const C_RULES: Rule[] = [
  { construct: 'PRINT', test: /\bprintf\s*\(/ },
  { construct: 'FUNCTION_DEF', test: /\b(int|void|char|float|double|long|short|unsigned)\s+\w+\s*\([^)]*\)\s*\{/ },
  { construct: 'POINTER', test: /\*\s*\w+|\w+\s*\*/ },
  { construct: 'STRUCT', test: /\bstruct\b/ },
  { construct: 'VARIABLE_DECLARATION', test: /\b(int|char|float|double|long|short|unsigned)\s+\w+/ },
  { construct: 'ARRAY_DECLARATION', test: /\b\w+\s+\w+\s*\[\s*\d*\s*\]/ },
  { construct: 'SCANF', test: /\bscanf\s*\(/ },
];

const CPP_RULES: Rule[] = [
  { construct: 'PRINT', test: /\b(std\s*::\s*)?cout\b/ },
  { construct: 'INPUT', test: /\b(std\s*::\s*)?cin\b/ },
  { construct: 'VECTOR', test: /\b(std\s*::\s*)?vector\s*</ },
  { construct: 'LIST_LITERAL', test: /\b(std\s*::\s*)?vector\s*<[^>]*>\s*\w+\s*(=\s*)?\{|\{[^{}]*\}/ },
  { construct: 'DICT_LITERAL', test: /\b(std\s*::\s*)?(map|unordered_map)\s*</ },
  { construct: 'SET_LITERAL', test: /\b(std\s*::\s*)?(set|unordered_set)\s*</ },
  { construct: 'STRING', test: /\b(std\s*::\s*)?string\b/ },
  { construct: 'CLASS_DEF', test: /\bclass\s+\w+/ },
  { construct: 'INHERITANCE', test: /\bclass\s+\w+\s*:\s*(public|private|protected)\b/ },
  { construct: 'FUNCTION_DEF', test: /\b\w+\s+\w+\s*\([^)]*\)\s*\{/ },
  { construct: 'TRY_EXCEPT', test: /\btry\s*\{/ },
  { construct: 'EXCEPTION_HANDLING', test: /\b(try|catch|throw)\b/ },
  { construct: 'RANGE_FOR', test: /\bfor\s*\([^;)]*:[^)]*\)/ },
  { construct: 'TEMPLATE', test: /\btemplate\s*</ },
  { construct: 'AUTO', test: /\bauto\b/ },
  { construct: 'VARIABLE_DECLARATION', test: /\b(int|char|float|double|long|short|bool|auto|string)\s+\w+/ },
];

/** Strips comments and string/char literals so keywords in text do not count. */
export function stripCLikeNoise(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function detect(code: string, rules: Rule[]): string[] {
  const cleaned = stripCLikeNoise(code);
  const found = new Set<string>();
  for (const { construct, test } of [...SHARED_RULES, ...rules]) {
    if (test.test(cleaned)) found.add(construct);
  }
  const forCount = (cleaned.match(/\bfor\s*\(/g) ?? []).length
    + (cleaned.match(/\bwhile\s*\(/g) ?? []).length;
  if (forCount > 1 && /\b(for|while)\s*\([^)]*\)[^;]*\{[^}]*\b(for|while)\s*\(/s.test(cleaned)) {
    found.add('NESTED_LOOP');
  }
  return [...found].sort();
}

function normalizeCLike(code: string): string {
  return stripCLikeNoise(code)
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}();,=<>+\-*/%!&|[\]])\s*/g, '$1')
    .replace(/;$/, '')
    .trim();
}

function makeAdapter(
  slug: string,
  runtime: 'java' | 'c' | 'cpp',
  monacoId: string,
  displayName: string,
  rules: Rule[],
): LanguageAdapter {
  return {
    slug,
    runtime,
    monacoId,
    displayName,
    executable: true,

    async analyzeFragment(fragment: string): Promise<AnalysisResult> {
      const balanced = checkBalanced(fragment);
      if (balanced) {
        return { ok: false, constructs: [], error: { type: 'SyntaxError', message: balanced } };
      }
      return { ok: true, constructs: detect(fragment, rules), dump: normalizeCLike(fragment) };
    },

    async analyzeProgram(program: string): Promise<AnalysisResult> {
      return { ok: true, constructs: detect(program, rules), dump: normalizeCLike(program) };
    },

    async isEquivalent(fragment: string, candidates: string[]): Promise<boolean> {
      const mine = normalizeCLike(fragment);
      return candidates.some((c) => normalizeCLike(c) === mine);
    },

    async execute(program: string, test: TestCaseSpec, question: EvaluableQuestion): Promise<ExecutionOutcome> {
      const result = await execute({
        runtime,
        source: program,
        stdin: test.stdin ?? '',
        timeoutMs: question.timeLimitMs,
        memoryMb: question.memoryLimitMb,
      });
      return {
        status: result.status === 'memory_exceeded' ? 'runtime_error' : result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        executionMs: result.durationMs,
        memoryKb: result.memoryKb,
        errorMessage: result.status === 'ok' ? null : summarizeCompilerError(result.stderr, runtime),
      };
    },
  };
}

/** Cheap pre-compile check so obvious typos get an instant answer. */
export function checkBalanced(code: string): string | null {
  const cleaned = stripCLikeNoise(code);
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const ch of cleaned) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch in pairs) {
      const open = stack.pop();
      if (open !== pairs[ch]) return `Unbalanced brackets: unexpected "${ch}".`;
    }
  }
  if (stack.length > 0) return `Unbalanced brackets: "${stack[stack.length - 1]}" is never closed.`;
  return null;
}

/** Turns compiler noise into the one line a learner needs. */
export function summarizeCompilerError(stderr: string, runtime: string): string | null {
  if (!stderr.trim()) return null;
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => /error/i.test(l)) ?? lines[0];
  if (runtime === 'java') {
    return first.replace(/^\S*\.java:(\d+):\s*error:\s*/i, 'Line $1: ');
  }
  return first.replace(/^\S*\.(c|cpp):(\d+):(\d+):\s*(fatal\s+)?error:\s*/i, 'Line $2: ');
}

export const javaAdapter = makeAdapter('java', 'java', 'java', 'Java', JAVA_RULES);
export const cAdapter = makeAdapter('c', 'c', 'c', 'C', C_RULES);
export const cppAdapter = makeAdapter('cpp', 'cpp', 'cpp', 'C++', CPP_RULES);
