import { SETUP_MARKER, splitTemplate } from '../evaluation/assembler.js';
import { describeConstruct } from '../evaluation/constructs.js';
import { evaluate } from '../evaluation/engine.js';
import type { EvaluationResult } from '../evaluation/types.js';
import { db } from '../db/index.js';
import { describeDataset } from '../db/repositories/catalog.js';
import {
  findQuestionById, findQuestionByQid, toEvaluable, type FullQuestion,
} from '../db/repositories/questions.js';
import {
  countHintsUsed, hasRevealedSolution, lastSubmissionFor, recordSubmission,
} from '../db/repositories/submissions.js';
import { awardForSolve, type AwardResult } from './gamification.js';

/**
 * Practice orchestration: what a student sees, what they may not see, and what
 * happens when they press Run or Submit.
 */

export interface StudentQuestionView {
  id: number;
  qid: string;
  title: string;
  statement: string;
  instructions: string | null;
  learningObjective: string | null;
  difficulty: string;
  questionType: string;
  evaluationType: string;
  language: string;
  languageName: string;
  monacoId: string;
  topic: string;
  topicName: string;
  subtopic: string | null;
  subtopicName: string | null;
  tags: string[];
  /** Read-only context shown above/below the editable box. */
  contextBefore: string;
  contextAfter: string;
  editablePrefill: string;
  editablePlaceholder: string | null;
  options: string[];
  /** Public test cases only — hidden ones are never serialised to the client. */
  publicTests: Array<{ id: number; name: string; stdin: string | null; expectedOutput: string | null }>;
  hiddenTestCount: number;
  hintCount: number;
  hintsUsed: number;
  solutionRevealed: boolean;
  timeLimitMs: number;
  memoryLimitMb: number;
  maxCodeLength: number;
  maxScore: number;
  requiredConstructLabels: string[];
  dataset: ReturnType<typeof describeDataset> | null;
  progress: { attempts: number; solved: boolean; bestScore: number } | null;
  lastFragment: string | null;
}

export function loadQuestion(idOrQid: number | string): FullQuestion | null {
  return typeof idOrQid === 'number' ? findQuestionById(idOrQid) : findQuestionByQid(idOrQid);
}

export function toStudentView(full: FullQuestion, userId?: number): StudentQuestionView {
  const q = full.question;
  const evaluable = toEvaluable(full);

  // The student sees the *public* test's data in the read-only context, so the
  // {{SETUP_CODE}} marker never leaks into the UI.
  const publicSetup = full.testCases.find((t) => t.visibility === 'public')?.setup_code
    ?? full.testCases[0]?.setup_code
    ?? '';
  const displayTemplate = q.starter_code.split(SETUP_MARKER).join(publicSetup);

  let contextBefore = '';
  let contextAfter = '';
  try {
    const split = splitTemplate(displayTemplate);
    contextBefore = split.prefix.replace(/[ \t]+$/, '');
    contextAfter = split.suffix.replace(/^\n/, '');
  } catch {
    // A malformed template is an authoring bug; show the raw starter code.
    contextBefore = displayTemplate;
  }

  const progressRow = userId
    ? db().prepare(
      'SELECT attempts, solved, best_score FROM student_progress WHERE user_id = ? AND question_id = ?',
    ).get(userId, q.id) as any
    : null;

  const last = userId ? lastSubmissionFor(userId, q.id) : null;

  return {
    id: q.id,
    qid: q.qid,
    title: q.title,
    statement: q.statement,
    instructions: q.instructions,
    learningObjective: q.learning_objective,
    difficulty: q.difficulty,
    questionType: q.question_type,
    evaluationType: q.evaluation_type,
    language: full.languageSlug,
    languageName: full.languageName,
    monacoId: full.monacoId,
    topic: full.topicSlug,
    topicName: full.topicName,
    subtopic: full.subtopicSlug,
    subtopicName: full.subtopicName,
    tags: full.tags,
    contextBefore,
    contextAfter,
    editablePrefill: q.editable_prefill ?? '',
    editablePlaceholder: q.editable_placeholder,
    options: parseOptions(q.options),
    publicTests: full.testCases
      .filter((t) => t.visibility === 'public')
      .map((t) => ({ id: t.id, name: t.name ?? 'Example', stdin: t.stdin, expectedOutput: t.expected_output })),
    hiddenTestCount: full.testCases.filter((t) => t.visibility === 'hidden').length,
    hintCount: full.hints.length,
    hintsUsed: userId ? countHintsUsed(userId, q.id) : 0,
    solutionRevealed: userId ? hasRevealedSolution(userId, q.id) : false,
    timeLimitMs: q.time_limit_ms,
    memoryLimitMb: q.memory_limit_mb,
    maxCodeLength: q.max_code_length,
    maxScore: q.max_score,
    requiredConstructLabels: evaluable.requiredConstructs.map(describeConstruct),
    dataset: full.dataset ? describeDataset(full.dataset.slug) : null,
    progress: progressRow
      ? { attempts: progressRow.attempts, solved: progressRow.solved === 1, bestScore: progressRow.best_score }
      : null,
    lastFragment: last?.fragment_code ?? null,
  };
}

function parseOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ run/submit

export interface AttemptInput {
  userId: number;
  question: FullQuestion;
  fragment: string;
  mode: 'run' | 'submit';
  timeSpentMs?: number;
  assessmentId?: number | null;
  selectedOption?: string | null;
}

export interface AttemptOutcome {
  result: EvaluationResult;
  submissionId: number | null;
  attemptNumber: number;
  award: AwardResult | null;
  explanation: string | null;
  solutions: Array<{ code: string; note: string | null; isPrimary: boolean }>;
}

export async function attempt(input: AttemptInput): Promise<AttemptOutcome> {
  const { userId, question, fragment, mode } = input;
  const evaluable = toEvaluable(question);

  const hintsUsed = countHintsUsed(userId, question.question.id);
  const solutionRevealed = hasRevealedSolution(userId, question.question.id);

  // Hint and solution penalties belong to free practice. Inside an assessment
  // the score comes from the assessment's own rules, so practice-mode history
  // on the same question must not carry over.
  const inAssessment = Boolean(input.assessmentId);

  const result = await evaluate({
    question: evaluable,
    fragment,
    mode,
    hintsUsed: inAssessment ? 0 : hintsUsed,
    solutionRevealed: inAssessment ? false : solutionRevealed,
    selectedOption: input.selectedOption ?? null,
  });

  const wasSolvedBefore = (db().prepare(
    'SELECT solved FROM student_progress WHERE user_id = ? AND question_id = ?',
  ).get(userId, question.question.id) as { solved: number } | undefined)?.solved === 1;

  const { submissionId, attemptNumber } = recordSubmission({
    userId,
    questionId: question.question.id,
    assessmentId: input.assessmentId ?? null,
    mode,
    fragment,
    result,
    hintsUsed,
    timeSpentMs: input.timeSpentMs ?? 0,
  });

  let award: AwardResult | null = null;
  if (mode === 'submit' && result.isCorrect) {
    award = awardForSolve({
      userId,
      questionId: question.question.id,
      difficulty: question.question.difficulty,
      score: result.score,
      maxScore: result.maxScore,
      firstSolve: !wasSolvedBefore,
      hintsUsed,
    });
  }

  // §16 — the explanation and alternative solutions unlock once the student is
  // done with the question (solved it, or looked at the solution).
  const reveal = mode === 'submit' && (result.isCorrect || solutionRevealed);

  return {
    result,
    submissionId,
    attemptNumber,
    award,
    explanation: reveal ? question.question.explanation : null,
    solutions: reveal
      ? question.solutions.map((s) => ({ code: s.code, note: s.note, isPrimary: s.is_primary === 1 }))
      : [],
  };
}

/**
 * Strips anything a student must not see from an evaluation result
 * (hidden expectations, the generated program's hidden sections).
 */
export function redactForStudent(result: EvaluationResult, opts: { showGeneratedCode: boolean }): EvaluationResult {
  return {
    ...result,
    generatedCode: opts.showGeneratedCode ? result.generatedCode : '',
    tests: result.tests.map((t) => (t.visibility === 'hidden'
      ? {
        ...t,
        expected: undefined,
        actual: undefined,
        stdout: undefined,
        stderr: undefined,
        message: t.passed ? undefined : 'Hidden test case failed.',
      }
      : t)),
  };
}
