import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorNote, Spinner, Stat, formatDate, formatDuration } from '../../components/ui';
import { api, type HealthRecord, type HealthStatus, type SweepSummary } from '../../lib/api';

/**
 * Question health.
 *
 * Every question's own reference solution, re-run through the real engine. A
 * question whose solution fails is unanswerable by anyone — and to a student
 * it looks no different from a hard one, so nothing surfaces it on its own.
 * Worth running after any change to the engine, an adapter or the sandbox.
 */

const STATUS: Record<HealthStatus, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  failing: { label: 'Failing', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  unverifiable: { label: 'No solution', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
};

export function AdminHealth() {
  const [summary, setSummary] = useState<{ healthy: number; failing: number; unverifiable: number; unchecked: number } | null>(null);
  const [items, setItems] = useState<HealthRecord[]>([]);
  const [filter, setFilter] = useState<HealthStatus | ''>('');
  const [sweeping, setSweeping] = useState(false);
  const [lastSweep, setLastSweep] = useState<SweepSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ summary: typeof summary; items: HealthRecord[] }>(
      `/admin/questions-health${filter ? `?status=${filter}` : ''}`,
    )
      .then((res) => { setSummary(res.summary); setItems(res.items); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  const runSweep = async () => {
    setSweeping(true);
    setError(null);
    try {
      const result = await api.post<SweepSummary>('/admin/questions-health/sweep', {});
      setLastSweep(result);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSweeping(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Question health</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Each question's own reference solution, run through the real engine. A failing question
            cannot be answered correctly by anybody.
          </p>
        </div>
        <button className="btn-primary" onClick={runSweep} disabled={sweeping}>
          {sweeping ? 'Checking every question…' : 'Run sweep'}
        </button>
      </div>

      {error && <ErrorNote message={error} />}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Healthy" value={summary.healthy} hint="reference solution passes" />
          <Stat label="Failing" value={summary.failing} hint="unanswerable as written" />
          <Stat label="No solution" value={summary.unverifiable} hint="nothing to verify against" />
          <Stat label="Never checked" value={summary.unchecked} hint="run a sweep" />
        </div>
      )}

      {lastSweep && (
        <div className="card p-4">
          <p className="label">Last sweep</p>
          <p className="text-sm">
            Checked {lastSweep.checked} question{lastSweep.checked === 1 ? '' : 's'} in{' '}
            {formatDuration(lastSweep.durationMs)} — {lastSweep.healthy} healthy, {lastSweep.failing} failing,{' '}
            {lastSweep.unverifiable} without a solution.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {([['', 'All'], ['failing', 'Failing'], ['unverifiable', 'No solution'], ['healthy', 'Healthy']] as const).map(
          ([value, label]) => (
            <button
              key={label}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === value ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-850'}`}
              onClick={() => setFilter(value as HealthStatus | '')}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {loading ? (
        <div className="card p-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          message="Run a sweep to check every published question's reference solution."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Question</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Detail</th>
                <th className="px-3 py-2.5">Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
              {items.map((row) => (
                <tr key={row.questionId}>
                  <td className="px-3 py-2">
                    <Link className="font-medium hover:underline" to={`/admin/questions/${row.questionId}`}>
                      {row.title}
                    </Link>
                    <div className="font-mono text-[11px] text-slate-400">{row.qid}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`chip ${STATUS[row.status].className}`}>{STATUS[row.status].label}</span>
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{row.message}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {formatDate(row.checkedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
