import { config } from '../config.js';
import { createUser, DuplicateEmailError } from '../auth/index.js';
import { db, migrate } from '../db/index.js';
import { upsertQuestion, type QuestionInput } from '../db/repositories/questions.js';
import { assemble } from '../evaluation/assembler.js';
import { getAdapter } from '../evaluation/languages/registry.js';
import { resultSetToText } from '../evaluation/comparators.js';
import type { SqlDataset, TestCaseSpec } from '../evaluation/types.js';
import { DATASETS } from './datasets.js';
import { BADGES, LANGUAGES, LEARNING_PATHS } from './taxonomy.js';
import { ALL_QUESTIONS } from './questions/index.js';
import { toQuestionInput, type SeedQuestion } from './questions/types.js';

/**
 * Seeds the platform: taxonomy, sandbox datasets, badges, learning paths,
 * demo accounts and the question bank.
 *
 * Any test case authored as `expected: 'AUTO'` is resolved here by actually
 * running the question's reference solution through the real evaluation
 * sandbox, so seeded expectations can never drift from the seeded solutions.
 */

async function main(): Promise<void> {
  const conn = db();
  migrate(conn);

  console.log('Seeding taxonomy...');
  seedTaxonomy();

  console.log('Seeding SQL sandbox datasets...');
  seedDatasets();

  console.log('Seeding badges...');
  seedBadges();

  console.log('Seeding learning paths...');
  seedLearningPaths();

  console.log('Seeding demo accounts...');
  await seedUsers();

  console.log(`Seeding ${ALL_QUESTIONS.length} questions (running reference solutions to fix expected output)...`);
  const report = await seedQuestions(ALL_QUESTIONS);

  console.log('');
  console.log(`  created  : ${report.created}`);
  console.log(`  updated  : ${report.updated}`);
  console.log(`  verified : ${report.verified}`);
  if (report.failures.length > 0) {
    console.log(`  FAILED   : ${report.failures.length}`);
    for (const f of report.failures) console.log(`    - ${f.qid}: ${f.reason}`);
    process.exitCode = 1;
  }

  const counts = conn.prepare(`
    SELECT l.name AS language, COUNT(*) AS n
    FROM questions q JOIN languages l ON l.id = q.language_id
    GROUP BY l.id ORDER BY n DESC
  `).all() as Array<{ language: string; n: number }>;
  console.log('');
  console.log('Question bank:');
  for (const row of counts) console.log(`  ${row.language.padEnd(14)} ${row.n}`);
  const total = counts.reduce((sum, r) => sum + r.n, 0);
  console.log(`  ${'TOTAL'.padEnd(14)} ${total}`);
}

// ------------------------------------------------------------- taxonomy

function seedTaxonomy(): void {
  const conn = db();
  const insertLanguage = conn.prepare(`
    INSERT INTO languages (slug, name, runtime, monaco_id, file_extension, icon, accent, description, display_order)
    VALUES (@slug, @name, @runtime, @monacoId, @fileExtension, @icon, @accent, @description, @order)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, runtime = excluded.runtime, monaco_id = excluded.monaco_id,
      icon = excluded.icon, accent = excluded.accent, description = excluded.description,
      display_order = excluded.display_order
  `);
  const insertTopic = conn.prepare(`
    INSERT INTO topics (language_id, slug, name, description, display_order)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(language_id, slug) DO UPDATE SET
      name = excluded.name, description = excluded.description, display_order = excluded.display_order
  `);
  const insertSubtopic = conn.prepare(`
    INSERT INTO subtopics (topic_id, slug, name, display_order) VALUES (?, ?, ?, ?)
    ON CONFLICT(topic_id, slug) DO UPDATE SET name = excluded.name, display_order = excluded.display_order
  `);

  conn.transaction(() => {
    LANGUAGES.forEach((lang, langIndex) => {
      insertLanguage.run({
        slug: lang.slug, name: lang.name, runtime: lang.runtime, monacoId: lang.monacoId,
        fileExtension: lang.fileExtension, icon: lang.icon, accent: lang.accent,
        description: lang.description, order: langIndex,
      });
      const languageId = (conn.prepare('SELECT id FROM languages WHERE slug = ?').get(lang.slug) as { id: number }).id;

      lang.topics.forEach((topic, topicIndex) => {
        insertTopic.run(languageId, topic.slug, topic.name, topic.description ?? null, topicIndex);
        const topicId = (conn.prepare('SELECT id FROM topics WHERE language_id = ? AND slug = ?')
          .get(languageId, topic.slug) as { id: number }).id;
        topic.subtopics.forEach(([slug, name], i) => insertSubtopic.run(topicId, slug, name, i));
      });
    });
  })();
}

