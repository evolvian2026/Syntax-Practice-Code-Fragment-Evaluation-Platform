import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorNote, ProgressBar, Spinner } from '../components/ui';
import { api, type PathNode } from '../lib/api';

interface LearningPathResponse {
  path: {
    slug: string;
    name: string;
    description: string | null;
    language: string;
    languageName: string;
    nodes: PathNode[];
    overallCompletion: number;
  } | null;
}

/** §18 — the structured progression, with topics unlocking as you improve. */
export function LearningPathPage() {
  const [language, setLanguage] = useState('python');
  const [paths, setPaths] = useState<Array<{ slug: string; name: string; language: string; languageName: string }>>([]);
  const [data, setData] = useState<LearningPathResponse['path'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ paths: Array<{ slug: string; name: string; language: string; language_name: string }> }>('/progress/learning-paths')
      .then((res) => setPaths(res.paths.map((p) => ({ ...p, languageName: p.language_name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get<LearningPathResponse>(`/progress/learning-path?language=${language}`)
      .then((res) => setData(res.path))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [language]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Learning path</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Advanced topics unlock as your accuracy on the earlier ones improves.
          </p>
        </div>
        <div className="flex gap-1">
          {paths.map((p) => (
            <button
              key={p.slug}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                language === p.language
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-850 dark:text-slate-300 dark:hover:bg-ink-800'
              }`}
              onClick={() => setLanguage(p.language)}
            >
              {p.languageName}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {loading && <div className="card p-8"><Spinner label="Loading path" /></div>}

      {!loading && !data && (
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No learning path has been published for this language yet.
        </div>
      )}

      {data && (
        <>
          <div className="card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-medium">{data.name}</h2>
              <span className="font-mono text-sm text-slate-500 dark:text-slate-400">{data.overallCompletion}% complete</span>
            </div>
            {data.description && <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{data.description}</p>}
            <ProgressBar value={data.overallCompletion} tone="emerald" />
          </div>

          <ol className="relative space-y-3 border-l-2 border-slate-200 pl-6 dark:border-ink-800">
            {data.nodes.map((node, i) => (
              <NodeCard key={node.id} node={node} index={i + 1} language={data.language} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function NodeCard({ node, index, language }: { node: PathNode; index: number; language: string }) {
  const done = node.questionCount > 0 && node.solvedCount >= node.questionCount;
  return (
    <li className="relative">
      <span
        className={`absolute -left-[33px] top-4 grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-semibold ${
          done
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : node.unlocked
              ? 'border-brand-500 bg-white text-brand-600 dark:bg-ink-950'
              : 'border-slate-300 bg-slate-100 text-slate-400 dark:border-ink-700 dark:bg-ink-900'
        }`}
      >
        {done ? '✓' : node.unlocked ? index : '🔒'}
      </span>

      <div className={`card p-4 ${node.unlocked ? '' : 'opacity-60'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{node.title}</h3>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            {node.solvedCount}/{node.questionCount} solved
            {node.attemptedCount > 0 && ` · ${node.accuracy}% accuracy`}
          </span>
        </div>

        {node.questionCount > 0 && <ProgressBar className="mt-2" value={node.completion} tone={done ? 'emerald' : 'brand'} />}

        {!node.unlocked && node.lockedReason && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{node.lockedReason}</p>
        )}

        {node.unlocked && node.topic && (
          <Link
            className="link mt-2 inline-block text-sm"
            to={`/practice?language=${language}&topic=${node.topic}${node.subtopic ? `&subtopic=${node.subtopic}` : ''}`}
          >
            Practise {node.title} →
          </Link>
        )}

        {node.children.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 dark:border-ink-800">
            {node.children.map((child) => (
              <div key={child.id} className="flex items-center gap-2 text-sm">
                <span className={child.solvedCount >= child.questionCount && child.questionCount > 0 ? 'text-emerald-500' : 'text-slate-400'}>
                  {child.solvedCount >= child.questionCount && child.questionCount > 0 ? '✓' : '○'}
                </span>
                {node.unlocked && child.topic ? (
                  <Link
                    className="flex-1 hover:underline"
                    to={`/practice?language=${language}&topic=${child.topic}${child.subtopic ? `&subtopic=${child.subtopic}` : ''}`}
                  >
                    {child.title}
                  </Link>
                ) : (
                  <span className="flex-1">{child.title}</span>
                )}
                <span className="font-mono text-xs text-slate-400">{child.solvedCount}/{child.questionCount}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
