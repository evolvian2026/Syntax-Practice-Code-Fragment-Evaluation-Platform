import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DifficultyBadge, EmptyState, ErrorNote, Spinner, Stat, Tabs, formatDate } from '../components/ui';
import {
  api,
  type CatalogLanguage,
  type ConstructGap,
  type ConstructMastery,
  type DueReview,
  type MasteryLevel,
  type ReviewSummary,
} from '../lib/api';

/**
 * Mastery and review.
 *
 * Topic percentages say where a student has *been*; this says what they can
 * actually write. The two halves work together: mastery names the constructs
 * that are weak, reviews bring back the ones at risk of being forgotten.
 */

const LEVELS: Record<MasteryLevel, { label: string; className: string; order: number }> = {
  proficient: { label: 'Proficient', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', order: 0 },
  developing: { label: 'Developing', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', order: 1 },
  attempted: { label: 'Not yet', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', order: 2 },
  unseen: { label: 'Unseen', className: 'bg-slate-500/15 text-slate-500 dark:text-slate-400', order: 3 },
};

export function MasteryPage() {
  const [tab, setTab] = useState<'constructs' | 'reviews'>('constructs');
  const [language, setLanguage] = useState('');
  const [languages, setLanguages] = useState<CatalogLanguage[]>([]);
  const [mastery, setMastery] = useState<ConstructMastery[]>([]);
  const [gaps, setGaps] = useState<ConstructGap[]>([]);
  const [reviews, setReviews] = useState<{ summary: ReviewSummary; due: DueReview[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ languages: CatalogLanguage[] }>('/practice/catalog')
      .then((res) => setLanguages(res.languages))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const query = language ? `?language=${language}` : '';
    Promise.all([
      api.get<{ mastery: ConstructMastery[]; gaps: ConstructGap[] }>(`/progress/mastery${query}`),
      api.get<{ summary: ReviewSummary; due: DueReview[] }>('/progress/reviews'),
    ])
      .then(([m, r]) => {
        setMastery(m.mastery);
        setGaps(m.gaps);
        setReviews(r);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [language]);

  const counts = useMemo(() => {
    const by = { proficient: 0, developing: 0, attempted: 0, unseen: 0 };
    for (const m of mastery) by[m.level] += 1;
    return by;
  }, [mastery]);

  const sorted = useMemo(
    () => [...mastery].sort((a, b) => LEVELS[a.level].order - LEVELS[b.level].order || b.attempts - a.attempts),
    [mastery],
  );

  if (loading) return <div className="card p-8"><Spinner /></div>;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Mastery</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every construct you have written, and how reliably you get it right.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${language === '' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-850'}`}
            onClick={() => setLanguage('')}
          >
            All languages
          </button>
          {languages.map((l) => (
            <button
              key={l.slug}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${language === l.slug ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-850'}`}
              onClick={() => setLanguage(l.slug)}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Proficient" value={counts.proficient} hint="3+ correct uses" />
        <Stat label="Developing" value={counts.developing} hint="written correctly at least once" />
        <Stat label="Not yet" value={counts.attempted} hint="tried, never correct" />
        <Stat label="Due for review" value={reviews?.summary.dueNow ?? 0} hint={`${reviews?.summary.scheduled ?? 0} scheduled`} />
      </div>

      <Tabs
        tabs={[
          { id: 'constructs' as const, label: `Constructs (${mastery.length})` },
          { id: 'reviews' as const, label: `Review queue (${reviews?.summary.dueNow ?? 0})` },
        ]}
        active={tab}
        onChange={(id) => setTab(id)}
      />

      {tab === 'constructs' && (
        <div className="space-y-5">
          {gaps.length > 0 && (
            <div className="card p-4">
              <h2 className="mb-1 font-medium">Not written correctly yet</h2>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Constructs this platform teaches that you have not yet got right. Tried-and-missed
                comes first — you are already working on those.
              </p>
              <div className="space-y-1.5">
                {gaps.map((gap) => (
                  <div
                    key={gap.construct}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-800"
                  >
                    <span className="font-medium">{gap.label}</span>
                    <span className="font-mono text-[11px] text-slate-400">{gap.construct}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {gap.attempts > 0
                        ? `${gap.attempts} attempt${gap.attempts === 1 ? '' : 's'}, none correct`
                        : 'not attempted'}
                      {' · '}
                      {gap.questionsAvailable} question{gap.questionsAvailable === 1 ? '' : 's'}
                    </span>
                    {gap.nextQuestion && (
                      <Link className="btn-secondary ml-auto !py-1 text-xs" to={`/practice/${gap.nextQuestion.qid}`}>
                        Practise it
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {sorted.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              message="Submit an answer and the constructs you used will appear here."
              action={<Link className="btn-primary" to="/practice">Start practising</Link>}
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Construct</th>
                    <th className="px-3 py-2.5 text-right">Used</th>
                    <th className="px-3 py-2.5 text-right">Correct</th>
                    <th className="px-3 py-2.5 text-right">Accuracy</th>
                    <th className="px-3 py-2.5 text-right">Questions</th>
                    <th className="px-3 py-2.5">Last used</th>
                    <th className="px-3 py-2.5">Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
                  {sorted.map((m) => (
                    <tr key={m.construct}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{m.label}</div>
                        <div className="font-mono text-[11px] text-slate-400">{m.construct}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{m.attempts}</td>
                      <td className="px-3 py-2 text-right font-mono">{m.correct}</td>
                      <td className="px-3 py-2 text-right font-mono">{Math.round(m.accuracy * 100)}%</td>
                      <td className="px-3 py-2 text-right font-mono">{m.distinctQuestions}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {m.lastUsedAt ? formatDate(m.lastUsedAt) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`chip ${LEVELS[m.level].className}`}>{LEVELS[m.level].label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'reviews' && reviews && (
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-1 font-medium">Why reviews</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Solving a question once and never seeing it again is how you end up recognising a
              construct without being able to write it. A question you solve comes back after a day,
              then six, then at a widening interval as you keep getting it right — and drops back to
              a day whenever you do not.
            </p>
          </div>

          {reviews.due.length === 0 ? (
            <EmptyState
              title="Nothing due"
              message={
                reviews.summary.scheduled > 0
                  ? `${reviews.summary.scheduled} question${reviews.summary.scheduled === 1 ? '' : 's'} scheduled. Come back when one falls due.`
                  : 'Solve a question and it will be scheduled for review.'
              }
              action={<Link className="btn-primary" to="/practice">Practise something new</Link>}
            />
          ) : (
            <div className="space-y-1.5">
              {reviews.due.map((r) => (
                <Link
                  key={r.questionId}
                  to={`/practice/${r.qid}`}
                  className="card flex flex-wrap items-center gap-3 p-3 transition-shadow hover:shadow-md"
                >
                  <span className="font-mono text-[11px] text-slate-400">{r.qid}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                  <DifficultyBadge difficulty={r.difficulty} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {r.overdueDays > 0 ? `${r.overdueDays}d overdue` : 'due today'}
                    {r.lapses > 0 && ` · ${r.lapses} lapse${r.lapses === 1 ? '' : 's'}`}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {reviews.summary.upcoming.length > 0 && (
            <div className="card p-4">
              <p className="label">Coming up</p>
              <div className="flex flex-wrap gap-2">
                {reviews.summary.upcoming.map((u) => (
                  <span key={u.date} className="chip bg-slate-500/10 text-slate-600 dark:text-slate-300">
                    {u.date} · {u.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
