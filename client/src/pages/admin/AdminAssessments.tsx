import { useEffect, useId, useState } from 'react';
import { ErrorNote, Spinner, formatDate } from '../../components/ui';
import { api, type CatalogLanguage, type QuestionListItem } from '../../lib/api';

interface AssessmentRow {
  id: number;
  title: string;
  description: string | null;
  language: string | null;
  duration_minutes: number;
  max_attempts: number;
  status: string;
  question_count: number;
  submissions: number;
  created_at: string;
}

interface ResultRow {
  id: number; student: string; email: string; batch: string | null;
  status: string; score: number; max_score: number; correct_count: number;
  submitted_at: string | null;
}

/** §19 + §23 — create assessments and review their results. */
export function AdminAssessments() {
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [languages, setLanguages] = useState<CatalogLanguage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<{ id: number; rows: ResultRow[] } | null>(null);

  const load = () => {
    api.get<{ assessments: AssessmentRow[] }>('/admin/assessments')
      .then((res) => setRows(res.assessments))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
    api.get<{ languages: CatalogLanguage[] }>('/practice/catalog').then((r) => setLanguages(r.languages)).catch(() => {});
  }, []);

  const showResults = async (id: number) => {
    const res = await api.get<{ results: ResultRow[] }>(`/admin/assessments/${id}/results`);
    setResults({ id, rows: res.results });
  };

  const remove = async (row: AssessmentRow) => {
    if (!window.confirm(`Delete "${row.title}"? Student attempts will be deleted too.`)) return;
    await api.delete(`/admin/assessments/${row.id}`);
    load();
  };

  if (error && !rows) return <ErrorNote message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-medium">Assessments</h2>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}>+ New assessment</button>
      </div>

      {error && <ErrorNote message={error} />}

      {creating && (
        <AssessmentComposer
          languages={languages}
          onCancel={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}

      {!rows ? <div className="card p-8"><Spinner /></div> : rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          No assessments yet. Create one to give students a timed syntax test.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
              <tr>
                <th className="px-3 py-2.5">Title</th>
                <th className="px-3 py-2.5">Questions</th>
                <th className="px-3 py-2.5">Duration</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Submissions</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.title}</p>
                    <p className="text-xs text-slate-500">{formatDate(row.created_at)}</p>
                  </td>
                  <td className="px-3 py-2 font-mono">{row.question_count}</td>
                  <td className="px-3 py-2 font-mono">{row.duration_minutes} min</td>
                  <td className="px-3 py-2">
                    <span className={`chip ${row.status === 'published' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{row.submissions}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => showResults(row.id)}>Results</button>
                    <button className="btn-ghost !px-2 !py-1 text-xs text-rose-600 dark:text-rose-400" onClick={() => remove(row)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && (
        <div className="card p-4">
          <div className="mb-3 flex items-center">
            <h3 className="font-medium">Results</h3>
            <button className="btn-ghost ml-auto !py-1 text-xs" onClick={() => setResults(null)}>Close</button>
          </div>
          {results.rows.length === 0 ? (
            <p className="text-sm text-slate-500">No attempts yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Correct</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
                {results.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      {r.student}
                      {r.batch && <span className="ml-2 text-xs text-slate-400">{r.batch}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.status}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.score}/{r.max_score}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.correct_count}</td>
                    <td className="hidden px-3 py-2 text-right text-xs text-slate-500 sm:table-cell">
                      {r.submitted_at ? formatDate(r.submitted_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** Builds an assessment by picking questions from the bank. */
function AssessmentComposer({
  languages, onCancel, onCreated,
}: {
  languages: CatalogLanguage[];
  onCancel(): void;
  onCreated(): void;
}) {
  const [form, setForm] = useState({
    title: '', description: '', language: '', durationMinutes: 30,
    maxAttempts: 1, status: 'published', shuffle: false, allowHints: false,
  });
  const [pool, setPool] = useState<QuestionListItem[]>([]);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [filter, setFilter] = useState({ language: '', topic: '', search: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ status: 'published', limit: '200' });
    if (filter.language) query.set('language', filter.language);
    if (filter.topic) query.set('topic', filter.topic);
    if (filter.search) query.set('search', filter.search);
    api.get<{ items: QuestionListItem[] }>(`/admin/questions?${query}`)
      .then((res) => setPool(res.items))
      .catch(() => {});
  }, [filter]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/assessments', {
        ...form,
        language: form.language || null,
        questions: Object.entries(picked).map(([questionId, points]) => ({
          questionId: Number(questionId),
          points,
        })),
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const topics = languages.find((l) => l.slug === filter.language)?.topics ?? [];
  const fieldId = useId();
  const totalPoints = Object.values(picked).reduce((sum, p) => sum + p, 0);

  return (
    <div className="card space-y-4 p-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor={`${fieldId}-title`}>Title</label>
          <input id={`${fieldId}-title`} className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fieldId}-duration`}>Duration (minutes)</label>
          <input id={`${fieldId}-duration`} type="number" className="input" value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fieldId}-attempts`}>Max attempts</label>
          <input id={`${fieldId}-attempts`} type="number" className="input" value={form.maxAttempts}
            onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })} />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${fieldId}-description`}>Description</label>
          <input id={`${fieldId}-description`} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${fieldId}-status`}>Status</label>
          <select id={`${fieldId}-status`} className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.shuffle} onChange={(e) => setForm({ ...form, shuffle: e.target.checked })} />
          Shuffle question order
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.allowHints} onChange={(e) => setForm({ ...form, allowHints: e.target.checked })} />
          Allow hints during the test
        </label>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="label !mb-0">Questions ({Object.keys(picked).length} picked · {totalPoints} points)</p>
          <input className="input ml-auto max-w-[200px]" placeholder="Search…" value={filter.search}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
          <select className="input max-w-[150px]" value={filter.language}
            onChange={(e) => setFilter({ ...filter, language: e.target.value, topic: '' })}>
            <option value="">All languages</option>
            {languages.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
          </select>
          <select className="input max-w-[150px]" value={filter.topic}
            onChange={(e) => setFilter({ ...filter, topic: e.target.value })} disabled={topics.length === 0}>
            <option value="">All topics</option>
            {topics.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-ink-800">
          {pool.map((q) => {
            const selected = picked[q.id] !== undefined;
            return (
              <div key={q.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-ink-850">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    setPicked((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) next[q.id] = 10; else delete next[q.id];
                      return next;
                    });
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-mono text-[11px] text-slate-400">{q.qid}</span> {q.title}
                </span>
                <span className="text-xs text-slate-400">{q.difficulty}</span>
                {selected && (
                  <input
                    type="number"
                    className="input max-w-[70px] !py-1"
                    value={picked[q.id]}
                    onChange={(e) => setPicked((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="flex gap-2">
        <button className="btn-primary" onClick={create} disabled={busy || !form.title || Object.keys(picked).length === 0}>
          {busy ? 'Creating…' : 'Create assessment'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
