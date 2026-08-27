import Database from 'better-sqlite3';
import { resultSetToText, type ResultSet } from '../comparators.js';
import type {
  AnalysisResult, EvaluableQuestion, ExecutionOutcome, LanguageAdapter, SqlDataset, TestCaseSpec,
} from '../types.js';

/**
 * SQL adapter (MySQL-flavoured practice, SQLite execution engine).
 *
 * Every run gets a brand-new in-memory database seeded from the question's
 * dataset, switched to `query_only` before the student's query touches it.
 * Nothing a student writes can reach the application database, and DDL/DML
 * is rejected twice: by the guard patterns and by the engine itself.
 */

const CLAUSE_PATTERNS: Array<{ construct: string; test: RegExp }> = [
  { construct: 'SELECT', test: /\bselect\b/i },
  { construct: 'FROM', test: /\bfrom\b/i },
  { construct: 'WHERE', test: /\bwhere\b/i },
  { construct: 'GROUP_BY', test: /\bgroup\s+by\b/i },
  { construct: 'HAVING', test: /\bhaving\b/i },
  { construct: 'ORDER_BY', test: /\border\s+by\b/i },
  { construct: 'LIMIT', test: /\blimit\b/i },
  { construct: 'DISTINCT', test: /\bdistinct\b/i },
  { construct: 'JOIN', test: /\bjoin\b/i },
  { construct: 'INNER_JOIN', test: /\b(inner\s+join|(?<!left\s|right\s|full\s|cross\s|outer\s)\bjoin\b)/i },
  { construct: 'LEFT_JOIN', test: /\bleft\s+(outer\s+)?join\b/i },
  { construct: 'RIGHT_JOIN', test: /\bright\s+(outer\s+)?join\b/i },
  { construct: 'FULL_JOIN', test: /\bfull\s+(outer\s+)?join\b/i },
  { construct: 'CROSS_JOIN', test: /\bcross\s+join\b/i },
  { construct: 'ON_CLAUSE', test: /\bon\b/i },
  { construct: 'USING_CLAUSE', test: /\busing\s*\(/i },
  { construct: 'SUBQUERY', test: /\(\s*select\b/i },
  { construct: 'UNION', test: /\bunion\b/i },
  { construct: 'ALIAS', test: /\bas\b/i },
  { construct: 'AGGREGATE', test: /\b(count|sum|avg|min|max)\s*\(/i },
  { construct: 'COUNT', test: /\bcount\s*\(/i },
  { construct: 'SUM', test: /\bsum\s*\(/i },
  { construct: 'AVG', test: /\bavg\s*\(/i },
  { construct: 'MIN', test: /\bmin\s*\(/i },
  { construct: 'MAX', test: /\bmax\s*\(/i },
  { construct: 'LIKE', test: /\blike\b/i },
  { construct: 'IN_OPERATOR', test: /\bin\s*\(/i },
  { construct: 'BETWEEN', test: /\bbetween\b/i },
  { construct: 'IS_NULL', test: /\bis\s+(not\s+)?null\b/i },
  { construct: 'DESC', test: /\bdesc\b/i },
  { construct: 'ASC', test: /\basc\b/i },
  { construct: 'CASE', test: /\bcase\b/i },
  { construct: 'SELF_JOIN', test: /\bjoin\s+(\w+)\s+(\w+)\s+on\b[\s\S]*\b\1\b/i },
  // Part of the shared cross-language vocabulary, so questions can require a
  // comparison or a boolean operator in SQL exactly as they do in Python.
  // Safe against literals because string contents are stripped first.
  { construct: 'COMPARISON', test: /(?:<=|>=|<>|!=|<|>|=)/ },
  { construct: 'BOOLEAN_OPERATOR', test: /\b(?:and|or|not)\b/i },
];

const MAX_RESULT_ROWS = 5000;

const WRITE_STATEMENT = /^\s*(insert|update|delete|drop|create|alter|truncate|replace|grant|revoke|attach|detach|pragma|vacuum|begin|commit|rollback)\b/i;

/** Removes strings and comments so clause detection cannot be fooled by literals. */
export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`([^`]*)`/g, '$1');
}

export function detectSqlConstructs(sql: string): string[] {
  const cleaned = stripSqlNoise(sql);
  const found = new Set<string>();
  for (const { construct, test } of CLAUSE_PATTERNS) {
    if (test.test(cleaned)) found.add(construct);
  }
  // JOIN without a qualifier is an inner join.
  if (found.has('JOIN') && !found.has('LEFT_JOIN') && !found.has('RIGHT_JOIN')
      && !found.has('FULL_JOIN') && !found.has('CROSS_JOIN')) {
    found.add('INNER_JOIN');
  }
  const joinCount = (cleaned.match(/\bjoin\b/gi) ?? []).length;
  if (joinCount > 1) found.add('MULTIPLE_JOINS');
  if (joinCount > 0) found.add(`JOIN_COUNT:${joinCount}`);
  return [...found].sort();
}

/** MySQL-isms that SQLite does not accept, rewritten so practice queries run. */
export function translateForSqlite(sql: string): string {
  return sql
    .replace(/\bIFNULL\s*\(/gi, 'IFNULL(')
    .replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')")
    .replace(/\bCURDATE\s*\(\s*\)/gi, "date('now')")
    .replace(/\bCONCAT_WS\s*\(/gi, 'CONCAT_WS(')
    .replace(/\bYEAR\s*\(\s*([^)]+)\)/gi, "CAST(strftime('%Y', $1) AS INTEGER)")
    .replace(/\bMONTH\s*\(\s*([^)]+)\)/gi, "CAST(strftime('%m', $1) AS INTEGER)")
    .replace(/\bDAY\s*\(\s*([^)]+)\)/gi, "CAST(strftime('%d', $1) AS INTEGER)")
    .replace(/\bDATEDIFF\s*\(\s*([^,]+),\s*([^)]+)\)/gi, 'CAST(julianday($1) - julianday($2) AS INTEGER)')
    .replace(/\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi, 'LIMIT $2 OFFSET $1')
    .replace(/`/g, '"');
}

interface OpenedDb {
  db: Database.Database;
  close(): void;
}

/**
 * Builds a throwaway, read-only sandbox database for one execution.
 *
 * `extraSeed` is how hidden test cases vary the data: extra rows are inserted
 * after the base seed but *before* the database is locked, so a query that
 * hard-codes ids instead of expressing the real condition fails the hidden test.
 */
export function openSandboxDatabase(dataset: SqlDataset, extraSeed?: string | null): OpenedDb {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(translateForSqlite(dataset.schemaSql));
  if (dataset.seedSql.trim()) db.exec(translateForSqlite(dataset.seedSql));
  if (extraSeed && extraSeed.trim()) db.exec(translateForSqlite(extraSeed));
  // From here on the database refuses every write, whatever the student sends.
  db.pragma('query_only = true');
  return { db, close: () => db.close() };
}

export function runQuery(
  dataset: SqlDataset,
  sql: string,
  timeoutMs: number,
  extraSeed?: string | null,
): ExecutionOutcome {
  const started = Date.now();
  const trimmed = sql.trim().replace(/;+\s*$/, '');

  if (!trimmed) {
    return emptyOutcome('runtime_error', 'The generated query is empty.', started);
  }
  if (WRITE_STATEMENT.test(trimmed)) {
    return emptyOutcome('restricted', 'Only SELECT queries can be executed in the practice sandbox.', started);
  }
  if (/;/.test(stripSqlNoise(trimmed))) {
    return emptyOutcome('restricted', 'Only one statement may be executed. Stacked queries are blocked.', started);
  }

  let opened: OpenedDb | null = null;
  try {
    opened = openSandboxDatabase(dataset, extraSeed);
    const statement = opened.db.prepare(translateForSqlite(trimmed));
    if (!statement.reader) {
      return emptyOutcome('restricted', 'Only queries that return rows can be run here.', started);
    }
    statement.raw(true);
    const columns = statement.columns().map((c) => c.name);

    // Rows are pulled one at a time so a runaway cartesian product hits the
    // deadline or the row cap instead of exhausting memory.
    const deadline = started + Math.max(500, timeoutMs);
    const rows: unknown[][] = [];
    for (const row of statement.iterate() as Iterable<unknown[]>) {
      rows.push([...row]);
      if (rows.length > MAX_RESULT_ROWS) {
        return emptyOutcome(
          'runtime_error',
          `The query returned more than ${MAX_RESULT_ROWS} rows. Narrow it down with a join condition or a WHERE clause.`,
          started,
        );
      }
      if (Date.now() > deadline) {
        return emptyOutcome('timeout', 'The query took too long and was cancelled.', started);
      }
    }

    const resultSet: ResultSet = { columns, rows };
    return {
      status: 'ok',
      stdout: resultSetToText(resultSet),
      stderr: '',
      executionMs: Date.now() - started,
      memoryKb: 0,
      errorMessage: null,
      resultSet,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const readonlyViolation = /readonly database/i.test(message);
    return emptyOutcome(
      readonlyViolation ? 'restricted' : 'runtime_error',
      readonlyViolation
        ? 'The sandbox database is read-only. Only SELECT queries can be executed.'
        : cleanSqlError(message),
      started,
    );
  } finally {
    try { opened?.close(); } catch { /* already closed */ }
  }
}

function cleanSqlError(message: string): string {
  return message
    .replace(/^SQLITE_ERROR:\s*/i, '')
    .replace(/^incomplete input$/i, 'SQL syntax error: the statement is incomplete. Check for a missing expression, closing parenthesis or quote at the end.')
    .replace(/^near "(.+)": syntax error$/i, 'SQL syntax error near "$1".')
    .replace(/^no such table:\s*(\S+)$/i, 'No such table: $1. Check the table names in the schema panel.')
    .replace(/^no such column:\s*(\S+)$/i, 'No such column: $1. Check the column names in the schema panel.')
    .replace(/^ambiguous column name:\s*(\S+)$/i, 'Ambiguous column: $1. Qualify it with a table alias, e.g. e.$1.');
}

function emptyOutcome(status: ExecutionOutcome['status'], message: string, started: number): ExecutionOutcome {
  return {
    status,
    stdout: '',
    stderr: message,
    executionMs: Date.now() - started,
    memoryKb: 0,
    errorMessage: message,
    resultSet: null,
  };
}

export const sqlAdapter: LanguageAdapter = {
  slug: 'mysql',
  runtime: 'sql',
  monacoId: 'sql',
  displayName: 'SQL / MySQL',
  executable: true,
  // Test `setupCode` seeds extra rows rather than being spliced into the query.
  setupIsData: true,

  async analyzeFragment(fragment: string): Promise<AnalysisResult> {
    return { ok: true, constructs: detectSqlConstructs(fragment), dump: normalizeSql(fragment) };
  },

  async analyzeProgram(program: string): Promise<AnalysisResult> {
    return { ok: true, constructs: detectSqlConstructs(program), dump: normalizeSql(program) };
  },

  async isEquivalent(fragment: string, candidates: string[]): Promise<boolean> {
    const target = normalizeSql(fragment);
    return candidates.some((c) => normalizeSql(c) === target);
  },

  async execute(program: string, test: TestCaseSpec, question: EvaluableQuestion): Promise<ExecutionOutcome> {
    if (!question.dataset) {
      return emptyOutcome('internal_error', 'This SQL question has no sandbox dataset attached.', Date.now());
    }
    return runQuery(question.dataset, program, question.timeLimitMs, test.setupCode);
  },
};

/** Whitespace/case-insensitive fingerprint used for SQL syntax equivalence. */
export function normalizeSql(sql: string): string {
  return stripSqlNoise(sql)
    .replace(/;+\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>!*])\s*/g, '$1')
    .trim()
    .toUpperCase();
}
