import { db, parseJson, toJson } from '../index.js';
import type {
  EvaluableQuestion, QuestionConfig, SqlDataset, TestCaseSpec,
} from '../../evaluation/types.js';

/** Row shapes as stored. */
export interface QuestionRow {
  id: number;
  qid: string;
  language_id: number;
  topic_id: number;
  subtopic_id: number | null;
  difficulty: string;
  question_type: string;
  evaluation_type: string;
  title: string;
  statement: string;
  instructions: string | null;
  learning_objective: string | null;
  starter_code: string;
  hidden_prefix: string | null;
  hidden_suffix: string | null;
  editable_prefill: string | null;
  editable_placeholder: string | null;
  indent_fragment: number;
  dataset_id: number | null;
  required_constructs: string;
  forbidden_constructs: string;
  required_keywords: string;
  forbidden_keywords: string;
  options: string;
  config: string;
  max_code_length: number;
  time_limit_ms: number;
  memory_limit_mb: number;
  max_score: number;
  explanation: string | null;
  status: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface HintRow { id: number; question_id: number; display_order: number; body: string; penalty: number }
export interface SolutionRow { id: number; question_id: number; code: string; is_primary: number; note: string | null }
export interface TestCaseRow {
  id: number; question_id: number; visibility: 'public' | 'hidden'; name: string | null;
  setup_code: string | null; stdin: string | null; expected_output: string | null;
  expected_value: string | null; matcher: TestCaseSpec['matcher']; weight: number; display_order: number;
}

/** A question plus everything hanging off it. */
export interface FullQuestion {
  question: QuestionRow;
  languageSlug: string;
  languageName: string;
  runtime: string;
  monacoId: string;
  topicSlug: string;
  topicName: string;
  subtopicSlug: string | null;
  subtopicName: string | null;
  testCases: TestCaseRow[];
  hints: HintRow[];
  solutions: SolutionRow[];
  tags: string[];
  dataset: SqlDataset | null;
}

const QUESTION_JOIN = `
  SELECT q.*, l.slug AS language_slug, l.name AS language_name, l.runtime AS runtime,
         l.monaco_id AS monaco_id, t.slug AS topic_slug, t.name AS topic_name,
         s.slug AS subtopic_slug, s.name AS subtopic_name
  FROM questions q
  JOIN languages l ON l.id = q.language_id
  JOIN topics t ON t.id = q.topic_id
  LEFT JOIN subtopics s ON s.id = q.subtopic_id
`;

export function findQuestionById(id: number): FullQuestion | null {
  const row = db().prepare(`${QUESTION_JOIN} WHERE q.id = ?`).get(id) as any;
  return row ? hydrate(row) : null;
}

export function findQuestionByQid(qid: string): FullQuestion | null {
  const row = db().prepare(`${QUESTION_JOIN} WHERE q.qid = ?`).get(qid) as any;
  return row ? hydrate(row) : null;
}

function hydrate(row: any): FullQuestion {
  const conn = db();
  const testCases = conn
    .prepare('SELECT * FROM question_test_cases WHERE question_id = ? ORDER BY display_order, id')
    .all(row.id) as TestCaseRow[];
  const hints = conn
    .prepare('SELECT * FROM question_hints WHERE question_id = ? ORDER BY display_order, id')
    .all(row.id) as HintRow[];
  const solutions = conn
    .prepare('SELECT * FROM question_solutions WHERE question_id = ? ORDER BY is_primary DESC, id')
    .all(row.id) as SolutionRow[];
  const tags = (conn.prepare('SELECT tag FROM question_tags WHERE question_id = ?').all(row.id) as { tag: string }[])
    .map((t) => t.tag);

  let dataset: SqlDataset | null = null;
  if (row.dataset_id) {
    const d = conn.prepare('SELECT * FROM sql_datasets WHERE id = ?').get(row.dataset_id) as any;
    if (d) {
      dataset = {
        id: d.id, slug: d.slug, name: d.name, dialect: d.dialect,
        schemaSql: d.schema_sql, seedSql: d.seed_sql,
        preview: parseJson(d.preview, null),
      };
    }
  }

  return {
    question: row as QuestionRow,
    languageSlug: row.language_slug,
    languageName: row.language_name,
    runtime: row.runtime,
    monacoId: row.monaco_id,
    topicSlug: row.topic_slug,
    topicName: row.topic_name,
    subtopicSlug: row.subtopic_slug ?? null,
    subtopicName: row.subtopic_name ?? null,
    testCases, hints, solutions, tags, dataset,
  };
}

/** Maps a stored question into the engine's input shape. */
export function toEvaluable(full: FullQuestion): EvaluableQuestion {
  const q = full.question;
  return {
    id: q.id,
    qid: q.qid,
    languageSlug: full.languageSlug,
    runtime: full.runtime,
    difficulty: q.difficulty as EvaluableQuestion['difficulty'],
    questionType: q.question_type as EvaluableQuestion['questionType'],
    evaluationType: q.evaluation_type as EvaluableQuestion['evaluationType'],
    title: q.title,
    statement: q.statement,
    starterCode: q.starter_code,
    hiddenPrefix: q.hidden_prefix,
    hiddenSuffix: q.hidden_suffix,
    indentFragment: q.indent_fragment === 1,
    requiredConstructs: parseJson<string[]>(q.required_constructs, []),
    forbiddenConstructs: parseJson<string[]>(q.forbidden_constructs, []),
    requiredKeywords: parseJson<string[]>(q.required_keywords, []),
    forbiddenKeywords: parseJson<string[]>(q.forbidden_keywords, []),
    maxCodeLength: q.max_code_length,
    timeLimitMs: q.time_limit_ms,
    memoryLimitMb: q.memory_limit_mb,
    maxScore: q.max_score,
    testCases: full.testCases.map(toTestSpec),
    acceptedSolutions: full.solutions.map((s) => s.code),
    config: parseJson<QuestionConfig>(q.config, {}),
    dataset: full.dataset,
    explanation: q.explanation,
  };
}

export function toTestSpec(row: TestCaseRow): TestCaseSpec {
  return {
    id: row.id,
    visibility: row.visibility,
    name: row.name,
    setupCode: row.setup_code,
    stdin: row.stdin,
    expectedOutput: row.expected_output,
    expectedValue: row.expected_value,
    matcher: row.matcher,
    weight: row.weight,
    displayOrder: row.display_order,
  };
}

// ------------------------------------------------------------- listing

export interface QuestionFilter {
  language?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: string;
  questionType?: string;
  evaluationType?: string;
  status?: string;
  tag?: string;
  search?: string;
  collection?: number;
  limit?: number;
  offset?: number;
  sort?: 'newest' | 'oldest' | 'difficulty' | 'qid';
}

export interface QuestionListItem {
  id: number;
  qid: string;
  title: string;
  statement: string;
  difficulty: string;
  questionType: string;
  evaluationType: string;
  status: string;
  language: string;
  languageName: string;
  topic: string;
  topicName: string;
  subtopic: string | null;
  subtopicName: string | null;
  tags: string[];
  updatedAt: string;
}

export function listQuestions(filter: QuestionFilter): { items: QuestionListItem[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.language) { where.push('l.slug = @language'); params.language = filter.language; }
  if (filter.topic) { where.push('t.slug = @topic'); params.topic = filter.topic; }
  if (filter.subtopic) { where.push('s.slug = @subtopic'); params.subtopic = filter.subtopic; }
  if (filter.difficulty) { where.push('q.difficulty = @difficulty'); params.difficulty = filter.difficulty; }
  if (filter.questionType) { where.push('q.question_type = @questionType'); params.questionType = filter.questionType; }
  if (filter.evaluationType) { where.push('q.evaluation_type = @evaluationType'); params.evaluationType = filter.evaluationType; }
  if (filter.status) { where.push('q.status = @status'); params.status = filter.status; }
  if (filter.search) {
    where.push('(q.title LIKE @search OR q.statement LIKE @search OR q.qid LIKE @search)');
    params.search = `%${filter.search}%`;
  }
  if (filter.tag) {
    where.push('EXISTS (SELECT 1 FROM question_tags qt WHERE qt.question_id = q.id AND qt.tag = @tag)');
    params.tag = filter.tag;
  }
  if (filter.collection) {
    where.push('EXISTS (SELECT 1 FROM collection_questions cq WHERE cq.question_id = q.id AND cq.collection_id = @collection)');
    params.collection = filter.collection;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = {
    newest: 'q.created_at DESC, q.id DESC',
    oldest: 'q.created_at ASC, q.id ASC',
    difficulty: `CASE q.difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, q.qid`,
    qid: 'q.qid',
  }[filter.sort ?? 'qid'];

  const limit = Math.min(filter.limit ?? 50, 500);
  const offset = filter.offset ?? 0;

  const rows = db().prepare(`
    SELECT q.id, q.qid, q.title, q.statement, q.difficulty, q.question_type, q.evaluation_type,
           q.status, q.updated_at, l.slug AS language, l.name AS language_name,
           t.slug AS topic, t.name AS topic_name, s.slug AS subtopic, s.name AS subtopic_name
    FROM questions q
    JOIN languages l ON l.id = q.language_id
    JOIN topics t ON t.id = q.topic_id
    LEFT JOIN subtopics s ON s.id = q.subtopic_id
    ${clause}
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}
  `).all(params) as any[];

  const total = (db().prepare(`
    SELECT COUNT(*) AS n FROM questions q
    JOIN languages l ON l.id = q.language_id
    JOIN topics t ON t.id = q.topic_id
    LEFT JOIN subtopics s ON s.id = q.subtopic_id
    ${clause}
  `).get(params) as { n: number }).n;

  const tagStmt = db().prepare('SELECT tag FROM question_tags WHERE question_id = ?');
  const items = rows.map((r) => ({
    id: r.id,
    qid: r.qid,
    title: r.title,
    statement: r.statement,
    difficulty: r.difficulty,
    questionType: r.question_type,
    evaluationType: r.evaluation_type,
    status: r.status,
    language: r.language,
    languageName: r.language_name,
    topic: r.topic,
    topicName: r.topic_name,
    subtopic: r.subtopic ?? null,
    subtopicName: r.subtopic_name ?? null,
    tags: (tagStmt.all(r.id) as { tag: string }[]).map((t) => t.tag),
    updatedAt: r.updated_at,
  }));

  return { items, total };
}

// -------------------------------------------------------- create/update

export interface QuestionInput {
  qid?: string;
  language: string;
  topic: string;
  subtopic?: string | null;
  difficulty: string;
  questionType: string;
  evaluationType: string;
  title: string;
  statement: string;
  instructions?: string | null;
  learningObjective?: string | null;
  starterCode: string;
  hiddenPrefix?: string | null;
  hiddenSuffix?: string | null;
  editablePrefill?: string | null;
  editablePlaceholder?: string | null;
  indentFragment?: boolean;
  dataset?: string | null;
  requiredConstructs?: string[];
  forbiddenConstructs?: string[];
  requiredKeywords?: string[];
  forbiddenKeywords?: string[];
  options?: string[];
  config?: QuestionConfig;
  maxCodeLength?: number;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  maxScore?: number;
  explanation?: string | null;
  status?: string;
  tags?: string[];
  testCases?: Array<{
    visibility: 'public' | 'hidden';
    name?: string | null;
    setupCode?: string | null;
    stdin?: string | null;
    expectedOutput?: string | null;
    expectedValue?: string | null;
    matcher?: TestCaseSpec['matcher'];
    weight?: number;
  }>;
  hints?: Array<{ body: string; penalty?: number }>;
  solutions?: Array<{ code: string; isPrimary?: boolean; note?: string | null }>;
}

export class CatalogReferenceError extends Error {}

function resolveIds(input: QuestionInput): { languageId: number; topicId: number; subtopicId: number | null; datasetId: number | null } {
  const conn = db();
  const language = conn.prepare('SELECT id FROM languages WHERE slug = ?').get(input.language) as { id: number } | undefined;
  if (!language) throw new CatalogReferenceError(`Unknown language "${input.language}".`);

  const topic = conn.prepare('SELECT id FROM topics WHERE language_id = ? AND slug = ?')
    .get(language.id, input.topic) as { id: number } | undefined;
  if (!topic) throw new CatalogReferenceError(`Unknown topic "${input.topic}" for language "${input.language}".`);

  let subtopicId: number | null = null;
  if (input.subtopic) {
    const sub = conn.prepare('SELECT id FROM subtopics WHERE topic_id = ? AND slug = ?')
      .get(topic.id, input.subtopic) as { id: number } | undefined;
    if (!sub) throw new CatalogReferenceError(`Unknown subtopic "${input.subtopic}" for topic "${input.topic}".`);
    subtopicId = sub.id;
  }

  let datasetId: number | null = null;
  if (input.dataset) {
    const ds = conn.prepare('SELECT id FROM sql_datasets WHERE slug = ?').get(input.dataset) as { id: number } | undefined;
    if (!ds) throw new CatalogReferenceError(`Unknown SQL dataset "${input.dataset}".`);
    datasetId = ds.id;
  }

  return { languageId: language.id, topicId: topic.id, subtopicId, datasetId };
}

/** Generates the next stable QID, e.g. PY-LOOPS-0007. */
export function nextQid(languageSlug: string, topicSlug: string): string {
  const langPart = languageSlug.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const topicPart = topicSlug.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = `${langPart}-${topicPart}-`;
  const last = db()
    .prepare('SELECT qid FROM questions WHERE qid LIKE ? ORDER BY qid DESC LIMIT 1')
    .get(`${prefix}%`) as { qid: string } | undefined;
  const nextNumber = last ? Number(last.qid.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(nextNumber).padStart(4, '0')}`;
}

export function createQuestion(input: QuestionInput, createdBy: number | null): FullQuestion {
  const conn = db();
  const ids = resolveIds(input);
  const qid = input.qid?.trim() || nextQid(input.language, input.topic);

  const insert = conn.prepare(`
    INSERT INTO questions (
      qid, language_id, topic_id, subtopic_id, difficulty, question_type, evaluation_type,
      title, statement, instructions, learning_objective, starter_code, hidden_prefix, hidden_suffix,
      editable_prefill, editable_placeholder, indent_fragment, dataset_id,
      required_constructs, forbidden_constructs, required_keywords, forbidden_keywords,
      options, config, max_code_length, time_limit_ms, memory_limit_mb, max_score,
      explanation, status, created_by
    ) VALUES (
      @qid, @languageId, @topicId, @subtopicId, @difficulty, @questionType, @evaluationType,
      @title, @statement, @instructions, @learningObjective, @starterCode, @hiddenPrefix, @hiddenSuffix,
      @editablePrefill, @editablePlaceholder, @indentFragment, @datasetId,
      @requiredConstructs, @forbiddenConstructs, @requiredKeywords, @forbiddenKeywords,
      @options, @config, @maxCodeLength, @timeLimitMs, @memoryLimitMb, @maxScore,
      @explanation, @status, @createdBy
    )
  `);

  const txn = conn.transaction(() => {
    const info = insert.run({
      qid,
      languageId: ids.languageId,
      topicId: ids.topicId,
      subtopicId: ids.subtopicId,
      difficulty: input.difficulty,
      questionType: input.questionType,
      evaluationType: input.evaluationType,
      title: input.title,
      statement: input.statement,
      instructions: input.instructions ?? null,
      learningObjective: input.learningObjective ?? null,
      starterCode: input.starterCode,
      hiddenPrefix: input.hiddenPrefix ?? null,
      hiddenSuffix: input.hiddenSuffix ?? null,
      editablePrefill: input.editablePrefill ?? null,
      editablePlaceholder: input.editablePlaceholder ?? null,
      indentFragment: input.indentFragment === false ? 0 : 1,
      datasetId: ids.datasetId,
      requiredConstructs: toJson(input.requiredConstructs ?? []),
      forbiddenConstructs: toJson(input.forbiddenConstructs ?? []),
      requiredKeywords: toJson(input.requiredKeywords ?? []),
      forbiddenKeywords: toJson(input.forbiddenKeywords ?? []),
      options: toJson(input.options ?? []),
      config: toJson(input.config ?? {}),
      maxCodeLength: input.maxCodeLength ?? 2000,
      timeLimitMs: input.timeLimitMs ?? 4000,
      memoryLimitMb: input.memoryLimitMb ?? 128,
      maxScore: input.maxScore ?? 100,
      explanation: input.explanation ?? null,
      status: input.status ?? 'published',
      createdBy,
    });
    const questionId = Number(info.lastInsertRowid);
    writeChildren(questionId, input);
    return questionId;
  });

  const id = txn();
  return findQuestionById(id)!;
}

export function updateQuestion(id: number, input: QuestionInput): FullQuestion | null {
  const conn = db();
  const existing = conn.prepare('SELECT id FROM questions WHERE id = ?').get(id);
  if (!existing) return null;
  const ids = resolveIds(input);

  const txn = conn.transaction(() => {
    conn.prepare(`
      UPDATE questions SET
        qid = COALESCE(@qid, qid),
        language_id = @languageId, topic_id = @topicId, subtopic_id = @subtopicId,
        difficulty = @difficulty, question_type = @questionType, evaluation_type = @evaluationType,
        title = @title, statement = @statement, instructions = @instructions,
        learning_objective = @learningObjective, starter_code = @starterCode,
        hidden_prefix = @hiddenPrefix, hidden_suffix = @hiddenSuffix,
        editable_prefill = @editablePrefill, editable_placeholder = @editablePlaceholder,
        indent_fragment = @indentFragment, dataset_id = @datasetId,
        required_constructs = @requiredConstructs, forbidden_constructs = @forbiddenConstructs,
        required_keywords = @requiredKeywords, forbidden_keywords = @forbiddenKeywords,
        options = @options, config = @config, max_code_length = @maxCodeLength,
        time_limit_ms = @timeLimitMs, memory_limit_mb = @memoryLimitMb, max_score = @maxScore,
        explanation = @explanation, status = @status, updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      qid: input.qid ?? null,
      languageId: ids.languageId,
      topicId: ids.topicId,
      subtopicId: ids.subtopicId,
      difficulty: input.difficulty,
      questionType: input.questionType,
      evaluationType: input.evaluationType,
      title: input.title,
      statement: input.statement,
      instructions: input.instructions ?? null,
      learningObjective: input.learningObjective ?? null,
      starterCode: input.starterCode,
      hiddenPrefix: input.hiddenPrefix ?? null,
      hiddenSuffix: input.hiddenSuffix ?? null,
      editablePrefill: input.editablePrefill ?? null,
      editablePlaceholder: input.editablePlaceholder ?? null,
      indentFragment: input.indentFragment === false ? 0 : 1,
      datasetId: ids.datasetId,
      requiredConstructs: toJson(input.requiredConstructs ?? []),
      forbiddenConstructs: toJson(input.forbiddenConstructs ?? []),
      requiredKeywords: toJson(input.requiredKeywords ?? []),
      forbiddenKeywords: toJson(input.forbiddenKeywords ?? []),
      options: toJson(input.options ?? []),
      config: toJson(input.config ?? {}),
      maxCodeLength: input.maxCodeLength ?? 2000,
      timeLimitMs: input.timeLimitMs ?? 4000,
      memoryLimitMb: input.memoryLimitMb ?? 128,
      maxScore: input.maxScore ?? 100,
      explanation: input.explanation ?? null,
      status: input.status ?? 'published',
    });

