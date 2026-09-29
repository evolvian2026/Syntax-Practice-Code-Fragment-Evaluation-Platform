import type { TestCaseSpec } from './types.js';

/** Output comparison helpers - tolerant about formatting, strict about content. */

export function normalizeOutput(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

/** Collapses runs of whitespace - used by the `normalized` matcher. */
export function collapseWhitespace(value: string): string {
  return normalizeOutput(value)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join('\n');
}

export interface ComparisonResult {
  passed: boolean;
  message?: string;
  expected: string;
  actual: string;
}

export function compareOutput(actualRaw: string, test: TestCaseSpec): ComparisonResult {
  const expectedRaw = test.expectedOutput ?? '';
  const matcher = test.matcher ?? 'trimmed';

  const actual = normalizeOutput(actualRaw);
  const expected = normalizeOutput(expectedRaw);

  let passed: boolean;
  let message: string | undefined;

  switch (matcher) {
    case 'exact':
      passed = actualRaw === expectedRaw;
      if (!passed && actual === expected) {
        message = 'Only trailing whitespace differs, but this test requires an exact match.';
      }
      break;
    case 'contains':
      passed = actual.includes(expected);
      if (!passed) message = 'The expected text was not found in your output.';
      break;
    case 'regex':
      try {
        passed = new RegExp(expectedRaw, 'm').test(actualRaw);
      } catch {
        passed = false;
        message = 'The expected-output pattern for this test is invalid.';
      }
      break;
    case 'normalized':
      passed = collapseWhitespace(actualRaw) === collapseWhitespace(expectedRaw);
      break;
    case 'unordered_rows': {
      const a = collapseWhitespace(actualRaw).split('\n').sort();
      const b = collapseWhitespace(expectedRaw).split('\n').sort();
      passed = a.length === b.length && a.every((line, i) => line === b[i]);
      break;
    }
    case 'trimmed':
    default:
      passed = actual.trim() === expected.trim();
      break;
  }

  if (!passed && !message) message = describeDifference(expected, actual);
  return { passed, message, expected: expectedRaw, actual: actualRaw };
}

/** Human-readable "first line that differs" hint. */
export function describeDifference(expected: string, actual: string): string {
  if (actual.trim().length === 0) return 'Your code produced no output.';
  const e = expected.split('\n');
  const a = actual.split('\n');
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i += 1) {
    if (e[i] !== a[i]) {
      if (e[i] === undefined) return `Line ${i + 1}: unexpected extra output \`${truncate(a[i])}\`.`;
      if (a[i] === undefined) return `Line ${i + 1}: expected \`${truncate(e[i])}\` but your output ended.`;
      return `Line ${i + 1}: expected \`${truncate(e[i])}\` but got \`${truncate(a[i])}\`.`;
    }
  }
  return 'Output did not match.';
}

function truncate(value: string, max = 60): string {
  if (value === undefined || value === null) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

// -------------------------------------------------------- SQL result sets

export interface ResultSet {
  columns: string[];
  rows: unknown[][];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    // 1 and 1.0 are the same answer.
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  return String(value).trim();
}


export function resultSetToText(rs: ResultSet): string {
  const header = rs.columns.join(' | ');
  const body = rs.rows.map((r) => r.map(cellToString).join(' | ')).join('\n');
  return body ? `${header}\n${body}` : header;
}

/** Loose text comparison for free-text answers (predict-output). */
export function compareText(actual: string, accepted: string[], caseSensitive = false): boolean {
  const norm = (v: string) => {
    const t = collapseWhitespace(v);
    return caseSensitive ? t : t.toLowerCase();
  };
  const a = norm(actual);
  return accepted.some((candidate) => norm(candidate) === a);
}
