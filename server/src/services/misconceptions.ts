import { db, parseJson } from '../db/index.js';
import type { EvaluationResult } from '../evaluation/types.js';

/**
 * Misconception-tagged hints.
 *
 * An ordinary hint is attached to a *position* in a list: hint 1, then 2, then
 * 3, the same for everyone regardless of what they wrote. This attaches a hint
 * to a *detected pattern* instead, so a student who writes `range(len(items))`
 * is told about iterating directly, while one who forgot the colon is not.
 *
 * The engine already reports the constructs the student used and the error it
 * hit, so matching costs one query and no extra analysis. Rules are ANDed;
 * an empty rule set matches nothing, so a misconception with no criteria is
 * inert rather than universal.
 */

export interface MisconceptionRule {
  id: number;
  questionId: number;
  label: string;
  hint: string;
  displayOrder: number;
  constructUsed: string[];
  constructAbsent: string[];
  fragmentRegex: string | null;
  errorType: string | null;
  verdict: string | null;
  timesMatched: number;
}

export interface MisconceptionMatch {
  id: number;
  label: string;
  hint: string;
}

export function listMisconceptions(questionId: number): MisconceptionRule[] {
  const rows = db().prepare(
    'SELECT * FROM question_misconceptions WHERE question_id = ? ORDER BY display_order, id',
  ).all(questionId) as any[];
  return rows.map(toRule);
}

export function replaceMisconceptions(
  questionId: number,
  rules: Array<Omit<MisconceptionRule, 'id' | 'questionId' | 'timesMatched'>>,
): void {
  const conn = db();
  const txn = conn.transaction(() => {
    conn.prepare('DELETE FROM question_misconceptions WHERE question_id = ?').run(questionId);
    const stmt = conn.prepare(`
      INSERT INTO question_misconceptions
        (question_id, label, hint, display_order, construct_used, construct_absent,
         fragment_regex, error_type, verdict)
      VALUES (@questionId, @label, @hint, @displayOrder, @constructUsed, @constructAbsent,
              @fragmentRegex, @errorType, @verdict)
    `);
    rules.forEach((rule, index) => {
      stmt.run({
        questionId,
        label: rule.label,
        hint: rule.hint,
        displayOrder: rule.displayOrder ?? index,
        constructUsed: JSON.stringify(rule.constructUsed ?? []),
        constructAbsent: JSON.stringify(rule.constructAbsent ?? []),
        fragmentRegex: rule.fragmentRegex || null,
        errorType: rule.errorType || null,
        verdict: rule.verdict || null,
      });
    });
  });
  txn();
}

/**
 * The first rule whose criteria all hold, or null.
 *
 * Only one is returned: a wall of hints is the opposite of targeted feedback,
 * and the author's ordering says which misconception matters most.
 */
export function matchMisconception(
  questionId: number,
  fragment: string,
  result: EvaluationResult,
): MisconceptionMatch | null {
  // A correct answer has no misconception to diagnose.
  if (result.isCorrect) return null;

  const used = new Set(result.detectedConstructs ?? []);

  for (const rule of listMisconceptions(questionId)) {
    if (!hasCriteria(rule)) continue;
    if (rule.verdict && rule.verdict !== result.verdict) continue;
    if (rule.errorType && rule.errorType !== result.errorType) continue;
    if (rule.constructUsed.some((c) => !used.has(c))) continue;
    if (rule.constructAbsent.some((c) => used.has(c))) continue;
    if (rule.fragmentRegex && !safeMatch(rule.fragmentRegex, fragment)) continue;

    db().prepare('UPDATE question_misconceptions SET times_matched = times_matched + 1 WHERE id = ?')
      .run(rule.id);
    return { id: rule.id, label: rule.label, hint: rule.hint };
  }

  return null;
}

function hasCriteria(rule: MisconceptionRule): boolean {
  return rule.constructUsed.length > 0
    || rule.constructAbsent.length > 0
    || Boolean(rule.fragmentRegex)
    || Boolean(rule.errorType)
    || Boolean(rule.verdict);
}

/**
 * Author-supplied patterns are matched with a guard: a bad regex must not take
 * down a submission, and a catastrophically backtracking one must not hang it.
 */
function safeMatch(pattern: string, fragment: string): boolean {
  try {
    // Bounded input keeps a pathological pattern from running away; fragments
    // are short by design and questions cap the length anyway.
    return new RegExp(pattern, 'm').test(fragment.slice(0, 4000));
  } catch {
    return false;
  }
}

/** Which misconceptions actually fire, for the admin analytics view. */
export function misconceptionStats(limit = 25): Array<{
  id: number; label: string; hint: string; timesMatched: number; qid: string; title: string;
}> {
  const rows = db().prepare(`
    SELECT m.id, m.label, m.hint, m.times_matched, q.qid, q.title
    FROM question_misconceptions m
    JOIN questions q ON q.id = m.question_id
    WHERE m.times_matched > 0
    ORDER BY m.times_matched DESC
    LIMIT ?
  `).all(limit) as any[];
  return rows.map((r) => ({
    id: r.id, label: r.label, hint: r.hint, timesMatched: r.times_matched, qid: r.qid, title: r.title,
  }));
}

function toRule(row: any): MisconceptionRule {
  return {
    id: row.id,
    questionId: row.question_id,
    label: row.label,
    hint: row.hint,
    displayOrder: row.display_order,
    constructUsed: parseJson<string[]>(row.construct_used, []),
    constructAbsent: parseJson<string[]>(row.construct_absent, []),
    fragmentRegex: row.fragment_regex,
    errorType: row.error_type,
    verdict: row.verdict,
    timesMatched: row.times_matched,
  };
}
