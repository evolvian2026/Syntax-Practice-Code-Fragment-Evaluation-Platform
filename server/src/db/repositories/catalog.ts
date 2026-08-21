import Database from 'better-sqlite3';
import { db, parseJson } from '../index.js';

/** Languages / topics / subtopics / datasets — the practice taxonomy. */

export interface LanguageRow {
  id: number; slug: string; name: string; runtime: string; monaco_id: string;
  file_extension: string; icon: string | null; accent: string; description: string | null;
  is_enabled: number; display_order: number;
}

export interface TopicRow {
  id: number; language_id: number; slug: string; name: string;
  description: string | null; display_order: number; is_enabled: number;
}

export interface SubtopicRow {
  id: number; topic_id: number; slug: string; name: string;
  description: string | null; display_order: number;
}

export function listLanguages(onlyEnabled = true): LanguageRow[] {
  const clause = onlyEnabled ? 'WHERE is_enabled = 1' : '';
  return db().prepare(`SELECT * FROM languages ${clause} ORDER BY display_order, name`).all() as LanguageRow[];
}

export function findLanguage(slug: string): LanguageRow | null {
  return (db().prepare('SELECT * FROM languages WHERE slug = ?').get(slug) as LanguageRow) ?? null;
}

export function listTopics(languageSlug?: string): TopicRow[] {
  if (!languageSlug) {
    return db().prepare('SELECT * FROM topics ORDER BY display_order, name').all() as TopicRow[];
  }
  return db().prepare(`
    SELECT t.* FROM topics t
    JOIN languages l ON l.id = t.language_id
    WHERE l.slug = ? AND t.is_enabled = 1
    ORDER BY t.display_order, t.name
  `).all(languageSlug) as TopicRow[];
}

export function listSubtopics(topicId: number): SubtopicRow[] {
  return db().prepare('SELECT * FROM subtopics WHERE topic_id = ? ORDER BY display_order, name')
    .all(topicId) as SubtopicRow[];
}

/** Full nested tree with per-topic question counts, used by the practice sidebar. */
export interface CatalogNode {
  slug: string;
  name: string;
  description: string | null;
  questionCount: number;
  subtopics: Array<{ slug: string; name: string; questionCount: number }>;
}

export interface CatalogLanguage {
  slug: string;
  name: string;
  runtime: string;
  monacoId: string;
  icon: string | null;
  accent: string;
  description: string | null;
  questionCount: number;
  topics: CatalogNode[];
}

export function buildCatalog(): CatalogLanguage[] {
  const conn = db();
  const languages = listLanguages();
  const topicCounts = new Map<number, number>();
  const subtopicCounts = new Map<number, number>();

  for (const row of conn.prepare(
    `SELECT topic_id, COUNT(*) AS n FROM questions WHERE status = 'published' GROUP BY topic_id`,
  ).all() as { topic_id: number; n: number }[]) {
    topicCounts.set(row.topic_id, row.n);
  }
  for (const row of conn.prepare(
    `SELECT subtopic_id, COUNT(*) AS n FROM questions WHERE status = 'published' AND subtopic_id IS NOT NULL GROUP BY subtopic_id`,
  ).all() as { subtopic_id: number; n: number }[]) {
    subtopicCounts.set(row.subtopic_id, row.n);
  }

  return languages.map((lang) => {
    const topics = listTopics(lang.slug).map((topic) => ({
      slug: topic.slug,
      name: topic.name,
      description: topic.description,
      questionCount: topicCounts.get(topic.id) ?? 0,
      subtopics: listSubtopics(topic.id).map((s) => ({
        slug: s.slug,
        name: s.name,
        questionCount: subtopicCounts.get(s.id) ?? 0,
      })),
    }));
    return {
      slug: lang.slug,
      name: lang.name,
      runtime: lang.runtime,
      monacoId: lang.monaco_id,
      icon: lang.icon,
      accent: lang.accent,
      description: lang.description,
      questionCount: topics.reduce((sum, t) => sum + t.questionCount, 0),
      topics,
    };
  });
}

// --------------------------------------------------------- SQL datasets

export interface DatasetRow {
  id: number; slug: string; name: string; dialect: string; description: string | null;
  schema_sql: string; seed_sql: string; preview: string | null;
}

export function listDatasets(): Array<Omit<DatasetRow, 'preview'> & { preview: unknown }> {
  return (db().prepare('SELECT * FROM sql_datasets ORDER BY name').all() as DatasetRow[])
    .map((d) => ({ ...d, preview: parseJson(d.preview, null) }));
}

export function findDataset(slug: string): DatasetRow | null {
  return (db().prepare('SELECT * FROM sql_datasets WHERE slug = ?').get(slug) as DatasetRow) ?? null;
}

/** Schema summary shown to students next to SQL questions. */
export function describeDataset(slug: string): {
  slug: string; name: string; description: string | null;
  tables: Array<{ name: string; columns: string[]; sampleRows: unknown[][] }>;
} | null {
  const row = findDataset(slug);
  if (!row) return null;

  // Reflection happens against a throwaway copy, never the app database.
  const mem = new Database(':memory:');
  try {
    mem.exec(row.schema_sql);
    mem.exec(row.seed_sql);
    const tables = (mem.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all() as { name: string }[]).map((t) => {
      const columns = (mem.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]).map((c) => c.name);
      const stmt = mem.prepare(`SELECT * FROM "${t.name}" LIMIT 5`);
      stmt.raw(true);
      return { name: t.name, columns, sampleRows: stmt.all() as unknown[][] };
    });
    return { slug: row.slug, name: row.name, description: row.description, tables };
  } finally {
    mem.close();
  }
}
