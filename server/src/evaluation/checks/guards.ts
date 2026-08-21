import type { EvaluableQuestion, StageResult } from '../types.js';

/**
 * §14 — restrictions applied *before* anything is parsed or executed.
 * Everything here is configurable per question; the DANGEROUS_PATTERNS list is
 * a platform-wide floor that questions cannot switch off.
 */

interface Pattern {
  id: string;
  test: RegExp;
  message: string;
  languages?: string[];
}

const DANGEROUS_PATTERNS: Pattern[] = [
  // --- system / process ------------------------------------------------
  { id: 'py_os_system', test: /\bos\s*\.\s*(system|popen|fork|exec[vl]|spawn|kill|remove|unlink|rmdir|chmod|chown)\b/, message: 'Operating-system calls are not allowed.', languages: ['python'] },
  { id: 'py_subprocess', test: /\b(import\s+subprocess|from\s+subprocess\s+import|__import__\s*\(\s*['"]subprocess)/, message: 'The subprocess module is not allowed.', languages: ['python'] },
  { id: 'py_socket', test: /\b(import\s+socket|from\s+socket\s+import|import\s+urllib|import\s+requests|import\s+http)\b/, message: 'Network access is not allowed.', languages: ['python'] },
  { id: 'py_open', test: /(?<![.\w])open\s*\(/, message: 'File access is not allowed.', languages: ['python'] },
  { id: 'py_dunder', test: /__(import__|subclasses__|globals__|builtins__|loader__|class__\s*\.\s*__base)/, message: 'Introspection escapes are not allowed.', languages: ['python'] },
  { id: 'py_eval', test: /\b(eval|exec)\s*\(\s*(input|open|__)/, message: 'Dynamic execution of external input is not allowed.', languages: ['python'] },

  // --- javascript / node -------------------------------------------------
  { id: 'js_require', test: /\brequire\s*\(/, message: 'require() is not available in the practice sandbox.', languages: ['javascript'] },
  { id: 'js_import', test: /\bimport\s*\(|^\s*import\s+.+\s+from\s+/m, message: 'Module imports are not available in the practice sandbox.', languages: ['javascript'] },
  { id: 'js_process', test: /\bprocess\s*\.\s*(exit|binding|dlopen|kill)\b/, message: 'Process control is not allowed.', languages: ['javascript'] },
  { id: 'js_fetch', test: /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/, message: 'Network access is not allowed.', languages: ['javascript'] },

  // --- jvm / native ------------------------------------------------------
  { id: 'java_runtime', test: /\b(Runtime\s*\.\s*getRuntime|ProcessBuilder|System\s*\.\s*exit)\b/, message: 'Process control is not allowed.', languages: ['java'] },
  { id: 'java_io', test: /\b(java\s*\.\s*io\s*\.\s*File|FileWriter|FileOutputStream|java\s*\.\s*net\s*\.)/, message: 'File and network access are not allowed.', languages: ['java'] },
  { id: 'c_system', test: /\b(system|popen|fork|execv|remove|unlink|fopen|socket)\s*\(/, message: 'System, file and network calls are not allowed.', languages: ['c', 'cpp'] },

  // --- sql ---------------------------------------------------------------
  { id: 'sql_write', test: /\b(drop|delete|truncate|alter|create|insert|update|replace|grant|revoke|attach|detach|pragma|vacuum)\b/i, message: 'Only read-only queries are allowed here — the sandbox database cannot be modified.', languages: ['mysql', 'sql', 'postgresql'] },
  { id: 'sql_stack', test: /;\s*\S/, message: 'Only a single statement is allowed. Stacked queries are blocked.', languages: ['mysql', 'sql', 'postgresql'] },
  { id: 'sql_comment_escape', test: /(--|#|\/\*)[^\n]*\b(or|union)\b/i, message: 'Comment-based injection patterns are blocked.', languages: ['mysql', 'sql', 'postgresql'] },
  { id: 'sql_tautology', test: /\b(or|and)\s+(['"]?)(\w+)\2\s*=\s*(['"]?)\3\4/i, message: 'Tautology injection patterns (e.g. OR 1=1) are blocked.', languages: ['mysql', 'sql', 'postgresql'] },

  // --- markup ------------------------------------------------------------
  { id: 'html_script', test: /<\s*script\b|javascript\s*:|on(click|load|error|mouseover)\s*=/i, message: 'Scripting is not allowed in HTML answers.', languages: ['html'] },
  { id: 'css_import', test: /@import|url\s*\(\s*['"]?\s*(https?:)?\/\//i, message: 'Remote resources are not allowed in CSS answers.', languages: ['css'] },
];

export interface GuardOutcome {
  stage: StageResult;
  blocked: boolean;
  /** ids of the platform patterns that fired */
  triggered: string[];
}

function wordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `\b` does not work for symbols like `*` or `=>`, so only use it for words.
  return /^\w[\w\s]*\w$|^\w$/.test(keyword)
    ? new RegExp(`\\b${escaped}\\b`, 'i')
    : new RegExp(escaped, 'i');
}

export function runGuards(fragment: string, question: EvaluableQuestion): GuardOutcome {
  const problems: string[] = [];
  const triggered: string[] = [];
  const code = fragment ?? '';
  const lang = question.languageSlug;

  if (code.trim().length === 0) {
    return {
      blocked: true,
      triggered,
      stage: { stage: 'guard', passed: false, title: 'Nothing submitted', message: 'Write your code fragment in the editor before running it.' },
    };
  }

  if (code.length > question.maxCodeLength) {
    problems.push(`Your answer is ${code.length} characters — the limit for this question is ${question.maxCodeLength}.`);
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.languages && !pattern.languages.includes(lang)) continue;
    if (pattern.test.test(code)) {
      problems.push(pattern.message);
      triggered.push(pattern.id);
    }
  }

  for (const keyword of question.forbiddenKeywords ?? []) {
    if (wordRegex(keyword).test(code)) {
      problems.push(`This question does not allow \`${keyword}\`.`);
      triggered.push(`forbidden:${keyword}`);
    }
  }

  const missingRequired = (question.requiredKeywords ?? []).filter((k) => !wordRegex(k).test(code));
  if (missingRequired.length > 0) {
    problems.push(`Your answer must use: ${missingRequired.map((k) => `\`${k}\``).join(', ')}.`);
    triggered.push(...missingRequired.map((k) => `missing:${k}`));
  }

  if (problems.length === 0) {
    return {
      blocked: false,
      triggered,
      stage: { stage: 'guard', passed: true, title: 'Restrictions', message: 'No restricted constructs used.' },
    };
  }

  return {
    blocked: true,
    triggered,
    stage: {
      stage: 'guard',
      passed: false,
      title: 'Restricted code',
      message: problems.join(' '),
      details: { problems, triggered },
    },
  };
}

export const platformPatternIds = DANGEROUS_PATTERNS.map((p) => p.id);
