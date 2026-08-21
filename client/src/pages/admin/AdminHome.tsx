import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, Spinner, Stat } from '../../components/ui';
import { api } from '../../lib/api';

interface Overview {
  overview: Record<string, number>;
  weakConcepts: Array<{ label: string; accuracy: number; attempts: number }>;
  hardestQuestions: Array<{ qid: string; title: string; successRate: number; attempts: number }>;
  topStudents: Array<{ name: string; xp: number; solved: number }>;
}

export function AdminHome() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Overview>('/admin/analytics/overview').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <div className="card p-8"><Spinner /></div>;

  const o = data.overview;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Published questions" value={o.questions} hint={`${o.draftQuestions} drafts`} />
        <Stat label="Students" value={o.students} hint={`${o.activeStudentsToday} active today`} />
        <Stat label="Submissions" value={o.submissions} hint={`${o.submissionsToday} today`} />
        <Stat
          label="Success rate"
          value={`${o.submissions ? Math.round((o.correctSubmissions / o.submissions) * 100) : 0}%`}
          hint={`${o.correctSubmissions} correct`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link className="btn-primary" to="/admin/questions/new">+ New question</Link>
        <Link className="btn-secondary" to="/admin/questions">Manage questions</Link>
        <Link className="btn-secondary" to="/admin/import-export">Bulk import</Link>
        <Link className="btn-secondary" to="/admin/analytics">Full analytics</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <h2 className="mb-3 font-medium">Top weak concepts</h2>
          {data.weakConcepts.length === 0 ? (
            <p className="text-sm text-slate-500">No submissions yet.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {data.weakConcepts.slice(0, 6).map((c, i) => (
                <li key={c.label} className="flex items-center justify-between gap-2">
                  <span className="truncate">{i + 1}. {c.label}</span>
                  <span className="shrink-0 font-mono text-xs text-rose-500">{c.accuracy}%</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-medium">Hardest questions</h2>
          {data.hardestQuestions.length === 0 ? (
            <p className="text-sm text-slate-500">No submissions yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.hardestQuestions.slice(0, 6).map((q) => (
                <li key={q.qid} className="flex items-center justify-between gap-2">
                  <span className="truncate">{q.title}</span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{q.successRate}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-medium">Top students</h2>
          <ol className="space-y-2 text-sm">
            {data.topStudents.slice(0, 6).map((s, i) => (
              <li key={s.name} className="flex items-center justify-between gap-2">
                <span className="truncate">{i + 1}. {s.name}</span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{s.xp} XP</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
