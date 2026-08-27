import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FragmentEditor } from '../components/FragmentEditor';
import {
  CodeBlock, DifficultyBadge, ErrorNote, ResultTable, Spinner, Tabs, VerdictBadge, formatDuration,
} from '../components/ui';
import { api, type AttemptResponse, type EvaluationResult, type StudentQuestion } from '../lib/api';
import { useAuth } from '../lib/auth';

type PanelTab = 'output' | 'tests' | 'hints' | 'explanation' | 'generated' | 'schema';

/**
 * §1 + §10 + §16 — the practice workspace.
 *
 * Left: the question, its requirements and the schema/dataset when relevant.
 * Right: the fragment editor plus the results panel (output, tests, hints,
 * explanation, generated program).
 */
export function PracticeWorkspace({ theme }: { theme: 'dark' | 'light' }) {
  const { qid } = useParams<{ qid: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [question, setQuestion] = useState<StudentQuestion | null>(null);
  const [code, setCode] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [attempt, setAttempt] = useState<AttemptResponse | null>(null);
  const [tab, setTab] = useState<PanelTab>('output');
  const [hints, setHints] = useState<Array<{ index: number; body: string | null; unlocked: boolean; penalty: number }>>([]);
  const [solution, setSolution] = useState<{ solutions: Array<{ code: string; note: string | null }>; explanation: string | null } | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const startedAt = useRef(Date.now());

  // ---------------------------------------------------------- data load
  useEffect(() => {
    setQuestion(null);
    setAttempt(null);
    setSolution(null);
    setAiHint(null);
    setTab('output');
    startedAt.current = Date.now();

    api.get<{ question: StudentQuestion }>(`/practice/questions/${qid}`)
      .then(({ question: q }) => {
        setQuestion(q);
        setCode(q.lastFragment ?? q.editablePrefill ?? '');
        return api.get<{ hints: typeof hints }>(`/practice/questions/${q.id}/hints`);
      })
      .then((res) => setHints(res.hints))
      .catch((err) => setLoadError(err.message));
  }, [qid]);

  // ------------------------------------------------------------- actions
  const runAttempt = useCallback(async (mode: 'run' | 'submit') => {
    if (!question || busy) return;
    setBusy(mode);
    setAiHint(null);
    try {
      const res = await api.post<AttemptResponse>(`/practice/questions/${question.id}/${mode}`, {
        code,
        timeSpentMs: Date.now() - startedAt.current,
        selectedOption,
      });
      setAttempt(res);
      setTab(res.result.tests.length > 0 && !res.result.isCorrect ? 'tests' : 'output');
      if (mode === 'submit') {
        void refresh();
        // Refresh the solved marker without losing the editor contents.
        api.get<{ question: StudentQuestion }>(`/practice/questions/${question.id}`)
          .then(({ question: q }) => setQuestion((prev) => (prev ? { ...q, lastFragment: prev.lastFragment } : q)))
          .catch(() => { /* non-critical */ });
      }
    } catch (err) {
      setAttempt({
        result: {
          verdict: 'ERROR', isCorrect: false, score: 0, maxScore: question.maxScore,
          errorType: 'internal', errorMessage: (err as Error).message,
          feedback: (err as Error).message, stages: [], tests: [], testsPassed: 0, testsFailed: 0,
          generatedCode: '', stdout: '', stderr: '', executionMs: 0, memoryKb: 0,
          detectedConstructs: [], missingConstructs: [], usedForbiddenConstructs: [], resultSet: null,
        },
        submissionId: null, attemptNumber: 0, award: null, explanation: null, solutions: [],
        misconception: null, reviewDueAt: null,
      });
    } finally {
      setBusy(null);
    }
  }, [question, code, busy, selectedOption, refresh]);

  const revealHint = async (index: number) => {
    if (!question) return;
    const res = await api.post<{ hint: { index: number; body: string; penalty: number } }>(
      `/practice/questions/${question.id}/hint`,
      { index },
    );
    setHints((prev) => prev.map((h) => (h.index === index ? { ...h, body: res.hint.body, unlocked: true } : h)));
    setTab('hints');
  };

  const askAi = async () => {
    if (!question) return;
    setAiBusy(true);
    try {
      const level = Math.min(3, hints.filter((h) => h.unlocked).length + 1) as 1 | 2 | 3;
      const res = await api.post<{ hint: string }>('/ai/tutor', {
        questionId: question.id,
        code,
        level,
        submissionId: attempt?.submissionId ?? undefined,
      });
      setAiHint(res.hint);
      setTab('hints');
    } catch (err) {
      setAiHint((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const revealSolution = async () => {
    if (!question) return;
    if (!window.confirm('Revealing the solution scores this question 0. Continue?')) return;
    const res = await api.post<{ solutions: Array<{ code: string; note: string | null }>; explanation: string | null }>(
      `/practice/questions/${question.id}/solution`,
    );
    setSolution(res);
    setTab('explanation');
  };

  const goNext = async () => {
    if (!question) return;
    const res = await api.get<{ next: { qid: string } | null }>(`/practice/questions/${question.id}/next`);
    if (res.next) navigate(`/practice/${res.next.qid}`);
    else navigate('/practice');
  };

  // ------------------------------------------------------------ render
  if (loadError) return <ErrorNote message={loadError} />;
  if (!question) return <div className="card p-8"><Spinner label="Loading question" /></div>;

  const result = attempt?.result ?? null;
  const isTextAnswer = question.evaluationType === 'TEXT';

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
      {/* ------------------------------------------------ question panel */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-slate-400">{question.qid}</span>
            <DifficultyBadge difficulty={question.difficulty} />
            {question.progress?.solved && (
              <span className="chip bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Solved</span>
            )}
          </div>
          <h1 className="text-lg font-semibold">{question.title}</h1>
          <nav className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <Link className="hover:underline" to={`/practice?language=${question.language}`}>{question.languageName}</Link>
            {' › '}
            <Link className="hover:underline" to={`/practice?language=${question.language}&topic=${question.topic}`}>
              {question.topicName}
            </Link>
            {question.subtopicName && ` › ${question.subtopicName}`}
          </nav>

          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{question.statement}</p>

          {question.instructions && (
            <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-ink-850 dark:text-slate-300">
              {question.instructions}
            </p>
          )}

          {question.requiredConstructLabels.length > 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Must use:</span> {question.requiredConstructLabels.join(', ')}
            </p>
          )}

          {question.options.length > 0 && (
            <div className="mt-4">
              <p className="label">Choose the construct</p>
              <div className="flex flex-wrap gap-2">
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedOption(option)}
                    className={`rounded-lg border px-3 py-1.5 font-mono text-xs ${
                      selectedOption === option
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'border-slate-300 hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-850'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-ink-800 dark:text-slate-400">
            <div><dt className="inline font-medium">Time limit:</dt> <dd className="inline">{question.timeLimitMs} ms</dd></div>
            <div><dt className="inline font-medium">Memory:</dt> <dd className="inline">{question.memoryLimitMb} MB</dd></div>
            <div><dt className="inline font-medium">Tests:</dt> <dd className="inline">{question.publicTests.length} public, {question.hiddenTestCount} hidden</dd></div>
            <div><dt className="inline font-medium">Attempts:</dt> <dd className="inline">{question.progress?.attempts ?? 0}</dd></div>
          </dl>
        </div>

        {question.dataset && <SchemaCard dataset={question.dataset} />}
      </div>

      {/* -------------------------------------------------- editor panel */}
      <div className="min-w-0 space-y-4">
        {isTextAnswer ? (
          <div className="card p-4">
            <p className="label">Your answer</p>
            <textarea
              className="input min-h-[140px] font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={question.editablePlaceholder ?? 'Type the expected output'}
            />
          </div>
        ) : (
          <FragmentEditor
            language={question.monacoId}
            contextBefore={question.contextBefore}
            contextAfter={question.contextAfter}
            value={code}
            onChange={setCode}
            onRun={() => runAttempt('run')}
            onSubmit={() => runAttempt('submit')}
            placeholder={question.editablePlaceholder}
            theme={theme}
            maxLength={question.maxCodeLength}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary" onClick={() => runAttempt('run')} disabled={busy !== null}>
            {busy === 'run' ? 'Running…' : '▶ Run'}
          </button>
          <button className="btn-primary" onClick={() => runAttempt('submit')} disabled={busy !== null}>
            {busy === 'submit' ? 'Checking…' : '✓ Submit'}
          </button>
          <button
            className="btn-ghost"
            onClick={() => setCode(question.editablePrefill ?? '')}
            disabled={busy !== null}
          >
            ↺ Reset
          </button>
          <button
            className="btn-ghost"
            onClick={() => revealHint(hints.findIndex((h) => !h.unlocked))}
            disabled={busy !== null || hints.every((h) => h.unlocked) || hints.length === 0}
          >
            💡 Hint ({hints.filter((h) => !h.unlocked).length} left)
          </button>
          <button className="btn-ghost" onClick={askAi} disabled={aiBusy}>
            {aiBusy ? 'Thinking…' : '🤖 Ask tutor'}
          </button>
          <button className="btn-ghost text-rose-600 dark:text-rose-400" onClick={revealSolution} disabled={busy !== null}>
            Show solution
          </button>
          {result?.isCorrect && (
            <button className="btn-success ml-auto" onClick={goNext}>Next question →</button>
          )}
        </div>

        {result && (
          <ResultBanner
            result={result}
            award={attempt?.award ?? null}
            misconception={attempt?.misconception ?? null}
            reviewDueAt={attempt?.reviewDueAt ?? null}
          />
        )}

        <div className="card">
          <div className="px-3 pt-1">
            <Tabs
              active={tab}
              onChange={(id) => setTab(id)}
              tabs={[
                { id: 'output', label: 'Output' },
                { id: 'tests', label: 'Test cases', badge: result ? `${result.testsPassed}/${result.testsPassed + result.testsFailed}` : question.publicTests.length },
                { id: 'hints', label: 'Hints', badge: hints.filter((h) => h.unlocked).length || undefined },
                { id: 'explanation', label: 'Explanation' },
                { id: 'generated', label: 'Generated code' },
              ]}
            />
          </div>
          <div className="p-4">
            {tab === 'output' && <OutputPanel result={result} question={question} />}
            {tab === 'tests' && <TestsPanel result={result} question={question} />}
            {tab === 'hints' && <HintsPanel hints={hints} aiHint={aiHint} onReveal={revealHint} />}
            {tab === 'explanation' && (
              <ExplanationPanel
                explanation={attempt?.explanation ?? solution?.explanation ?? null}
                solutions={attempt?.solutions ?? solution?.solutions ?? []}
                answered={Boolean(result?.isCorrect || solution)}
                yourCode={code}
              />
            )}
            {tab === 'generated' && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This is the complete program the platform built from your fragment and ran in the sandbox.
                </p>
                <CodeBlock code={result?.generatedCode ?? 'Run your code to see the generated program.'} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- panels

function ResultBanner({ result, award, misconception, reviewDueAt }: {
  result: EvaluationResult;
  award: AttemptResponse['award'];
  misconception?: AttemptResponse['misconception'];
  reviewDueAt?: string | null;
}) {
  const tone = result.isCorrect
    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
    : result.verdict === 'WRONG_CONSTRUCT'
      ? 'border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40'
      : 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30';

  return (
    <div className={`animate-fade-in rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-3">
        <VerdictBadge verdict={result.verdict} />
        <span className="text-sm font-medium">{result.feedback}</span>
        <span className="ml-auto font-mono text-xs text-slate-500 dark:text-slate-400">
          {result.score}/{result.maxScore} pts · {formatDuration(result.executionMs)}
        </span>
      </div>

      {misconception && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {misconception.label}
          </p>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">{misconception.hint}</p>
        </div>
      )}

      {result.isCorrect && reviewDueAt && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Scheduled for review on {reviewDueAt.slice(0, 10)} — so you get the chance to write it
          again before you forget it.
        </p>
      )}

      {result.stages.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-2">
          {result.stages.map((stage) => (
            <li
              key={stage.stage}
              className={`chip ${stage.passed ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'}`}
              title={stage.message}
            >
              {stage.passed ? '✓' : '✗'} {stage.title}
            </li>
          ))}
        </ol>
      )}

      {award && (award.xpEarned > 0 || award.newBadges.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-emerald-200 pt-3 text-sm dark:border-emerald-900">
          {award.xpEarned > 0 && <span className="chip animate-pop bg-brand-500/15 text-brand-700 dark:text-brand-300">+{award.xpEarned} XP</span>}
          {award.streakExtended && <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-400">🔥 {award.streak} day streak</span>}
          {award.leveledUp && <span className="chip animate-pop bg-violet-500/15 text-violet-700 dark:text-violet-300">Level {award.level}!</span>}
          {award.newBadges.map((badge) => (
            <span key={badge.slug} className="chip animate-pop bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" title={badge.description}>
              {badge.icon} {badge.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputPanel({ result, question }: { result: EvaluationResult | null; question: StudentQuestion }) {
  if (!result) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Press <strong>Run</strong> to try your fragment against the visible test case, or
          {' '}<strong>Submit</strong> to check it against every test — including the {question.hiddenTestCount} hidden ones.
        </p>
        {question.publicTests[0]?.expectedOutput && (
          <div>
            <p className="label">Expected output</p>
            <CodeBlock code={question.publicTests[0].expectedOutput} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {result.resultSet ? (
        <div>
          <p className="label">Query result</p>
          <ResultTable columns={result.resultSet.columns} rows={result.resultSet.rows} />
        </div>
      ) : (
        <div>
          <p className="label">Your output</p>
          <CodeBlock code={result.stdout} />
        </div>
      )}

      {result.errorMessage && (
        <div>
          <p className="label">Error</p>
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 font-mono text-[13px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {result.errorMessage}
          </div>
        </div>
      )}

      {result.stderr && !result.errorMessage && (
        <div>
          <p className="label">Standard error</p>
          <CodeBlock code={result.stderr} />
        </div>
      )}

      {result.detectedConstructs.length > 0 && (
        <details className="text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer select-none">Constructs detected in your fragment</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {result.detectedConstructs.map((c) => (
              <code key={c} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-ink-850">{c}</code>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TestsPanel({ result, question }: { result: EvaluationResult | null; question: StudentQuestion }) {
  if (!result || result.tests.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {question.publicTests.length} visible test case{question.publicTests.length === 1 ? '' : 's'} and
          {' '}{question.hiddenTestCount} hidden one{question.hiddenTestCount === 1 ? '' : 's'}. Hidden tests run on Submit.
        </p>
        {question.publicTests.map((test) => (
          <div key={test.id} className="rounded-lg border border-slate-200 p-3 dark:border-ink-800">
            <p className="mb-1 text-xs font-semibold">{test.name}</p>
            {test.expectedOutput && <CodeBlock code={test.expectedOutput} />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {result.tests.map((test, i) => (
        <div
          key={i}
          className={`rounded-lg border p-3 ${
            test.passed
              ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
              : 'border-rose-300 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={test.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
              {test.passed ? '✓' : '✗'}
            </span>
            <span className="text-sm font-medium">{test.name}</span>
            {test.visibility === 'hidden' && (
              <span className="chip bg-slate-200 text-slate-600 dark:bg-ink-800 dark:text-slate-300">hidden</span>
            )}
            <span className="ml-auto font-mono text-xs text-slate-400">{formatDuration(test.executionMs)}</span>
          </div>

          {test.message && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{test.message}</p>}

          {!test.passed && test.visibility === 'public' && test.expected !== undefined && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="label">Expected</p>
                <CodeBlock code={test.expected ?? ''} />
              </div>
              <div>
                <p className="label">Your output</p>
                <CodeBlock code={test.actual ?? ''} />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HintsPanel({
  hints, aiHint, onReveal,
}: {
  hints: Array<{ index: number; body: string | null; unlocked: boolean; penalty: number }>;
  aiHint: string | null;
  onReveal(index: number): void;
}) {
  return (
    <div className="space-y-3">
      {aiHint && (
        <div className="rounded-lg border border-brand-300 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950/30">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">AI tutor</p>
          <p className="text-sm">{aiHint}</p>
        </div>
      )}

      {hints.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">This question has no hints.</p>}

      {hints.map((hint) => (
        <div key={hint.index} className="rounded-lg border border-slate-200 p-3 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hint {hint.index + 1}</span>
            {!hint.unlocked && (
              <button className="btn-ghost ml-auto !py-1 text-xs" onClick={() => onReveal(hint.index)}>
                Reveal (−{hint.penalty}%)
              </button>
            )}
          </div>
          {hint.unlocked
            ? <p className="mt-2 text-sm">{hint.body}</p>
            : <p className="mt-2 select-none text-sm text-slate-400 blur-sm" aria-hidden>Hidden hint text goes here for now</p>}
        </div>
      ))}
    </div>
  );
}

function ExplanationPanel({
  explanation, solutions, answered, yourCode,
}: {
  explanation: string | null;
  solutions: Array<{ code: string; note: string | null }>;
  answered: boolean;
  yourCode: string;
}) {
  if (!answered) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        The explanation and alternative solutions unlock once you solve the question — or if you choose
        to reveal the solution.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="label">Your answer</p>
        <CodeBlock code={yourCode} />
      </div>
      {explanation && (
        <div>
          <p className="label">Explanation</p>
          <p className="text-sm leading-relaxed">{explanation}</p>
        </div>
      )}
      {solutions.length > 0 && (
        <div>
          <p className="label">{solutions.length > 1 ? 'Valid solutions' : 'Reference solution'}</p>
          <div className="space-y-2">
            {solutions.map((s, i) => (
              <div key={i}>
                {s.note && <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{s.note}</p>}
                <CodeBlock code={s.code} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SchemaCard({ dataset }: { dataset: NonNullable<StudentQuestion['dataset']> }) {
  const [open, setOpen] = useState<string | null>(dataset.tables[0]?.name ?? null);
  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold">{dataset.name}</h2>
      {dataset.description && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{dataset.description}</p>
      )}
      <div className="mt-3 space-y-1">
        {dataset.tables.map((table) => (
          <div key={table.name} className="rounded-lg border border-slate-200 dark:border-ink-800">
            <button
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
              onClick={() => setOpen(open === table.name ? null : table.name)}
            >
              <span className="font-mono">{table.name}</span>
              <span className="text-xs text-slate-400">{table.columns.length} cols</span>
            </button>
            {open === table.name && (
              <div className="border-t border-slate-200 p-2 dark:border-ink-800">
                <div className="mb-2 flex flex-wrap gap-1">
                  {table.columns.map((col) => (
                    <code key={col} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-850">{col}</code>
                  ))}
                </div>
                <ResultTable columns={table.columns} rows={table.sampleRows} />
                <p className="mt-1 text-[11px] text-slate-400">Sample rows only — your query runs against the full table.</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
