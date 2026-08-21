import type { QuestionInput } from '../../db/repositories/questions.js';

/**
 * Compact authoring shape for the seed bank.
 *
 * `expected: 'AUTO'` means "run the reference solution and record what it
 * prints". That keeps expected output and reference solution in lockstep — a
 * question can never ship with an expectation its own solution fails.
 */
export interface SeedTest {
  visibility?: 'public' | 'hidden';
  name?: string;
  /** Replaces {{SETUP_CODE}} in the template, so tests can vary the data. */
  setup?: string;
  stdin?: string;
  expected?: string | 'AUTO';
  matcher?: 'exact' | 'trimmed' | 'normalized' | 'contains' | 'regex' | 'unordered_rows' | 'rows';
  weight?: number;
}

export interface SeedQuestion {
  qid: string;
  language: string;
  topic: string;
  subtopic?: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  type?: QuestionInput['questionType'];
  evaluation?: QuestionInput['evaluationType'];
  title: string;
  statement: string;
  instructions?: string;
  objective?: string;
  starter: string;
  hiddenPrefix?: string;
  hiddenSuffix?: string;
  prefill?: string;
  placeholder?: string;
  dataset?: string;
  require?: string[];
  forbid?: string[];
  requireKeywords?: string[];
  forbidKeywords?: string[];
  options?: string[];
  config?: Record<string, unknown>;
  solution: string;
  altSolutions?: string[];
  explanation: string;
  hints: string[];
  tests?: SeedTest[];
  tags?: string[];
  timeLimitMs?: number;
  maxCodeLength?: number;
}

export function toQuestionInput(seed: SeedQuestion): QuestionInput {
  return {
    qid: seed.qid,
    language: seed.language,
    topic: seed.topic,
    subtopic: seed.subtopic ?? null,
    difficulty: seed.difficulty,
    questionType: seed.type ?? 'FILL_CODE',
    evaluationType: seed.evaluation ?? 'OUTPUT',
    title: seed.title,
    statement: seed.statement,
    instructions: seed.instructions ?? null,
    learningObjective: seed.objective ?? null,
    starterCode: seed.starter,
    hiddenPrefix: seed.hiddenPrefix ?? null,
    hiddenSuffix: seed.hiddenSuffix ?? null,
    editablePrefill: seed.prefill ?? null,
    editablePlaceholder: seed.placeholder ?? null,
    indentFragment: true,
    dataset: seed.dataset ?? null,
    requiredConstructs: seed.require ?? [],
    forbiddenConstructs: seed.forbid ?? [],
    requiredKeywords: seed.requireKeywords ?? [],
    forbiddenKeywords: seed.forbidKeywords ?? [],
    options: seed.options ?? [],
    config: (seed.config ?? {}) as QuestionInput['config'],
    maxCodeLength: seed.maxCodeLength ?? 600,
    timeLimitMs: seed.timeLimitMs ?? 4000,
    memoryLimitMb: 128,
    maxScore: 100,
    explanation: seed.explanation,
    status: 'published',
    tags: seed.tags ?? [],
    testCases: (seed.tests ?? [{ visibility: 'public', expected: 'AUTO' }]).map((t) => ({
      visibility: t.visibility ?? 'public',
      name: t.name ?? null,
      setupCode: t.setup ?? null,
      stdin: t.stdin ?? null,
      expectedOutput: t.expected === 'AUTO' ? null : t.expected ?? null,
      expectedValue: null,
      matcher: t.matcher ?? 'trimmed',
      weight: t.weight ?? 1,
    })),
    hints: seed.hints.map((body, i) => ({ body, penalty: [10, 15, 20][i] ?? 20 })),
    solutions: [
      { code: seed.solution, isPrimary: true, note: 'Reference solution' },
      ...(seed.altSolutions ?? []).map((code) => ({ code, isPrimary: false, note: 'Alternative approach' })),
    ],
  };
}
