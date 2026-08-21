import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluation/engine.js';
import {
  detectSqlConstructs, normalizeSql, openSandboxDatabase, runQuery,
} from '../src/evaluation/languages/sql.js';
import { COMPANY_DATASET, sqlJoinQuestion } from './helpers.js';

/** §4 + §32 — SQL fragment practice, sandbox isolation and injection attempts. */

describe('SQL clause detection', () => {
  it('detects join flavours', () => {
    expect(detectSqlConstructs('JOIN Departments d ON e.id = d.id')).toContain('INNER_JOIN');
    expect(detectSqlConstructs('LEFT JOIN Departments d ON e.id = d.id')).toContain('LEFT_JOIN');
    expect(detectSqlConstructs('RIGHT OUTER JOIN d ON 1=1')).toContain('RIGHT_JOIN');
    expect(detectSqlConstructs('FULL OUTER JOIN d ON 1=1')).toContain('FULL_JOIN');
    expect(detectSqlConstructs('CROSS JOIN d')).toContain('CROSS_JOIN');
  });

  it('counts multiple joins', () => {
    const constructs = detectSqlConstructs('JOIN a ON 1=1 JOIN b ON 2=2');
    expect(constructs).toContain('MULTIPLE_JOINS');
    expect(constructs).toContain('JOIN_COUNT:2');
  });

  it('is not fooled by keywords inside string literals', () => {
    expect(detectSqlConstructs("WHERE name = 'GROUP BY'")).not.toContain('GROUP_BY');
  });

  it('normalises whitespace and case for equivalence', () => {
    expect(normalizeSql('select  a ,  b from t'))
      .toBe(normalizeSql('SELECT a, b FROM t'));
  });
});

describe('SQL sandbox', () => {
  it('runs a SELECT and returns rows', () => {
    const outcome = runQuery(COMPANY_DATASET, 'SELECT name FROM Employees ORDER BY name', 4000);
    expect(outcome.status).toBe('ok');
    expect(outcome.resultSet?.rows.map((r) => r[0])).toEqual(['Anita', 'Neha', 'Rahul', 'Solo']);
  });

  it('refuses DDL and DML', () => {
    for (const sql of ['DROP TABLE Employees', 'DELETE FROM Employees', 'UPDATE Employees SET salary = 0', 'INSERT INTO Employees VALUES (9, "x", 1, 1)']) {
      const outcome = runQuery(COMPANY_DATASET, sql, 4000);
      expect(outcome.status, sql).toBe('restricted');
    }
  });

  it('refuses stacked statements', () => {
    const outcome = runQuery(COMPANY_DATASET, 'SELECT 1; DROP TABLE Employees;', 4000);
    expect(outcome.status).toBe('restricted');
    expect(outcome.errorMessage).toMatch(/one statement/i);
  });

  it('keeps the sandbox database read-only even at the driver level', () => {
    const opened = openSandboxDatabase(COMPANY_DATASET);
    try {
      expect(() => opened.db.prepare('DELETE FROM Employees').run()).toThrow(/readonly/i);
    } finally {
      opened.close();
    }
  });

  it('gives a helpful message for an unknown column', () => {
    const outcome = runQuery(COMPANY_DATASET, 'SELECT nope FROM Employees', 4000);
    expect(outcome.status).toBe('runtime_error');
    expect(outcome.errorMessage).toMatch(/No such column/i);
  });

  it('seeds extra rows for hidden tests without touching the base dataset', () => {
    const extra = "INSERT INTO Employees VALUES (99, 'Temp', 1000, 1);";
    const withExtra = runQuery(COMPANY_DATASET, 'SELECT COUNT(*) FROM Employees', 4000, extra);
    const without = runQuery(COMPANY_DATASET, 'SELECT COUNT(*) FROM Employees', 4000);
    expect(withExtra.resultSet?.rows[0][0]).toBe(5);
    expect(without.resultSet?.rows[0][0]).toBe(4);
  });
});

describe('SQL fragment grading', () => {
  it('accepts a correct INNER JOIN fragment', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'JOIN Departments d ON e.department_id = d.department_id',
      mode: 'submit',
    });
    expect(result.verdict).toBe('CORRECT');
    expect(result.resultSet?.columns).toEqual(['name', 'department_name']);
  });

  it('accepts the INNER JOIN keyword spelling', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'INNER JOIN Departments d ON e.department_id = d.department_id',
      mode: 'submit',
    });
    expect(result.verdict).toBe('CORRECT');
  });

  it('rejects a LEFT JOIN when an INNER JOIN is required', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion({ forbiddenConstructs: ['LEFT_JOIN'] }),
      fragment: 'LEFT JOIN Departments d ON e.department_id = d.department_id',
      mode: 'submit',
    });
    expect(result.verdict).toBe('WRONG_CONSTRUCT');
  });

  it('reports a SQL syntax error in plain language', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'JOIN Departments d ON e.department_id =',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RUNTIME_ERROR');
    expect(result.errorMessage).toMatch(/syntax error/i);
  });

  it('blocks a stacked-query injection attempt', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'JOIN Departments d ON 1=1; DROP TABLE Employees;--',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
    expect(result.score).toBe(0);
  });

  it('blocks a tautology injection attempt', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: "JOIN Departments d ON e.department_id = d.department_id OR '1'='1'",
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
  });

  it('blocks a comment-based injection attempt', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'JOIN Departments d ON e.department_id = d.department_id -- OR 1=1',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
  });

  it('leaves the dataset intact after an injection attempt', async () => {
    await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'JOIN Departments d ON 1=1; DROP TABLE Employees;--',
      mode: 'submit',
    });
    const outcome = runQuery(COMPANY_DATASET, 'SELECT COUNT(*) FROM Employees', 4000);
    expect(outcome.status).toBe('ok');
    expect(outcome.resultSet?.rows[0][0]).toBe(4);
  });

  it('compares result sets regardless of row order by default', async () => {
    const result = await evaluate({
      question: sqlJoinQuestion(),
      fragment: 'JOIN Departments d ON e.department_id = d.department_id ORDER BY e.name DESC',
      mode: 'submit',
    });
    expect(result.verdict).toBe('CORRECT');
  });

  it('grades a LEFT JOIN question that must keep unmatched rows', async () => {
    const q = sqlJoinQuestion({
      requiredConstructs: ['LEFT_JOIN'],
      testCases: [{
        visibility: 'public',
        matcher: 'unordered_rows',
        weight: 1,
        expectedOutput: 'name | department_name\nAnita | Engineering\nRahul | Engineering\nNeha | Sales\nSolo | NULL',
      }],
    });
    const left = await evaluate({
      question: q,
      fragment: 'LEFT JOIN Departments d ON e.department_id = d.department_id',
      mode: 'submit',
    });
    const inner = await evaluate({
      question: q,
      fragment: 'JOIN Departments d ON e.department_id = d.department_id',
      mode: 'submit',
    });
    expect(left.verdict).toBe('CORRECT');
    expect(inner.verdict).toBe('WRONG_CONSTRUCT');
  });
});
