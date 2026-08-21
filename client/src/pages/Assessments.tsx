import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorNote, Spinner, formatDate } from '../components/ui';
import { api, type AssessmentSummary } from '../lib/api';

/** §23 — assessment list with attempt state. */
export function Assessments() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  useEffect(() => {
    api.get<{ assessments: AssessmentSummary[] }>('/assessments')
      .then((res) => setItems(res.assessments))
      .catch((err) => setError(err.message));
  }, []);

  const start = async (assessment: AssessmentSummary) => {
    setStarting(assessment.id);
    setError(null);
    try {
      const res = await api.post<{ attempt: { id: number } }>(`/assessments/${assessment.id}/start`);
      navigate(`/assessments/${res.attempt.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(null);
    }
  };

  if (error && !items) return <ErrorNote message={error} />;
  if (!items) return <div className="card p-8"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Assessments</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Timed sets scored on correctness, the required syntax, time and hints used.
        </p>
      </div>

      {error && <ErrorNote message={error} />}

      {items.length === 0 && (
        <EmptyState
          title="No assessments published yet"
          message="Your teacher will publish assessments here. In the meantime, keep practising."
        />
      )}

      <div className="space-y-3">
        {items.map((assessment) => {
          const exhausted = assessment.attemptsUsed >= assessment.maxAttempts;
          const inProgress = assessment.myAttemptStatus === 'in_progress';
          return (
            <div key={assessment.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-medium">{assessment.title}</h2>
                {assessment.description && (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{assessment.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="chip bg-slate-100 dark:bg-ink-850">{assessment.questionCount} questions</span>
                  <span className="chip bg-slate-100 dark:bg-ink-850">{assessment.durationMinutes} min</span>
                  <span className="chip bg-slate-100 dark:bg-ink-850">{assessment.totalPoints} points</span>
                  {assessment.languageName && <span className="chip bg-slate-100 dark:bg-ink-850">{assessment.languageName}</span>}
                  {assessment.endsAt && <span>Closes {formatDate(assessment.endsAt)}</span>}
                </div>
              </div>

              <div className="text-right">
                {assessment.myBestScore !== null && (
                  <p className="mb-1 font-mono text-sm">
                    Best: {assessment.myBestScore}/{assessment.totalPoints}
                  </p>
                )}
                {inProgress ? (
                  <button className="btn-primary" onClick={() => navigate(`/assessments/${assessment.myAttemptId}`)}>
                    Resume
                  </button>
                ) : exhausted ? (
                  <button
                    className="btn-secondary"
                    onClick={() => navigate(`/assessments/${assessment.myAttemptId}`)}
                    disabled={!assessment.myAttemptId}
                  >
                    View result
                  </button>
                ) : (
                  <button className="btn-primary" onClick={() => start(assessment)} disabled={starting === assessment.id}>
                    {starting === assessment.id ? 'Starting…' : 'Start'}
                  </button>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  {assessment.attemptsUsed}/{assessment.maxAttempts} attempts used
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