function seedDatasets(): void {
  const stmt = db().prepare(`
    INSERT INTO sql_datasets (slug, name, dialect, description, schema_sql, seed_sql)
    VALUES (@slug, @name, @dialect, @description, @schemaSql, @seedSql)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, dialect = excluded.dialect, description = excluded.description,
      schema_sql = excluded.schema_sql, seed_sql = excluded.seed_sql
  `);
  db().transaction(() => {
    for (const dataset of DATASETS) stmt.run(dataset);
  })();
}

function seedBadges(): void {
  const stmt = db().prepare(`
    INSERT INTO badges (slug, name, description, icon, criteria_type, criteria_value, scope_language, scope_topic, xp_reward)
    VALUES (@slug, @name, @description, @icon, @criteriaType, @criteriaValue, @scopeLanguage, @scopeTopic, @xpReward)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, description = excluded.description, icon = excluded.icon,
      criteria_type = excluded.criteria_type, criteria_value = excluded.criteria_value,
      scope_language = excluded.scope_language, scope_topic = excluded.scope_topic,
      xp_reward = excluded.xp_reward
  `);
  db().transaction(() => {
    for (const badge of BADGES) {
      stmt.run({
        slug: badge.slug, name: badge.name, description: badge.description, icon: badge.icon,
        criteriaType: badge.criteriaType, criteriaValue: badge.criteriaValue,
        scopeLanguage: (badge as { scopeLanguage?: string }).scopeLanguage ?? null,
        scopeTopic: (badge as { scopeTopic?: string }).scopeTopic ?? null,
        xpReward: badge.xpReward,
      });
    }
  })();
}

