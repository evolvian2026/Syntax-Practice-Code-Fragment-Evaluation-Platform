import type { EvaluableQuestion, TestCaseSpec } from './types.js';

export const STUDENT_MARKER = '{{STUDENT_CODE}}';
/** Optional per-test injection point, e.g. different list values per test case. */
export const SETUP_MARKER = '{{SETUP_CODE}}';

export interface AssembledProgram {
  /** Full source handed to the sandbox. */
  program: string;
  /** Everything before the editable region (what the student sees above the box). */
  visiblePrefix: string;
  /** Everything after it. */
  visibleSuffix: string;
  /** Column the fragment starts at, used for re-indentation. */
  indent: string;
  /** 1-based line number where the student's fragment begins in `program`. */
  fragmentStartLine: number;
  fragmentLineCount: number;
}

export class TemplateError extends Error {}

/** Splits a template on the student marker, preserving the marker's indentation. */
export function splitTemplate(template: string): { prefix: string; suffix: string; indent: string } {
  const idx = template.indexOf(STUDENT_MARKER);
  if (idx === -1) {
    throw new TemplateError(
      `Question template must contain the ${STUDENT_MARKER} marker so the student's fragment can be inserted.`,
    );
  }
  const prefix = template.slice(0, idx);
  const suffix = template.slice(idx + STUDENT_MARKER.length);
  // Indentation = whitespace between the last newline and the marker.
  const lastLine = prefix.slice(prefix.lastIndexOf('\n') + 1);
  const indent = /^[ \t]*$/.test(lastLine) ? lastLine : '';
  return { prefix, suffix, indent };
}

/**
 * Re-indents a multi-line fragment so it lines up with the marker's column.
 *
 * The student writes at column 0 inside their editor; when the marker sits
 * inside an indented block (`if x:\n    {{STUDENT_CODE}}`) every line has to be
 * shifted by the same amount, and relative indentation inside the fragment must
 * be preserved.
 */
export function indentFragment(fragment: string, indent: string): string {
  if (!indent) return fragment;
  const lines = fragment.replace(/\r\n/g, '\n').split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return line;               // first line inherits the marker's own indent
      return line.trim().length === 0 ? '' : indent + line;
    })
    .join('\n');
}

export function stripTrailingNewlines(value: string): string {
  return value.replace(/[\r\n]+$/, '');
}

/**
 * Builds the executable program for a question + fragment (+ optional test setup).
 *
 * This is the heart of §2: the student submits a *fragment*, the platform owns
 * everything around it.
 */
export function assemble(
  question: Pick<EvaluableQuestion, 'starterCode' | 'hiddenPrefix' | 'hiddenSuffix' | 'indentFragment'>,
  fragment: string,
  test?: TestCaseSpec | null,
): AssembledProgram {
  let template = question.starterCode ?? '';

  // Per-test context override, e.g. a different `numbers = [...]` per test case.
  const setup = test?.setupCode ?? '';
  if (template.includes(SETUP_MARKER)) {
    template = template.split(SETUP_MARKER).join(setup);
  } else if (setup) {
    template = `${setup}\n${template}`;
  }

  const { prefix, suffix, indent } = splitTemplate(template);
  const normalizedFragment = (fragment ?? '').replace(/\r\n/g, '\n').replace(/\t/g, '    ');
  const placed = question.indentFragment === false
    ? normalizedFragment
    : indentFragment(normalizedFragment.replace(/^\n+/, ''), indent);

  const hiddenPrefix = question.hiddenPrefix ? `${question.hiddenPrefix}\n` : '';
  const hiddenSuffix = question.hiddenSuffix ? `\n${question.hiddenSuffix}` : '';

  const body = `${prefix}${placed}${suffix}`;
  const program = `${hiddenPrefix}${body}${hiddenSuffix}`;

  const beforeFragment = `${hiddenPrefix}${prefix}`;
  const fragmentStartLine = beforeFragment.split('\n').length;

  return {
    program,
    visiblePrefix: prefix,
    visibleSuffix: suffix,
    indent,
    fragmentStartLine,
    fragmentLineCount: placed.split('\n').length,
  };
}

/**
 * Maps a line number reported by the runtime back to the student's editor.
 * Returns null when the error came from platform-provided code.
 */
export function mapLineToFragment(
  assembled: AssembledProgram,
  programLine: number | null | undefined,
): { line: number; inFragment: boolean } | null {
  if (!programLine || programLine < 1) return null;
  const start = assembled.fragmentStartLine;
  const end = start + assembled.fragmentLineCount - 1;
  if (programLine < start || programLine > end) {
    return { line: programLine, inFragment: false };
  }
  return { line: programLine - start + 1, inFragment: true };
}
