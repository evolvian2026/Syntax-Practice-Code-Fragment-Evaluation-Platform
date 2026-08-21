import type { EvaluableQuestion, SqlDataset } from '../src/evaluation/types.js';

/** Builds an EvaluableQuestion for engine tests without touching the database. */
export function question(overrides: Partial<EvaluableQuestion> = {}): EvaluableQuestion {
  return {
    id: 1,
    qid: 'TEST-0001',
    languageSlug: 'python',
    runtime: 'python',
    difficulty: 'Easy',
    questionType: 'FILL_CODE',
    evaluationType: 'OUTPUT',
    title: 'Test question',
    statement: 'Do the thing.',
    starterCode: 'numbers = [1, 2, 3]\n\n{{STUDENT_CODE}}',
    hiddenPrefix: null,
    hiddenSuffix: null,
    indentFragment: true,
    requiredConstructs: [],
    forbiddenConstructs: [],
    requiredKeywords: [],
    forbiddenKeywords: [],
    maxCodeLength: 2000,
    timeLimitMs: 4000,
    memoryLimitMb: 128,
    maxScore: 100,
    testCases: [{ visibility: 'public', matcher: 'trimmed', weight: 1, expectedOutput: '1\n2\n3' }],
    acceptedSolutions: [],
    config: {},
    dataset: null,
    explanation: null,
    ...overrides,
  };
}

export const COMPANY_DATASET: SqlDataset = {
  slug: 'test-company',
  name: 'Test company',
  dialect: 'mysql',
  schemaSql: `
    CREATE TABLE Departments (
      department_id INTEGER PRIMARY KEY,
      department_name TEXT NOT NULL
    );
    CREATE TABLE Employees (
      employee_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      salary INTEGER NOT NULL,
      department_id INTEGER
    );
  `,
  seedSql: `
    INSERT INTO Departments VALUES (1, 'Engineering'), (2, 'Sales'), (3, 'Empty');
    INSERT INTO Employees VALUES
      (1, 'Anita', 95000, 1),
      (2, 'Rahul', 72000, 1),
      (3, 'Neha', 48000, 2),
      (4, 'Solo', 51000, NULL);
  `,
};

/** SQL question fixture: the student writes only the JOIN clause. */
export function sqlJoinQuestion(overrides: Partial<EvaluableQuestion> = {}): EvaluableQuestion {
  return question({
    languageSlug: 'mysql',
    runtime: 'sql',
    evaluationType: 'SQL_RESULT',
    questionType: 'COMPLETE_SQL_CLAUSE',
    starterCode: 'SELECT e.name, d.department_name\nFROM Employees e\n{{STUDENT_CODE}};',
    dataset: COMPANY_DATASET,
    requiredConstructs: ['INNER_JOIN'],
    testCases: [{
      visibility: 'public',
      matcher: 'unordered_rows',
      weight: 1,
      expectedOutput: 'name | department_name\nAnita | Engineering\nRahul | Engineering\nNeha | Sales',
    }],
    ...overrides,
  });
}
