import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AccuracyBar, ErrorNote, ProgressBar, Spinner, Stat, Tabs, VerdictBadge, formatDate, formatDuration,
} from '../components/ui';
import { api, type Badge, type DashboardSummary, type SubmissionListItem } from '../lib/api';

interface DashboardResponse {
  summary: DashboardSummary;
  recentSubmissions: SubmissionListItem[];
  badges: Badge[];
  nextLevelXp: number;
  currentLevelXp: number;
}

/** §17 — the student dashboard. */
export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [allBadges, setAllBadges] = useState<Badge[] | null>(null);
  const [recommendations, setRecommendations] = useState<Array<{ topic: string; reason: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'language' | 'topic' | 'difficulty'>('language');

  useEffect(() => {
    api.get<DashboardResponse>('/progress/dashboard').then(setData).catch((e) => setError(e.message));
    api.get<{ badges: Badge[] }>('/progress/badges').then((r) => setAllBadges(r.badges)).catch(() => {});
    api.get<{ recommendations: Array<{ topic: string; reason: string }> }>('/ai/recommendations')
      .then((r) => setRecommendations(r.recommendations))
      .catch(() => setRecommendations([]));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <div className="card p-8"><Spinner label="Loading your progress" /></div>;

  const { summary } = data;
  const levelProgress = data.nextLevelXp > data.currentLevelXp
    ? ((summary.xp - data.currentLevelXp) / (data.nextLevelXp - data.currentLevelXp)) * 100
    : 0;
  const breakdown = { language: summary.byLanguage, topic: summary.byTopic, difficulty: summary.byDifficulty }[tab];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your progress</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every attempt, construct error and hint is tracked so you can see exactly which syntax still needs work.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Solved" value={summary.solved} hint={`of ${summary.totalQuestions} questions`} />
        <Stat label="Accuracy" value={`${summary.accuracy}%`} hint={`${summary.attempted} attempted`} />
        <Stat label="Current streak" value={`🔥 ${summary.streakCurrent}`} hint={`best ${summary.streakBest} days`} />
        <Stat label="Time practising" value={formatDuration(summary.timeSpentMs)} hint={`${summary.submissions} submissions`} />
      </div>

      <div className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-medium">Level {summary.level}</h2>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            {summary.xp} / {data.nextLevelXp} XP
          </span>
        </div>
        <ProgressBar value={levelProgress} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="card p-4">
          <Tabs
            active={tab}
            onChange={(id) => setTab(id)}
            tabs={[
              { id: 'language', label: 'By language' },
              { id: 'topic', label: 'By topic' },
              { id: 'difficulty', label: 'By difficulty' },
            ]}
          />
          <div className="mt-4 space-y-3">
            {breakdown.filter((b) => b.total > 0).map((row) => (
              <AccuracyBar
                key={row.key}
                label={row.label}
                value={row.accuracy}
                sub={`${row.solved}/${row.total}`}
              />
            ))}
            {breakdown.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nothing here yet — solve a few questions first.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-3 font-medium">Error breakdown</h2>
            <dl className="space-y-2 text-sm">
              <ErrorRow label="Syntax errors" value={summary.errors.syntax} tone="rose" />
              <ErrorRow label="Runtime errors" value={summary.errors.runtime} tone="amber" />
              <ErrorRow label="Wrong construct" value={summary.errors.conceptual} tone="orange" />
              <ErrorRow label="Timeouts" value={summary.errors.timeout} tone="purple" />
              <ErrorRow label="Restricted code" value={summary.errors.restricted} tone="slate" />
              <ErrorRow label="Hints used" value={summary.hintsUsed} tone="slate" />
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 font-medium">Weak topics</h2>
            {summary.weakTopics.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Attempt a few more questions and your weakest topics will show up here.
              </p>
            ) : (
              <ul className="space-y-2">
                {summary.weakTopics.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{t.label}</span>
                    <span className="shrink-0 font-mono text-xs text-rose-500">{t.accuracy}%</span>
                  </li>
                ))}
              </ul>
            )}
            {recommendations && recommendations.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-3 dark:border-ink-800">
                <p className="label">Suggested next</p>
                <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  {recommendations.map((r) => (
                    <li key={r.topic}><strong>{r.topic}</strong> — {r.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Recent attempts</h2>
            <Link className="link text-sm" to="/submissions">View all</Link>
          </div>
          {data.recentSubmissions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No submissions yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-ink-800">
              {data.recentSubmissions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <Link to={`/practice/${s.qid}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium hover:underline">{s.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(s.createdAt)}</p>
                  </Link>
                  <VerdictBadge verdict={s.verdict} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-medium">Badges</h2>
          {!allBadges ? <Spinner /> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {allBadges.map((badge) => (
                <div
                  key={badge.slug}
                  title={badge.description}
                  className={`rounded-lg border p-3 text-center ${
                    badge.earned
                      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
                      : 'border-slate-200 opacity-50 dark:border-ink-800'
                  }`}
                >
                  <div className="text-2xl" aria-hidden>{badge.icon}</div>
                  <p className="mt-1 text-xs font-medium leading-tight">{badge.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-medium">Activity (last 30 days)</h2>
        <ActivityChart data={summary.recentActivity} />
      </div>
    </div>
  );
}

function ErrorRow({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    rose: 'text-rose-500', amber: 'text-amber-500', orange: 'text-orange-500',
    purple: 'text-purple-500', slate: 'text-slate-500',
  };
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
      <dd className={`font-mono font-medium ${tones[tone]}`}>{value}</dd>
    </div>
  );
}

function ActivityChart({ data }: { data: Array<{ day: string; attempts: number; solved: number }> }) {
  const days: Array<{ day: string; attempts: number; solved: number }> = [];
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const found = data.find((d) => d.day === date);
    days.push(found ?? { day: date, attempts: 0, solved: 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.attempts));

  return (
    <div className="flex h-24 items-end gap-1">
      {days.map((day) => (
        <div
          key={day.day}
          className="group relative flex-1"
          title={`${day.day}: ${day.attempts} attempts, ${day.solved} solved`}
        >
          <div
            className="w-full rounded-t bg-brand-500/30"
            style={{ height: `${(day.attempts / max) * 90 + 2}px` }}
          >
            <div
              className="w-full rounded-t bg-brand-500"
              style={{ height: `${day.attempts > 0 ? (day.solved / day.attempts) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
