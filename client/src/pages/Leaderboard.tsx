import { useEffect, useState } from 'react';
import { ErrorNote, Spinner } from '../components/ui';
import { api } from '../lib/api';

interface Row {
  userId: number; name: string; batch: string | null; xp: number; level: number;
  solved: number; attempted: number; accuracy: number; streak: number;
  rank: number; isMe: boolean;
}

/** §27 — leaderboard. */
export function LeaderboardPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ leaderboard: Row[]; myRank: number | null }>('/progress/leaderboard?limit=50')
      .then((res) => { setRows(res.leaderboard); setMyRank(res.myRank); })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!rows) return <div className="card p-8"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ranked by XP. {myRank ? `You are #${myRank}.` : 'Solve a question to join the board.'}
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-ink-800">
            <tr>
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Student</th>
              <th className="px-4 py-2.5 text-right">XP</th>
              <th className="hidden px-4 py-2.5 text-right sm:table-cell">Level</th>
              <th className="px-4 py-2.5 text-right">Solved</th>
              <th className="hidden px-4 py-2.5 text-right sm:table-cell">Accuracy</th>
              <th className="hidden px-4 py-2.5 text-right sm:table-cell">Streak</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-ink-800">
            {rows.map((row) => (
              <tr key={row.userId} className={row.isMe ? 'bg-brand-50 dark:bg-brand-500/10' : ''}>
                <td className="px-4 py-2.5 font-mono">
                  {row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{row.name}</span>
                  {row.isMe && <span className="ml-2 chip bg-brand-500/15 text-brand-600 dark:text-brand-300">you</span>}
                  {row.batch && <span className="ml-2 text-xs text-slate-400">{row.batch}</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{row.xp}</td>
                <td className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">{row.level}</td>
                <td className="px-4 py-2.5 text-right font-mono">{row.solved}</td>
                <td className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">{row.accuracy}%</td>
                <td className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">{row.streak > 0 ? `🔥${row.streak}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
