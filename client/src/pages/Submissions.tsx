import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CodeBlock, ErrorNote, Spinner, VerdictBadge, formatDate, formatDuration } from '../components/ui';
import { api, type EvaluationResult, type SubmissionListItem } from '../lib/api';

/** §22 — submission history with the full stored evaluation trace. */
export function Submissions() {
  const [items, setItems] = useState<SubmissionListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ fragment: string; generatedCode: string; result: EvaluationResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ submissions: SubmissionListItem[]; total: number }>('/practice/submissions?limit=100')
      .then((res) => { setItems(res.submissions); setTotal(res.total); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (selected === null) { setDetail(null); return; }
    api.get<{ submission: { fragment: string; generatedCode: string; result: EvaluationResult } }>(`/practice/submissions/${selected}`)
      .then((res) => setDetail(res.submission))
      .catch((err) => setError(err.message));
  }, [selected]);

  if (error) return <ErrorNote message={error} />;
  if (!items) return <div className="card p-8"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Submission history</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{total} submissions recorded.</p>
      </div>

      {items.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-500">
          Nothing yet. <Link className="link" to="/practice">Start practising</Link>.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_460px]">
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
              <tr>
                <th className="px-4 py-2.5">Question</th>
                <th className="px-4 py-2.5">Verdict</th>
                <th className="px-4 py-2.5 text-right">Score</th>
                <th className="hidden px-4 py-2.5 text-right md:table-cell">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
              {items.map((s) => (
                <tr
                  key={s.id}
                  className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-ink-850 ${selected === s.id ? 'bg-slate-100 dark:bg-ink-850' : ''}`}
                  onClick={() => setSelected(s.id)}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{s.title}</p>
                    <p className="font-mono text-[11px] text-slate-400">
                      {s.qid} · attempt {s.attemptNumber}{s.hintsUsed > 0 ? ` · ${s.hintsUsed} hints` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-2.5"><VerdictBadge verdict={s.verdict} /></td>
                  <td className="px-4 py-2.5 text-right font-mono">{s.score}</td>
                  <td className="hidden px-4 py-2.5 text-right text-xs text-slate-500 md:table-cell">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          {!detail ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Select a submission to inspect it.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <VerdictBadge verdict={detail.result.verdict} />
                <span className="ml-auto font-mono text-xs text-slate-500">
                  {formatDuration(detail.result.executionMs)}
                </span>
              </div>
              <p className="text-sm">{detail.result.feedback}</p>
              <div><p className="label">Your fragment</p><CodeBlock code={detail.fragment} /></div>
              <div><p className="label">Generated program</p><CodeBlock code={detail.generatedCode} /></div>
              {detail.result.stdout && <div><p className="label">Output</p><CodeBlock code={detail.result.stdout} /></div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
