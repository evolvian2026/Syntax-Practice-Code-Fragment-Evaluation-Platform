import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FragmentEditor } from '../components/FragmentEditor';
import { DifficultyBadge, ErrorNote, Spinner, VerdictBadge, formatDuration } from '../components/ui';
import { api, type StudentQuestion } from '../lib/api';

interface Attempt {
  id: number;
  assessmentId: number;
  status: 'in_progress' | 'submitted' | 'expired';
  startedAt: string;
  submittedAt: string | null;
  score: number;
  maxScore: number;
  correctCount: number;
  durationMinutes: number | null;
  endsAt: string | null;
}

interface AnswerState {
  questionId: number;
  score: number;
  points: number;
  isCorrect: boolean;
  attempts: number;
}

type AssessmentQuestion = StudentQuestion & { points: number };

/** §23 — taking an assessment: timer, per-question answers, final report. */
export function AssessmentAttempt({ theme }: { theme: 'dark' | 'light' }) {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastVerdict, setLastVerdict] = useState<{ verdict: string; feedback: string } | null>(null);
  const [report, setReport] = useState<Array<Record<string, unknown>> | null>(null);
  const [now, setNow] = useState(Date.now());
  const questionStarted = useRef(Date.now());

  useEffect(() => {
    api.get<{ attempt: Attempt; questions: AssessmentQuestion[]; answers: AnswerState[] }>(`/assessments/attempts/${attemptId}`)
      .then((res) => {
        setAttempt(res.attempt);
        setQuestions(res.questions);
        setAnswers(Object.fromEntries(res.answers.map((a) => [a.questionId, a])));
        setDrafts(Object.fromEntries(res.questions.map((q) => [q.id, q.editablePrefill ?? ''])));
        if (res.attempt.status !== 'in_progress') {
          api.get<{ report: Array<Record<string, unknown>> }>(`/assessments/attempts/${attemptId}/report`)
            .then((r) => setReport(r.report))
            .catch(() => {});
        }
      })
      .catch((err) => setError(err.message));
  }, [attemptId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => {
    if (!attempt?.endsAt) return null;
    return new Date(attempt.endsAt).getTime() - now;
  }, [attempt, now]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.post<{ attempt: Attempt; result: Array<Record<string, unknown>> }>(
        `/assessments/attempts/${attemptId}/submit`,
      );
      setAttempt(res.attempt);
      setReport(res.result ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [attemptId]);

  // Auto-submit when the clock runs out.
  useEffect(() => {
    if (attempt?.status === 'in_progress' && remainingMs !== null && remainingMs <= 0) void finish();
  }, [attempt, remainingMs, finish]);

  const saveAnswer = async () => {
    const question = questions[current];
    if (!question || busy) return;
    setBusy(true);
    setLastVerdict(null);
    try {
      const res = await api.post<{ result: { verdict: string; feedback: string; isCorrect: boolean }; earned: number; points: number }>(
        `/assessments/attempts/${attemptId}/answer`,
        { questionId: question.id, code: drafts[question.id] ?? '', timeSpentMs: Date.now() - questionStarted.current },
      );
      setLastVerdict({ verdict: res.result.verdict, feedback: res.result.feedback });
      setAnswers((prev) => ({
        ...prev,
        [question.id]: {
          questionId: question.id,
          score: res.earned,
          points: res.points,
          isCorrect: res.result.isCorrect,
          attempts: (prev[question.id]?.attempts ?? 0) + 1,
        },
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !attempt) return <ErrorNote message={error} />;
  if (!attempt) return <div className="card p-8"><Spinner /></div>;

  if (attempt.status !== 'in_progress') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="card p-6 text-center">
          <p className="text-sm uppercase tracking-wide text-slate-500">Assessment complete</p>
          <p className="mt-2 text-4xl font-semibold">
            {attempt.score}
            <span className="text-2xl text-slate-400">/{attempt.maxScore}</span>
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {attempt.correctCount} correct · {attempt.status === 'expired' ? 'time expired' : 'submitted'}
          </p>
          <button className="btn-primary mt-4" onClick={() => navigate('/assessments')}>Back to assessments</button>
        </div>

        {report && report.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
                <tr>
                  <th className="px-4 py-2.5">Question</th>
                  <th className="px-4 py-2.5">Verdict</th>
                  <th className="px-4 py-2.5 text-right">Score</th>
                  <th className="hidden px-4 py-2.5 text-right sm:table-cell">Attempts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
                {report.map((row) => (
                  <tr key={String(row.questionId)}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{String(row.title)}</p>
                      <p className="font-mono text-[11px] text-slate-400">{String(row.qid)} · {String(row.topic)}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.verdict ? <VerdictBadge verdict={String(row.verdict)} /> : <span className="text-slate-400">not attempted</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{String(row.score)}/{String(row.points)}</td>
                    <td className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">{String(row.attempts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const question = questions[current];
  const answered = Object.values(answers).filter((a) => a.attempts > 0).length;

  return (
    <div className="space-y-4">
      <div className="card sticky top-16 z-20 flex flex-wrap items-center gap-3 p-3">
        <span className="font-medium">Question {current + 1} of {questions.length}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{answered} answered</span>
        {remainingMs !== null && (
          <span className={`ml-auto font-mono text-sm ${remainingMs < 60_000 ? 'text-rose-500' : 'text-slate-500'}`}>
            ⏱ {formatClock(remainingMs)}
          </span>
        )}
        <button className="btn-primary" onClick={finish} disabled={busy}>Finish &amp; submit</button>
      </div>

      <div className="flex flex-wrap gap-1">
        {questions.map((q, i) => {
          const state = answers[q.id];
          return (
            <button
              key={q.id}
              onClick={() => { setCurrent(i); setLastVerdict(null); questionStarted.current = Date.now(); }}
              className={`h-8 w-8 rounded-lg text-xs font-medium ${
                i === current
                  ? 'bg-brand-600 text-white'
                  : state?.isCorrect
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                    : state?.attempts
                      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-ink-850 dark:text-slate-400'
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {error && <ErrorNote message={error} />}

      {question && (
        <div className="grid gap-4 xl:grid-cols-[minmax(300px,400px)_1fr]">
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <DifficultyBadge difficulty={question.difficulty} />
              <span className="chip bg-slate-100 dark:bg-ink-850">{question.points} points</span>
            </div>
            <h2 className="font-medium">{question.title}</h2>
            <p className="mt-2 whitespace-pre-line text-sm">{question.statement}</p>
            {question.instructions && (
              <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-ink-850">{question.instructions}</p>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            <FragmentEditor
              language={question.monacoId}
              contextBefore={question.contextBefore}
              contextAfter={question.contextAfter}
              value={drafts[question.id] ?? ''}
              onChange={(value) => setDrafts((prev) => ({ ...prev, [question.id]: value }))}
              onSubmit={saveAnswer}
              placeholder={question.editablePlaceholder}
              theme={theme}
              maxLength={question.maxCodeLength}
            />

            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={saveAnswer} disabled={busy}>
                {busy ? 'Checking…' : 'Save answer'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => { setCurrent((c) => Math.max(0, c - 1)); setLastVerdict(null); }}
                disabled={current === 0}
              >
                ← Previous
              </button>
              <button
                className="btn-secondary"
                onClick={() => { setCurrent((c) => Math.min(questions.length - 1, c + 1)); setLastVerdict(null); }}
                disabled={current === questions.length - 1}
              >
                Next →
              </button>
              {answers[question.id] && (
                <span className="ml-auto font-mono text-sm text-slate-500">
                  {answers[question.id].score}/{answers[question.id].points} points
                </span>
              )}
            </div>

            {lastVerdict && (
              <div className="card flex items-center gap-3 p-3">
                <VerdictBadge verdict={lastVerdict.verdict} />
                <span className="text-sm">{lastVerdict.feedback}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
