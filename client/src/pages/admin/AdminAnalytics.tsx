import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, ProgressBar, Spinner, Tabs, formatDuration } from '../../components/ui';
import { api } from '../../lib/api';

interface QuestionStat {
  questionId: number; qid: string; title: string; language: string; topic: string;
  difficulty: string; attempts: number; distinctStudents: number; solvedBy: number;
  successRate: number; avgAttempts: number; avgTimeMs: number; hintsUsed: number;
}

interface TopicStat { topic: string; language: string; label: string; attempts: number; accuracy: number }
interface CommonError { errorType: string; verdict: string; message: string; count: number }

/** §24 — admin analytics. */
export function AdminAnalytics() {
  const [tab, setTab] = useState<'questions' | 'topics' | 'errors'>('questions');
  const [order, setOrder] = useState<'hardest' | 'easiest' | 'most_attempted'>('hardest');
  const [questions, setQuestions] = useState<QuestionStat[] | null>(null);
  const [topics, setTopics] = useState<TopicStat[] | null>(null);
  const [errors, setErrors] = useState<CommonError[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ questions: QuestionStat[] }>(`/admin/analytics/questions?order=${order}&limit=50`)
      .then((r) => setQuestions(r.questions)).catch((e) => setError(e.message));
  }, [order]);

  useEffect(() => {
    api.get<{ topics: TopicStat[] }>('/admin/analytics/topics').then((r) => setTopics(r.topics)).catch(() => {});
    api.get<{ overview: unknown; commonErrors: CommonError[] }>('/admin/analytics/overview')
      .then((r) => setErrors(r.commonErrors)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <Tabs
        active={tab}
        onChange={(id) => setTab(id)}
        tabs={[
          { id: 'questions', label: 'Question stats' },
          { id: 'topics', label: 'Topic accuracy' },
          { id: 'errors', label: 'Common errors' },
        ]}
      />

      {tab === 'questions' && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(['hardest', 'easiest', 'most_attempted'] as const).map((o) => (
              <button
                key={o}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  order === o ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-ink-850 dark:text-slate-300'
                }`}
                onClick={() => setOrder(o)}
              >
                {o.replace('_', ' ')}
              </button>
            ))}
          </div>

          {!questions ? <div className="card p-8"><Spinner /></div> : questions.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              No submissions recorded yet — statistics appear once students start practising.
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
                  <tr>
                    <th className="px-3 py-2.5">Question</th>
                    <th className="px-3 py-2.5 text-right">Success</th>
                    <th className="px-3 py-2.5 text-right">Attempts</th>
                    <th className="px-3 py-2.5 text-right">Avg attempts</th>
                    <th className="hidden px-3 py-2.5 text-right lg:table-cell">Avg time</th>
                    <th className="hidden px-3 py-2.5 text-right lg:table-cell">Hints</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
                  {questions.map((q) => (
                    <tr key={q.questionId}>
                      <td className="px-3 py-2">
                        <Link className="font-medium hover:underline" to={`/admin/questions/${q.questionId}`}>{q.title}</Link>
                        <p className="font-mono text-[11px] text-slate-400">{q.qid} · {q.language}/{q.topic} · {q.difficulty}</p>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-mono">{q.successRate}%</span>
                        <ProgressBar
                          className="mt-1 w-20"
                          value={q.successRate}
                          tone={q.successRate >= 70 ? 'emerald' : q.successRate >= 40 ? 'amber' : 'rose'}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{q.attempts}</td>
                      <td className="px-3 py-2 text-right font-mono">{q.avgAttempts}</td>
                      <td className="hidden px-3 py-2 text-right font-mono lg:table-cell">{formatDuration(q.avgTimeMs)}</td>
                      <td className="hidden px-3 py-2 text-right font-mono lg:table-cell">{q.hintsUsed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'topics' && (
        <div className="card p-4">
          {!topics ? <Spinner /> : topics.length === 0 ? (
            <p className="text-sm text-slate-500">No data yet.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Weakest concepts across the cohort, lowest accuracy first.
              </p>
              {topics.map((t, i) => (
                <div key={`${t.language}-${t.topic}`}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm">{i + 1}. {t.label}</span>
                    <span className="font-mono text-xs text-slate-500">{t.accuracy}% · {t.attempts} attempts</span>
                  </div>
                  <ProgressBar value={t.accuracy} tone={t.accuracy >= 70 ? 'emerald' : t.accuracy >= 40 ? 'amber' : 'rose'} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'errors' && (
        <div className="card p-4">
          {!errors ? <Spinner /> : errors.length === 0 ? (
            <p className="text-sm text-slate-500">No failed submissions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-ink-800">
              {errors.map((e, i) => (
                <li key={i} className="flex items-start gap-3 py-2">
                  <span className="chip shrink-0 bg-slate-100 dark:bg-ink-850">{e.errorType}</span>
                  <span className="min-w-0 flex-1 text-sm">{e.message}</span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">×{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