function seedLearningPaths(): void {
  const conn = db();
  conn.transaction(() => {
    for (const path of LEARNING_PATHS) {
      const language = conn.prepare('SELECT id FROM languages WHERE slug = ?').get(path.language) as { id: number } | undefined;
      if (!language) continue;

      conn.prepare(`
        INSERT INTO learning_paths (language_id, slug, name, description)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET name = excluded.name, description = excluded.description
      `).run(language.id, path.slug, path.name, path.description);

      const pathId = (conn.prepare('SELECT id FROM learning_paths WHERE slug = ?').get(path.slug) as { id: number }).id;
      conn.prepare('DELETE FROM learning_path_nodes WHERE path_id = ?').run(pathId);

      const insertNode = conn.prepare(`
        INSERT INTO learning_path_nodes
          (path_id, parent_id, title, topic_id, subtopic_id, display_order, unlock_accuracy, unlock_solved, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const resolveTopic = (slug?: string) => (slug
        ? (conn.prepare('SELECT id FROM topics WHERE language_id = ? AND slug = ?').get(language.id, slug) as { id: number } | undefined)?.id ?? null
        : null);
      const resolveSubtopic = (topicSlug?: string, slug?: string) => {
        if (!topicSlug || !slug) return null;
        const topicId = resolveTopic(topicSlug);
        if (!topicId) return null;
        return (conn.prepare('SELECT id FROM subtopics WHERE topic_id = ? AND slug = ?').get(topicId, slug) as { id: number } | undefined)?.id ?? null;
      };

      path.nodes.forEach((node, i) => {
        const info = insertNode.run(
          pathId, null, node.title, resolveTopic(node.topic),
          resolveSubtopic(node.topic, node.subtopic), i,
          node.unlockAccuracy ?? 0, node.unlockSolved ?? 0, null,
        );
        const parentId = Number(info.lastInsertRowid);
        (node.children ?? []).forEach((child, j) => {
          insertNode.run(
            pathId, parentId, child.title, resolveTopic(child.topic),
            resolveSubtopic(child.topic, child.subtopic), j,
            child.unlockAccuracy ?? 0, child.unlockSolved ?? 0, null,
          );
        });
      });
    }
  })();
}

async function seedUsers(): Promise<void> {
  const accounts = [
    { email: 'admin@syntaxpractice.dev', password: config.seedPasswords.admin, fullName: 'Platform Admin', role: 'admin' as const },
    { email: 'teacher@syntaxpractice.dev', password: config.seedPasswords.admin, fullName: 'Priya Teacher', role: 'teacher' as const },
    { email: 'student@syntaxpractice.dev', password: config.seedPasswords.student, fullName: 'Sam Student', role: 'student' as const, batch: 'Batch A' },
    { email: 'student2@syntaxpractice.dev', password: config.seedPasswords.student, fullName: 'Riya Learner', role: 'student' as const, batch: 'Batch A' },
    { email: 'student3@syntaxpractice.dev', password: config.seedPasswords.student, fullName: 'Dev Kumar', role: 'student' as const, batch: 'Batch B' },
  ];
  for (const account of accounts) {
    try {
      await createUser(account);
      console.log(`  + ${account.email} (${account.role})`);
    } catch (err) {
      if (!(err instanceof DuplicateEmailError)) throw err;
    }
  }
}

// ------------------------------------------------------------ questions

interface SeedReport {
  created: number;
  updated: number;
  verified: number;
  failures: Array<{ qid: string; reason: string }>;
}

async function seedQuestions(seeds: SeedQuestion[]): Promise<SeedReport> {
  const report: SeedReport = { created: 0, updated: 0, verified: 0, failures: [] };
  const conn = db();
  const admin = conn.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get() as { id: number } | undefined;

  const seen = new Set<string>();
  for (const seed of seeds) {
    if (seen.has(seed.qid)) {
      report.failures.push({ qid: seed.qid, reason: 'duplicate QID in the seed bank' });
      continue;
    }
    seen.add(seed.qid);

    const input = toQuestionInput(seed);
    try {
      await resolveExpectedOutputs(seed, input);
      const { created } = upsertQuestion(input, admin?.id ?? null);
      if (created) report.created += 1; else report.updated += 1;
      report.verified += 1;
    } catch (err) {
      report.failures.push({ qid: seed.qid, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

/** Runs the reference solution once per test case to fill in `AUTO` expectations. */
async function resolveExpectedOutputs(seed: SeedQuestion, input: QuestionInput): Promise<void> {
  const tests = input.testCases ?? [];
  if (tests.length === 0) return;

  const adapter = getAdapter(seed.language);
  if (!adapter.execute) return; // static languages are graded without execution

  let dataset: SqlDataset | null = null;
  if (input.dataset) {
    const row = db().prepare('SELECT * FROM sql_datasets WHERE slug = ?').get(input.dataset) as any;
    if (!row) throw new Error(`unknown dataset "${input.dataset}"`);
    dataset = {
      id: row.id, slug: row.slug, name: row.name, dialect: row.dialect,
      schemaSql: row.schema_sql, seedSql: row.seed_sql,
    };
  }

  for (const test of tests) {
    if (test.expectedOutput !== null && test.expectedOutput !== undefined) continue;

    const spec: TestCaseSpec = {
      visibility: test.visibility,
      setupCode: test.setupCode ?? null,
      stdin: test.stdin ?? null,
      expectedOutput: null,
      matcher: test.matcher ?? 'trimmed',
      weight: test.weight ?? 1,
    };

    const assembled = assemble(
      {
        starterCode: input.starterCode,
        hiddenPrefix: input.hiddenPrefix ?? null,
        hiddenSuffix: input.hiddenSuffix ?? null,
        indentFragment: true,
      },
      seed.solution,
      adapter.setupIsData ? null : spec,
    );

    const outcome = await adapter.execute(
      assembled.program,
      spec,
      {
        id: 0, qid: seed.qid, languageSlug: seed.language, runtime: adapter.runtime,
        difficulty: seed.difficulty, questionType: 'FILL_CODE', evaluationType: input.evaluationType as any,
        title: seed.title, statement: seed.statement, starterCode: input.starterCode,
        indentFragment: true, requiredConstructs: [], forbiddenConstructs: [],
        requiredKeywords: [], forbiddenKeywords: [], maxCodeLength: 5000,
        timeLimitMs: input.timeLimitMs ?? 4000, memoryLimitMb: 128, maxScore: 100,
        testCases: [], acceptedSolutions: [], config: {}, dataset,
      },
    );

    if (outcome.status !== 'ok') {
      throw new Error(`reference solution failed (${outcome.status}): ${outcome.errorMessage ?? outcome.stderr}`);
    }

    test.expectedOutput = outcome.resultSet ? resultSetToText(outcome.resultSet) : outcome.stdout.replace(/\n+$/, '');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