    conn.prepare('DELETE FROM question_test_cases WHERE question_id = ?').run(id);
    conn.prepare('DELETE FROM question_hints WHERE question_id = ?').run(id);
    conn.prepare('DELETE FROM question_solutions WHERE question_id = ?').run(id);
    conn.prepare('DELETE FROM question_tags WHERE question_id = ?').run(id);
    writeChildren(id, input);
  });

  txn();
  return findQuestionById(id);
}

function writeChildren(questionId: number, input: QuestionInput): void {
  const conn = db();
  const testStmt = conn.prepare(`
    INSERT INTO question_test_cases
      (question_id, visibility, name, setup_code, stdin, expected_output, expected_value, matcher, weight, display_order)
    VALUES (@questionId, @visibility, @name, @setupCode, @stdin, @expectedOutput, @expectedValue, @matcher, @weight, @displayOrder)
  `);
  (input.testCases ?? []).forEach((t, i) => {
    testStmt.run({
      questionId,
      visibility: t.visibility ?? 'public',
      name: t.name ?? null,
      setupCode: t.setupCode ?? null,
      stdin: t.stdin ?? null,
      expectedOutput: t.expectedOutput ?? null,
      expectedValue: t.expectedValue ?? null,
      matcher: t.matcher ?? 'trimmed',
      weight: t.weight ?? 1,
      displayOrder: i,
    });
  });

  const hintStmt = conn.prepare('INSERT INTO question_hints (question_id, display_order, body, penalty) VALUES (?, ?, ?, ?)');
  (input.hints ?? []).forEach((h, i) => hintStmt.run(questionId, i, h.body, h.penalty ?? 15));

  const solStmt = conn.prepare('INSERT INTO question_solutions (question_id, code, is_primary, note) VALUES (?, ?, ?, ?)');
  (input.solutions ?? []).forEach((s, i) => {
    const isPrimary = s.isPrimary ?? i === 0;
    solStmt.run(questionId, s.code, isPrimary ? 1 : 0, s.note ?? null);
  });

  const tagStmt = conn.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag) VALUES (?, ?)');
  for (const tag of input.tags ?? []) tagStmt.run(questionId, tag);
}

