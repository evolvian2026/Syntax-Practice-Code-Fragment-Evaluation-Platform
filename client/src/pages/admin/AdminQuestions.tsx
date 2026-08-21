import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DifficultyBadge, ErrorNote, Spinner, formatDate } from '../../components/ui';
import { api, type CatalogLanguage, type QuestionListItem } from '../../lib/api';

/** §19 — question management: filter, verify, duplicate, delete. */
export function AdminQuestions() {
  const navigate = useNavigate();
  const [items, setItems] = useState<QuestionListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [languages, setLanguages] = useState<CatalogLanguage[]>([]);
  const [filters, setFilters] = useState({ language: '', topic: '', difficulty: '', status: '', search: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);

  useEffect(() => {
    api.get<{ languages: CatalogLanguage[] }>('/practice/catalog')
      .then((res) => setLanguages(res.languages))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    query.set('limit', '200');
    setItems(null);
    api.get<{ items: QuestionListItem[]; total: number }>(`/admin/questions?${query}`)
      .then((res) => { setItems(res.items); setTotal(res.total); })
      .catch((err) => setError(err.message));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const verify = async (id: number) => {
    setVerifying(id);
    setNotice(null);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/admin/questions/${id}/verify`);
      setNotice(`${res.ok ? '✓' : '✗'} ${res.message}`);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setVerifying(null);
    }
  };

  const duplicate = async (id: number) => {
    const res = await api.post<{ id: number }>(`/admin/questions/${id}/duplicate`);
    navigate(`/admin/questions/${res.id}`);
  };

  const remove = async (question: QuestionListItem) => {
    if (!window.confirm(`Delete ${question.qid} (${question.title})? This also deletes its submissions.`)) return;
    await api.delete(`/admin/questions/${question.id}`);
    load();
  };

  const topics = languages.find((l) => l.slug === filters.language)?.topics ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search title, statement or QID…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <select
          className="input max-w-[160px]"
          value={filters.language}
          onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value, topic: '' }))}
        >
          <option value="">All languages</option>
          {languages.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
        </select>
        <select
          className="input max-w-[160px]"
          value={filters.topic}
          onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))}
          disabled={topics.length === 0}
        >
          <option value="">All topics</option>
          {topics.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
        <select
          className="input max-w-[130px]"
          value={filters.difficulty}
          onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))}
        >
          <option value="">Any difficulty</option>
          <option>Easy</option><option>Medium</option><option>Hard</option>
        </select>
        <select
          className="input max-w-[130px]"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <Link className="btn-primary ml-auto" to="/admin/questions/new">+ New question</Link>
      </div>

      {error && <ErrorNote message={error} />}
      {notice && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-850">
          {notice}
        </div>
      )}

      {!items ? <div className="card p-8"><Spinner /></div> : (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">{total} questions</p>
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
                <tr>
                  <th className="px-3 py-2.5">QID</th>
                  <th className="px-3 py-2.5">Title</th>
                  <th className="px-3 py-2.5">Language / topic</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">Updated</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
                {items.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-ink-850/60">
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{q.qid}</td>
                    <td className="px-3 py-2">
                      <Link className="font-medium hover:underline" to={`/admin/questions/${q.id}`}>{q.title}</Link>
                      <div className="mt-1"><DifficultyBadge difficulty={q.difficulty} /></div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {q.languageName}<br />{q.topicName}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="chip bg-slate-100 dark:bg-ink-850">{q.questionType.replace(/_/g, ' ').toLowerCase()}</span>
                      <br />
                      <span className="text-[11px] text-slate-400">{q.evaluationType}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`chip ${
                        q.status === 'published' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : q.status === 'draft' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-slate-500/15 text-slate-500'
                      }`}>{q.status}</span>
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-slate-500 lg:table-cell">{formatDate(q.updatedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => verify(q.id)} disabled={verifying === q.id}>
                          {verifying === q.id ? '…' : 'Verify'}
                        </button>
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => duplicate(q.id)}>Duplicate</button>
                        <Link className="btn-ghost !px-2 !py-1 text-xs" to={`/practice/${q.qid}`}>Preview</Link>
                        <button className="btn-ghost !px-2 !py-1 text-xs text-rose-600 dark:text-rose-400" onClick={() => remove(q)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
