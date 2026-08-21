import { type ReactNode } from 'react';

/** Small presentational building blocks shared across pages. */

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const styles: Record<string, string> = {
    Easy: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    Medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    Hard: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  };
  return <span className={`chip ${styles[difficulty] ?? 'bg-slate-500/15 text-slate-500'}`}>{difficulty}</span>;
}

const VERDICT_STYLES: Record<string, { label: string; className: string; icon: string }> = {
  CORRECT: { label: 'Correct', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', icon: '✅' },
  PARTIAL: { label: 'Partially correct', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', icon: '◐' },
  WRONG_OUTPUT: { label: 'Wrong output', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', icon: '✗' },
  WRONG_CONSTRUCT: { label: 'Wrong construct', className: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', icon: '⚠' },
  SYNTAX_ERROR: { label: 'Syntax error', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', icon: '⌇' },
  COMPILE_ERROR: { label: 'Compile error', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', icon: '⌇' },
  RUNTIME_ERROR: { label: 'Runtime error', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', icon: '💥' },
  TIMEOUT: { label: 'Timed out', className: 'bg-purple-500/15 text-purple-600 dark:text-purple-400', icon: '⏱' },
  RESTRICTED: { label: 'Restricted', className: 'bg-purple-500/15 text-purple-600 dark:text-purple-400', icon: '🚫' },
  EMPTY: { label: 'Nothing submitted', className: 'bg-slate-500/15 text-slate-500', icon: '∅' },
  ERROR: { label: 'Error', className: 'bg-slate-500/15 text-slate-500', icon: '!' },
};

export function VerdictBadge({ verdict }: { verdict: string }) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.ERROR;
  return (
    <span className={`chip ${style.className}`}>
      <span aria-hidden>{style.icon}</span>
      {style.label}
    </span>
  );
}

export function verdictLabel(verdict: string): string {
  return VERDICT_STYLES[verdict]?.label ?? verdict;
}

export function ProgressBar({
  value, max = 100, className = '', tone = 'brand',
}: { value: number; max?: number; className?: string; tone?: 'brand' | 'emerald' | 'amber' | 'rose' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tones = {
    brand: 'bg-brand-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-ink-800 ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${tones[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The §17 "Python ████████░░ 82%" bar. */
export function AccuracyBar({ label, value, sub }: { label: string; value: number; sub?: string }) {
  const tone = value >= 75 ? 'emerald' : value >= 50 ? 'amber' : 'rose';
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
          {sub ? `${sub} · ` : ''}{value}%
        </span>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500 dark:border-ink-700 dark:border-t-brand-400" />
      {label}…
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{message}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      {message}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs, active, onChange,
}: {
  // NoInfer keeps T pinned to the `active` state's union, so the tab ids are
  // checked against it rather than widening T to `string`.
  tabs: Array<{ id: NoInfer<T>; label: string; badge?: ReactNode }>;
  active: T;
  onChange(id: T): void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-ink-800" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            active === tab.id
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="ml-1.5 text-xs opacity-70">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  return <pre className={`code-block whitespace-pre-wrap ${className}`}>{code || '(no output)'}</pre>;
}

export function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-ink-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:bg-ink-850 dark:text-slate-400">
          <tr>
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
          {rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-3 py-4 text-center text-slate-500">
                0 rows
              </td>
            </tr>
          )}
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-ink-850/60">
              {row.map((cell, j) => (
                <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">
                  {cell === null || cell === undefined
                    ? <span className="text-slate-400 italic">NULL</span>
                    : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="px-3 py-1.5 text-xs text-slate-500">Showing the first 100 of {rows.length} rows.</p>
      )}
    </div>
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
