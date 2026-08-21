import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DifficultyBadge, EmptyState, ErrorNote, Spinner } from '../components/ui';
import { api, type CatalogLanguage, type QuestionListItem } from '../lib/api';

/** §28 — topic sidebar on the left, question list on the right. */
export function PracticeBrowser() {
  const [params, setParams] = useSearchParams();
  const [catalog, setCatalog] = useState<CatalogLanguage[] | null>(null);
  const [questions, setQuestions] = useState<QuestionListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const language = params.get('language') ?? '';
  const topic = params.get('topic') ?? '';
  const subtopic = params.get('subtopic') ?? '';
  const difficulty = params.get('difficulty') ?? '';

  useEffect(() => {
    api.get<{ languages: CatalogLanguage[] }>('/practice/catalog')
      .then((res) => setCatalog(res.languages))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams();
    if (language) query.set('language', language);
    if (topic) query.set('topic', topic);
    if (subtopic) query.set('subtopic', subtopic);
    if (difficulty) query.set('difficulty', difficulty);
    if (params.get('search')) query.set('search', params.get('search')!);
    query.set('limit', '200');

    setQuestions(null);
    api.get<{ questions: QuestionListItem[]; total: number }>(`/practice/questions?${query}`)
      .then((res) => { setQuestions(res.questions); setTotal(res.total); })
      .catch((err) => setError(err.message));
  }, [language, topic, subtopic, difficulty, params]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === 'language') { next.delete('topic'); next.delete('subtopic'); }
    if (key === 'topic') next.delete('subtopic');
    setParams(next, { replace: true });
  };

  const activeLanguage = useMemo(
    () => catalog?.find((l) => l.slug === language) ?? null,
    [catalog, language],
  );

  const solvedCount = questions?.filter((q) => q.solved).length ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <div className="card p-3">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Languages</h2>
          {!catalog && <div className="p-2"><Spinner label="Loading catalog" /></div>}
          <div className="space-y-0.5">
            <button
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${!language ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'hover:bg-slate-100 dark:hover:bg-ink-850'}`}
              onClick={() => setFilter('language', '')}
            >
              <span>All languages</span>
              <span className="text-xs text-slate-400">
                {catalog?.reduce((sum, l) => sum + l.questionCount, 0) ?? ''}
              </span>
            </button>
            {catalog?.map((lang) => (
              <button
                key={lang.slug}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${language === lang.slug ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'hover:bg-slate-100 dark:hover:bg-ink-850'}`}
                onClick={() => setFilter('language', lang.slug)}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden>{lang.icon}</span>
                  {lang.name}
                </span>
                <span className="text-xs text-slate-400">{lang.questionCount}</span>
              </button>
            ))}
          </div>
        </div>

        {activeLanguage && (
          <div className="card p-3">
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Topics</h2>
            <div className="space-y-0.5">
              <button
                className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${!topic ? 'bg-slate-100 font-medium dark:bg-ink-850' : 'hover:bg-slate-100 dark:hover:bg-ink-850'}`}
                onClick={() => setFilter('topic', '')}
              >
                All topics
              </button>
              {activeLanguage.topics.map((t) => (
                <div key={t.slug}>
                  <button
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm ${topic === t.slug ? 'bg-slate-100 font-medium dark:bg-ink-850' : 'hover:bg-slate-100 dark:hover:bg-ink-850'}`}
                    onClick={() => setFilter('topic', topic === t.slug ? '' : t.slug)}
                  >
                    <span>{t.name}</span>
                    <span className="text-xs text-slate-400">{t.questionCount}</span>
                  </button>
                  {topic === t.slug && t.subtopics.length > 0 && (
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-ink-800">
                      {t.subtopics.filter((s) => s.questionCount > 0).map((s) => (
                        <button
                          key={s.slug}
                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs ${subtopic === s.slug ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
                          onClick={() => setFilter('subtopic', subtopic === s.slug ? '' : s.slug)}
                        >
                          <span>{s.name}</span>
                          <span>{s.questionCount}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card p-3">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Difficulty</h2>
          <div className="flex flex-wrap gap-1">
            {['', 'Easy', 'Medium', 'Hard'].map((level) => (
              <button
                key={level || 'all'}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${difficulty === level ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-850 dark:text-slate-300 dark:hover:bg-ink-800'}`}
                onClick={() => setFilter('difficulty', level)}
              >
                {level || 'Any'}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <form
            className="flex-1"
            onSubmit={(e) => { e.preventDefault(); setFilter('search', search); }}
          >
            <input
              className="input"
              placeholder="Search questions by title, statement or QID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {questions ? `${solvedCount} / ${total} solved` : ''}
          </div>
        </div>

        {error && <ErrorNote message={error} />}
        {!questions && !error && <div className="card p-6"><Spinner label="Loading questions" /></div>}

        {questions?.length === 0 && (
          <EmptyState
            title="No questions match these filters"
            message="Try a different topic or clear the difficulty filter."
          />
        )}

        <div className="space-y-2">
          {questions?.map((q) => (
            <Link
              key={q.id}
              to={`/practice/${q.qid}`}
              className="card flex items-start gap-3 p-3.5 transition-shadow hover:shadow-md"
            >
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${
                  q.solved
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : (q.attempts ?? 0) > 0
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-slate-200 text-slate-400 dark:bg-ink-800'
                }`}
                title={q.solved ? 'Solved' : (q.attempts ?? 0) > 0 ? 'Attempted' : 'Not attempted'}
              >
                {q.solved ? '✓' : (q.attempts ?? 0) > 0 ? '·' : ''}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-400">{q.qid}</span>
                  <span className="font-medium">{q.title}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{q.statement}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <DifficultyBadge difficulty={q.difficulty} />
                  <span className="chip bg-slate-100 text-slate-600 dark:bg-ink-850 dark:text-slate-300">
                    {q.languageName}
                  </span>
                  <span className="chip bg-slate-100 text-slate-600 dark:bg-ink-850 dark:text-slate-300">
                    {q.topicName}{q.subtopicName ? ` · ${q.subtopicName}` : ''}
                  </span>
                  <span className="chip bg-slate-100 text-slate-500 dark:bg-ink-850 dark:text-slate-400">
                    {q.questionType.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
