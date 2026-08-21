import { db } from '../db/index.js';

/**
 * §18 — structured learning progression.
 *
 * A path is a tree of nodes, each pointing at a topic or subtopic. A node
 * unlocks when its *previous sibling* meets the configured thresholds
 * (questions solved and accuracy), so students master a construct before the
 * next one opens.
 */

export interface PathNode {
  id: number;
  title: string;
  description: string | null;
  topic: string | null;
  subtopic: string | null;
  questionCount: number;
  solvedCount: number;
  attemptedCount: number;
  accuracy: number;
  completion: number;
  unlocked: boolean;
  unlockRule: { solved: number; accuracy: number } | null;
  lockedReason: string | null;
  children: PathNode[];
}

export interface LearningPath {
  slug: string;
  name: string;
  description: string | null;
  language: string;
  languageName: string;
  nodes: PathNode[];
  overallCompletion: number;
}

interface NodeRow {
  id: number; path_id: number; parent_id: number | null; title: string;
  topic_id: number | null; subtopic_id: number | null; display_order: number;
  unlock_accuracy: number; unlock_solved: number; description: string | null;
}

export function learningPathFor(languageSlug: string, userId: number): LearningPath | null {
  const conn = db();
  const path = conn.prepare(`
    SELECT p.*, l.slug AS language, l.name AS language_name
    FROM learning_paths p JOIN languages l ON l.id = p.language_id
    WHERE l.slug = ? AND p.is_enabled = 1
    ORDER BY p.id LIMIT 1
  `).get(languageSlug) as any;
  if (!path) return null;

  const rows = conn.prepare(
    'SELECT * FROM learning_path_nodes WHERE path_id = ? ORDER BY display_order, id',
  ).all(path.id) as NodeRow[];

  // Per-node question/solve counts in one pass.
  const stats = new Map<number, { total: number; solved: number; attempted: number }>();
  const statStmt = conn.prepare(`
    SELECT COUNT(DISTINCT q.id) AS total,
           COUNT(DISTINCT CASE WHEN sp.solved = 1 THEN q.id END) AS solved,
           COUNT(DISTINCT sp.question_id) AS attempted
    FROM questions q
    LEFT JOIN student_progress sp ON sp.question_id = q.id AND sp.user_id = @userId
    WHERE q.status = 'published'
      AND (@topicId IS NULL OR q.topic_id = @topicId)
      AND (@subtopicId IS NULL OR q.subtopic_id = @subtopicId)
      AND (@topicId IS NOT NULL OR @subtopicId IS NOT NULL)
  `);
  for (const row of rows) {
    const s = statStmt.get({ userId, topicId: row.topic_id, subtopicId: row.subtopic_id }) as any;
    stats.set(row.id, { total: s?.total ?? 0, solved: s?.solved ?? 0, attempted: s?.attempted ?? 0 });
  }

  const topicSlugs = new Map<number, string>();
  for (const t of conn.prepare('SELECT id, slug FROM topics').all() as any[]) topicSlugs.set(t.id, t.slug);
  const subtopicSlugs = new Map<number, string>();
  for (const s of conn.prepare('SELECT id, slug FROM subtopics').all() as any[]) subtopicSlugs.set(s.id, s.slug);

  const byParent = new Map<number | null, NodeRow[]>();
  for (const row of rows) {
    const key = row.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(row);
  }

  const build = (parentId: number | null, parentUnlocked: boolean): PathNode[] => {
    const siblings = byParent.get(parentId) ?? [];
    const built: PathNode[] = [];
    let previous: PathNode | null = null;

    for (const row of siblings) {
      const own = stats.get(row.id) ?? { total: 0, solved: 0, attempted: 0 };

      let unlocked = parentUnlocked;
      let lockedReason: string | null = parentUnlocked ? null : 'Complete the previous section first.';

      if (unlocked && previous && (previous.unlockRule?.solved || previous.unlockRule?.accuracy)) {
        const need = previous.unlockRule!;
        const enough = previous.solvedCount >= need.solved && previous.accuracy >= need.accuracy;
        if (!enough) {
          unlocked = false;
          const parts: string[] = [];
          if (previous.solvedCount < need.solved) {
            parts.push(`solve ${need.solved - previous.solvedCount} more in "${previous.title}"`);
          }
          if (previous.accuracy < need.accuracy) {
            parts.push(`reach ${need.accuracy}% accuracy in "${previous.title}"`);
          }
          lockedReason = `To unlock: ${parts.join(' and ')}.`;
        }
      }

      // A grouping node (no topic of its own) aggregates its children.
      const children = build(row.id, unlocked);
      const s = row.topic_id || row.subtopic_id
        ? own
        : children.reduce(
          (acc, c) => ({
            total: acc.total + c.questionCount,
            solved: acc.solved + c.solvedCount,
            attempted: acc.attempted + c.attemptedCount,
          }),
          { total: 0, solved: 0, attempted: 0 },
        );
      const accuracy = s.attempted > 0 ? Math.round((s.solved / s.attempted) * 100) : 0;
      const completion = s.total > 0 ? Math.round((s.solved / s.total) * 100) : 0;

      const node: PathNode = {
        id: row.id,
        title: row.title,
        description: row.description,
        topic: row.topic_id ? topicSlugs.get(row.topic_id) ?? null : null,
        subtopic: row.subtopic_id ? subtopicSlugs.get(row.subtopic_id) ?? null : null,
        questionCount: s.total,
        solvedCount: s.solved,
        attemptedCount: s.attempted,
        accuracy,
        completion,
        unlocked,
        unlockRule: (row.unlock_solved || row.unlock_accuracy)
          ? { solved: row.unlock_solved, accuracy: row.unlock_accuracy }
          : null,
        lockedReason: unlocked ? null : lockedReason,
        children,
      };
      built.push(node);
      previous = node;
    }
    return built;
  };

  const nodes = build(null, true);
  // Only leaf nodes contribute, so a topic covered by both a parent and its
  // children is not counted twice.
  const totals = rows.reduce(
    (acc, row) => {
      if (byParent.get(row.id)?.length) return acc;
      const s = stats.get(row.id) ?? { total: 0, solved: 0 };
      acc.total += s.total;
      acc.solved += s.solved;
      return acc;
    },
    { total: 0, solved: 0 },
  );

  return {
    slug: path.slug,
    name: path.name,
    description: path.description,
    language: path.language,
    languageName: path.language_name,
    nodes,
    overallCompletion: totals.total > 0 ? Math.round((totals.solved / totals.total) * 100) : 0,
  };
}