export function deleteQuestion(id: number): boolean {
  return db().prepare('DELETE FROM questions WHERE id = ?').run(id).changes > 0;
}

/** §19 — duplicate a question into an editable draft. */
export function duplicateQuestion(id: number, createdBy: number | null): FullQuestion | null {
  const source = findQuestionById(id);
  if (!source) return null;
  const input = toQuestionInput(source);
  input.qid = undefined;
  input.title = `${input.title} (copy)`;
  input.status = 'draft';
  return createQuestion(input, createdBy);
}

/** Round-trips a stored question back into the admin/import format. */
export function toQuestionInput(full: FullQuestion): QuestionInput {
  const q = full.question;
  return {
    qid: q.qid,
    language: full.languageSlug,
    topic: full.topicSlug,
    subtopic: full.subtopicSlug,
    difficulty: q.difficulty,
    questionType: q.question_type,
    evaluationType: q.evaluation_type,
    title: q.title,
    statement: q.statement,
    instructions: q.instructions,
    learningObjective: q.learning_objective,
    starterCode: q.starter_code,
    hiddenPrefix: q.hidden_prefix,
    hiddenSuffix: q.hidden_suffix,
    editablePrefill: q.editable_prefill,
    editablePlaceholder: q.editable_placeholder,
    indentFragment: q.indent_fragment === 1,
    dataset: full.dataset?.slug ?? null,
    requiredConstructs: parseJson<string[]>(q.required_constructs, []),
    forbiddenConstructs: parseJson<string[]>(q.forbidden_constructs, []),
    requiredKeywords: parseJson<string[]>(q.required_keywords, []),
    forbiddenKeywords: parseJson<string[]>(q.forbidden_keywords, []),
    options: parseJson<string[]>(q.options, []),
    config: parseJson<QuestionConfig>(q.config, {}),
    maxCodeLength: q.max_code_length,
    timeLimitMs: q.time_limit_ms,
    memoryLimitMb: q.memory_limit_mb,
    maxScore: q.max_score,
    explanation: q.explanation,
    status: q.status,
    tags: full.tags,
    testCases: full.testCases.map((t) => ({
      visibility: t.visibility,
      name: t.name,
      setupCode: t.setup_code,
      stdin: t.stdin,
      expectedOutput: t.expected_output,
      expectedValue: t.expected_value,
      matcher: t.matcher,
      weight: t.weight,
    })),
    hints: full.hints.map((h) => ({ body: h.body, penalty: h.penalty })),
    solutions: full.solutions.map((s) => ({ code: s.code, isPrimary: s.is_primary === 1, note: s.note })),
  };
}

/** Upsert by QID — used by import and by the seeder. */
export function upsertQuestion(input: QuestionInput, createdBy: number | null): { question: FullQuestion; created: boolean } {
  if (input.qid) {
    const existing = findQuestionByQid(input.qid);
    if (existing) {
      return { question: updateQuestion(existing.question.id, input)!, created: false };
    }
  }
  return { question: createQuestion(input, createdBy), created: true };
}
