import { useEffect, useState } from 'react';
import { AccuracyBar, ErrorNote, Spinner, VerdictBadge, formatDate } from '../../components/ui';
import { api, type DashboardSummary, type SubmissionListItem } from '../../lib/api';

interface StudentRow {
  userId: number; name: string; email: string; batch: string | null;
  xp: number; level: number; solved: number; attempted: number; accuracy: number; streak: number;
}

/** §19 — student roster with drill-down into an individual's progress. */
export function AdminStudents() {
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ student: Record<string, unknown>; dashboard: DashboardSummary; recentSubmissions: SubmissionListItem[] } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get<{ students: StudentRow[] }>(`/admin/students${query}`)
      .then((res) => setRows(res.students))
      .catch((err) => setError(err.message));
  };

  useEffect(load, [search]);

  useEffect(() => {
    if (selected === null) { setDetail(null); return; }
    api.get<typeof detail>(`/admin/students/${selected}`).then(setDetail).catch((e) => setError(e.message));
  }, [selected]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn-primary ml-auto" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ Add student'}
        </button>
      </div>

      {error && <ErrorNote message={error} />}
      {creating && <CreateStudent onCreated={() => { setCreating(false); load(); }} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="card overflow-x-auto">
          {!rows ? <div className="p-8"><Spinner /></div> : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
                <tr>
                  <th className="px-3 py-2.5">Student</th>
                  <th className="px-3 py-2.5 text-right">Solved</th>
                  <th className="px-3 py-2.5 text-right">Accuracy</th>
                  <th className="px-3 py-2.5 text-right">XP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
                {rows.map((r) => (
                  <tr
                    key={r.userId}
                    onClick={() => setSelected(r.userId)}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-ink-850 ${selected === r.userId ? 'bg-slate-100 dark:bg-ink-850' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-slate-500">{r.email}{r.batch ? ` · ${r.batch}` : ''}</p>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.solved}/{r.attempted}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.accuracy}%</td>
                    <td className="px-3 py-2 text-right font-mono">{r.xp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-4">
          {!detail ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Select a student to see their progress.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium">{String(detail.student.name)}</h3>
                <p className="text-xs text-slate-500">{String(detail.student.email)}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-semibold">{detail.dashboard.solved}</p><p className="text-xs text-slate-500">solved</p></div>
                <div><p className="text-lg font-semibold">{detail.dashboard.accuracy}%</p><p className="text-xs text-slate-500">accuracy</p></div>
                <div><p className="text-lg font-semibold">{detail.dashboard.streakCurrent}</p><p className="text-xs text-slate-500">streak</p></div>
              </div>
              <div className="space-y-2">
                {detail.dashboard.byLanguage.filter((b) => b.attempted > 0).map((b) => (
                  <AccuracyBar key={b.key} label={b.label} value={b.accuracy} sub={`${b.solved}/${b.total}`} />
                ))}
              </div>
              <div>
                <p className="label">Recent attempts</p>
                <ul className="divide-y divide-slate-200 dark:divide-ink-800">
                  {detail.recentSubmissions.slice(0, 8).map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                      <VerdictBadge verdict={s.verdict} />
                    </li>
                  ))}
                </ul>
                {detail.recentSubmissions.length === 0 && <p className="text-sm text-slate-500">No submissions yet.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateStudent({ onCreated }: { onCreated(): void }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', batch: '', role: 'student' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/students', { ...form, batch: form.batch || null });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card grid gap-3 p-4 sm:grid-cols-5" onSubmit={submit}>
      <input className="input" placeholder="Full name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
      <input className="input" type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input className="input" type="password" placeholder="Password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <input className="input" placeholder="Batch" value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} />
      <div className="flex gap-2">
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="student">Student</option>
          <option value="teacher">Teacher</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn-primary" disabled={busy}>{busy ? '…' : 'Add'}</button>
      </div>
      {error && <div className="sm:col-span-5"><ErrorNote message={error} /></div>}
    </form>
  );
}
