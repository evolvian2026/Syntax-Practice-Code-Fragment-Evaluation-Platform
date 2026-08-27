/** Thin typed wrapper over the platform API. */

const TOKEN_KEY = 'syntax-practice.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — the session simply will not persist */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check that the API is running.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? safeParse(text) : null;

  if (!response.ok) {
    const message = (payload as { error?: string })?.error ?? `Request failed (${response.status}).`;
    if (response.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    throw new ApiError(response.status, message, (payload as { issues?: [] })?.issues);
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ------------------------------------------------------------- API types

export interface User {
  id: number;
  email: string;
  fullName: string;
  role: 'student' | 'teacher' | 'admin';
  avatarColor: string;
}

export interface Profile {
  xp: number;
  level: number;
  streakCurrent: number;
  streakBest: number;
  batch: string | null;
  theme: 'dark' | 'light';
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
  topics: Array<{
    slug: string;
    name: string;
    description: string | null;
    questionCount: number;
    subtopics: Array<{ slug: string; name: string; questionCount: number }>;
  }>;
}

export interface QuestionListItem {
  id: number;
  qid: string;
  title: string;
  statement: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
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
  solved?: boolean;
  attempts?: number;
  bestScore?: number;
}

export interface DatasetTable {
  name: string;
  columns: string[];
  sampleRows: unknown[][];
}

export interface StudentQuestion {
  id: number;
  qid: string;
  title: string;
  statement: string;
  instructions: string | null;
  learningObjective: string | null;
  difficulty: 'Easy' | 'Medium' | 'Hard';
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
  contextBefore: string;
  contextAfter: string;
  editablePrefill: string;
  editablePlaceholder: string | null;
  options: string[];
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
  dataset: { slug: string; name: string; description: string | null; tables: DatasetTable[] } | null;
  progress: { attempts: number; solved: boolean; bestScore: number } | null;
  lastFragment: string | null;
}

export interface StageResult {
  stage: string;
  passed: boolean;
  title: string;
  message?: string;
}

export interface TestOutcome {
  name: string;
  visibility: 'public' | 'hidden';
  passed: boolean;
  expected?: string;
  actual?: string;
  message?: string;
  executionMs: number;
}

export interface EvaluationResult {
  verdict: string;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  errorType: string;
  errorMessage: string | null;
  feedback: string;
  stages: StageResult[];
  tests: TestOutcome[];
  testsPassed: number;
  testsFailed: number;
  generatedCode: string;
  stdout: string;
  stderr: string;
  executionMs: number;
  memoryKb: number;
  detectedConstructs: string[];
  missingConstructs: string[];
  usedForbiddenConstructs: string[];
  resultSet: { columns: string[]; rows: unknown[][] } | null;
}

export interface Award {
  xpEarned: number;
  totalXp: number;
  level: number;
  leveledUp: boolean;
  streak: number;
  streakExtended: boolean;
  newBadges: Array<{ slug: string; name: string; description: string; icon: string }>;
}

export interface AttemptResponse {
  result: EvaluationResult;
  submissionId: number | null;
  attemptNumber: number;
  award: Award | null;
  explanation: string | null;
  solutions: Array<{ code: string; note: string | null; isPrimary: boolean }>;
  /** A hint aimed at this particular mistake, when the author described it. */
  misconception: MisconceptionMatch | null;
  /** When this question next comes back for review. */
  reviewDueAt: string | null;
}

export interface Breakdown {
  key: string;
  label: string;
  attempted: number;
  solved: number;
  total: number;
  accuracy: number;
}

export interface DashboardSummary {
  attempted: number;
  solved: number;
  totalQuestions: number;
  accuracy: number;
  submissions: number;
  correctSubmissions: number;
  streakCurrent: number;
  streakBest: number;
  xp: number;
  level: number;
  timeSpentMs: number;
  hintsUsed: number;
  errors: { syntax: number; runtime: number; conceptual: number; restricted: number; timeout: number };
  byLanguage: Breakdown[];
  byTopic: Breakdown[];
  byDifficulty: Breakdown[];
  weakTopics: Breakdown[];
  strongTopics: Breakdown[];
  recentActivity: Array<{ day: string; attempts: number; solved: number }>;
}

export interface SubmissionListItem {
  id: number;
  questionId: number;
  qid: string;
  title: string;
  language: string;
  topic: string;
  difficulty: string;
  verdict: string;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  attemptNumber: number;
  hintsUsed: number;
  executionMs: number;
  createdAt: string;
}

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

export interface Badge {
  slug: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
}

export interface AssessmentSummary {
  id: number;
  title: string;
  description: string | null;
  language: string | null;
  languageName: string | null;
  durationMinutes: number;
  allowHints: boolean;
  maxAttempts: number;
  questionCount: number;
  totalPoints: number;
  startsAt: string | null;
  endsAt: string | null;
  myAttemptId: number | null;
  myAttemptStatus: string | null;
  myBestScore: number | null;
  attemptsUsed: number;
}

// ------------------------------------------------------- construct mastery

export type MasteryLevel = 'unseen' | 'attempted' | 'developing' | 'proficient';

export interface ConstructMastery {
  construct: string;
  label: string;
  attempts: number;
  correct: number;
  required: number;
  accuracy: number;
  distinctQuestions: number;
  lastUsedAt: string | null;
  level: MasteryLevel;
}

export interface ConstructGap {
  construct: string;
  label: string;
  attempts: number;
  questionsAvailable: number;
  nextQuestion: { id: number; qid: string; title: string; difficulty: string } | null;
}

// ----------------------------------------------------- spaced repetition

export interface DueReview {
  questionId: number;
  qid: string;
  title: string;
  language: string;
  topic: string;
  difficulty: string;
  dueAt: string;
  intervalDays: number;
  lapses: number;
  overdueDays: number;
}

export interface ReviewSummary {
  dueNow: number;
  dueToday: number;
  scheduled: number;
  upcoming: Array<{ date: string; count: number }>;
}

// -------------------------------------------------------- question health

export type HealthStatus = 'healthy' | 'failing' | 'unverifiable';

export interface HealthRecord {
  questionId: number;
  qid: string;
  title: string;
  status: HealthStatus;
  verdict: string | null;
  message: string | null;
  score: number | null;
  maxScore: number | null;
  durationMs: number;
  checkedAt: string;
}

export interface SweepSummary {
  checked: number;
  healthy: number;
  failing: number;
  unverifiable: number;
  durationMs: number;
  failures: HealthRecord[];
}

// --------------------------------------------------------- misconceptions

export interface MisconceptionRule {
  id?: number;
  label: string;
  hint: string;
  displayOrder?: number;
  constructUsed: string[];
  constructAbsent: string[];
  fragmentRegex: string | null;
  errorType: string | null;
  verdict: string | null;
  timesMatched?: number;
}

export interface MisconceptionMatch {
  id: number;
  label: string;
  hint: string;
}

// ------------------------------------------------- derive from a program

export interface DeriveResult {
  starterCode: string;
  solution: string;
  requiredConstructs: string[];
  detectedConstructs: string[];
  expectedOutput: string | null;
  executionError: string | null;
  warnings: string[];
}
