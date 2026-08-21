import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FragmentEditor } from '../../components/FragmentEditor';
import { CodeBlock, ErrorNote, Spinner, Tabs, VerdictBadge } from '../../components/ui';
import { ApiError, api, type CatalogLanguage, type EvaluationResult } from '../../lib/api';

/**
 * §20 — the visual question builder.
 *
 * Everything a question needs is editable here, and "Test question" runs the
 * real evaluation engine on a candidate answer without saving anything — so a
 * new question can be added end to end without touching application code.
 */

interface TestCaseDraft {
  visibility: 'public' | 'hidden';
  name: string;
  setupCode: string;
  stdin: string;
  expectedOutput: string;
  matcher: string;
  weight: number;
}

interface Draft {
  qid?: string;
  language: string;
  topic: string;
  subtopic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  questionType: string;
  evaluationType: string;
  title: string;
  statement: string;
  instructions: string;
  learningObjective: string;
  starterCode: string;
  hiddenPrefix: string;
  hiddenSuffix: string;
  editablePrefill: string;
  editablePlaceholder: string;
  dataset: string;
  requiredConstructs: string[];
  forbiddenConstructs: string[];
  requiredKeywords: string[];
  forbiddenKeywords: string[];
  options: string[];
  configText: string;
  maxCodeLength: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  maxScore: number;
  explanation: string;
  status: string;
  tags: string[];
  testCases: TestCaseDraft[];
  hints: Array<{ body: string; penalty: number }>;
  solutions: Array<{ code: string; note: string; isPrimary: boolean }>;
}

const EMPTY: Draft = {
  language: 'python', topic: 'loops', subtopic: '', difficulty: 'Easy',
  questionType: 'FILL_CODE', evaluationType: 'OUTPUT',
  title: '', statement: '', instructions: '', learningObjective: '',
  starterCode: 'numbers = [1, 2, 3]\n\n{{STUDENT_CODE}}\n',
  hiddenPrefix: '', hiddenSuffix: '', editablePrefill: '', editablePlaceholder: '',
  dataset: '', requiredConstructs: [], forbiddenConstructs: [],
  requiredKeywords: [], forbiddenKeywords: [], options: [], configText: '{}',
  maxCodeLength: 600, timeLimitMs: 4000, memoryLimitMb: 128, maxScore: 100,
  explanation: '', status: 'draft', tags: [],
  testCases: [{ visibility: 'public', name: '', setupCode: '', stdin: '', expectedOutput: '', matcher: 'trimmed', weight: 1 }],
  hints: [{ body: '', penalty: 10 }],
  solutions: [{ code: '', note: 'Reference solution', isPrimary: true }],
};

const QUESTION_TYPES = [
  'FILL_CODE', 'COMPLETE_STATEMENT', 'COMPLETE_CONDITION', 'COMPLETE_LOOP',
  'COMPLETE_SQL_CLAUSE', 'CHOOSE_AND_WRITE', 'FIX_SYNTAX', 'PREDICT_OUTPUT', 'IDENTIFY_SYNTAX',
];
const EVALUATION_TYPES = ['OUTPUT', 'SYNTAX', 'AST', 'SQL_RESULT', 'VALUE', 'STATIC', 'TEXT', 'COMPOSITE'];

export function AdminQuestionBuilder({ theme }: { theme: 'dark' | 'light' }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [languages, setLanguages] = useState<CatalogLanguage[]>([]);
  const [datasets, setDatasets] = useState<Array<{ slug: string; name: string }>>([]);
  const [constructGroups, setConstructGroups] = useState<Array<{ group: string; constructs: string[] }>>([]);
  const [tab, setTab] = useState<'content' | 'template' | 'grading' | 'tests' | 'help' | 'preview'>('content');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState<EvaluationResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    api.get<{ languages: CatalogLanguage[] }>('/practice/catalog').then((r) => setLanguages(r.languages)).catch(() => {});
    api.get<{ datasets: Array<{ slug: string; name: string }> }>('/practice/datasets').then((r) => setDatasets(r.datasets)).catch(() => {});
    api.get<{ groups: Array<{ group: string; constructs: string[] }> }>('/practice/constructs').then((r) => setConstructGroups(r.groups)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    api.get<{ question: Record<string, unknown> }>(`/admin/questions/${id}`)
      .then(({ question }) => {
        setDraft(fromApi(question));
        setTestCode(String((question.solutions as Array<{ code: string }> | undefined)?.[0]?.code ?? ''));
        setLoaded(true);
      })
      .catch((err) => { setError(err.message); setLoaded(true); });
  }, [id]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const topics = languages.find((l) => l.slug === draft.language)?.topics ?? [];
  const subtopics = topics.find((t) => t.slug === draft.topic)?.subtopics ?? [];
  const monacoId = languages.find((l) => l.slug === draft.language)?.monacoId ?? 'plaintext';

  const payload = useMemo(() => toApi(draft), [draft]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      const res = id
        ? await api.put<{ id: number; qid: string }>(`/admin/questions/${id}`, payload)
        : await api.post<{ id: number; qid: string }>('/admin/questions', payload);
      navigate(`/admin/questions/${res.id}`, { replace: true });
      setError(null);
      window.alert(`Saved ${res.qid}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues(err.issues ?? []);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  const dryRun = async () => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await api.post<{ result: EvaluationResult }>('/admin/questions/dry-run', {
        question: payload,
        code: testCode,
        mode: 'submit',
      });
      setTestResult(res.result);
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); setIssues(err.issues ?? []); }
      else setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const markerOk = draft.starterCode.includes('{{STUDENT_CODE}}');
  const split = useCallback(() => {
    const index = draft.starterCode.indexOf('{{STUDENT_CODE}}');
    if (index === -1) return { before: draft.starterCode, after: '' };
    const setupCode = draft.testCases.find((t) => t.visibility === 'public')?.setupCode ?? '';
    const rendered = draft.starterCode.split('{{SETUP_CODE}}').join(setupCode);
    const at = rendered.indexOf('{{STUDENT_CODE}}');
    return { before: rendered.slice(0, at), after: rendered.slice(at + '{{STUDENT_CODE}}'.length) };
  }, [draft.starterCode, draft.testCases]);

  if (!loaded) return <div className="card p-8"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">{id ? `Edit ${draft.qid ?? ''}` : 'New question'}</h2>
        <span className={`chip ${markerOk ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`}>
          {markerOk ? '{{STUDENT_CODE}} present' : '{{STUDENT_CODE}} missing'}
        </span>
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => navigate('/admin/questions')}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save question'}</button>
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {issues.length > 0 && (
        <ul className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {issues.map((issue, i) => <li key={i}>• <strong>{issue.path}</strong>: {issue.message}</li>)}
        </ul>
      )}

      <div className="card">
        <div className="px-3 pt-1">
          <Tabs
            active={tab}
            onChange={(id) => setTab(id)}
            tabs={[
              { id: 'content', label: 'Content' },
              { id: 'template', label: 'Code template' },
              { id: 'grading', label: 'Grading rules' },
              { id: 'tests', label: 'Test cases', badge: draft.testCases.length },
              { id: 'help', label: 'Hints & solution', badge: draft.hints.length },
              { id: 'preview', label: 'Preview & test' },
            ]}
          />
        </div>

        <div className="p-4">
          {tab === 'content' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Title">
                <input className="input" value={draft.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="QID (leave blank to auto-generate)">
                <input className="input font-mono" value={draft.qid ?? ''} onChange={(e) => set('qid', e.target.value)} />
              </Field>
              <Field label="Statement" className="lg:col-span-2">
                <textarea className="input min-h-[90px]" value={draft.statement} onChange={(e) => set('statement', e.target.value)} />
              </Field>
              <Field label="Instructions (optional)" className="lg:col-span-2">
                <textarea className="input" value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} />
              </Field>
              <Field label="Language">
                <select className="input" value={draft.language} onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value, topic: '', subtopic: '' }))}>
                  {languages.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Topic">
                <select className="input" value={draft.topic} onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value, subtopic: '' }))}>
                  <option value="">Select a topic…</option>
                  {topics.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Subtopic">
                <select className="input" value={draft.subtopic} onChange={(e) => set('subtopic', e.target.value)}>
                  <option value="">None</option>
                  {subtopics.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Difficulty">
                <select className="input" value={draft.difficulty} onChange={(e) => set('difficulty', e.target.value as Draft['difficulty'])}>
                  <option>Easy</option><option>Medium</option><option>Hard</option>
                </select>
              </Field>
              <Field label="Question type">
                <select className="input" value={draft.questionType} onChange={(e) => set('questionType', e.target.value)}>
                  {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </Field>
              <Field label="Evaluation type">
                <select className="input" value={draft.evaluationType} onChange={(e) => set('evaluationType', e.target.value)}>
                  {EVALUATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Learning objective">
                <input className="input" value={draft.learningObjective} onChange={(e) => set('learningObjective', e.target.value)} />
              </Field>
              <Field label="Status">
                <select className="input" value={draft.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
              <Field label="Tags (comma separated)" className="lg:col-span-2">
                <input className="input" value={draft.tags.join(', ')} onChange={(e) => set('tags', splitList(e.target.value))} />
              </Field>
            </div>
          )}

          {tab === 'template' && (
            <div className="space-y-4">
              <p className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-ink-850">
                The starter code must contain <code className="font-mono">{'{{STUDENT_CODE}}'}</code> — that marker is
                replaced by the student's fragment. Optionally add <code className="font-mono">{'{{SETUP_CODE}}'}</code> where
                per-test data should be injected.
              </p>
              <Field label="Starter code (shown to the student)">
                <textarea
                  className="input min-h-[180px] font-mono text-[13px]"
                  value={draft.starterCode}
                  onChange={(e) => set('starterCode', e.target.value)}
                  spellCheck={false}
                />
              </Field>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Hidden prefix (never shown, runs first)">
                  <textarea className="input min-h-[80px] font-mono text-[13px]" value={draft.hiddenPrefix} onChange={(e) => set('hiddenPrefix', e.target.value)} spellCheck={false} />
                </Field>
                <Field label="Hidden suffix (never shown, runs last)">
                  <textarea className="input min-h-[80px] font-mono text-[13px]" value={draft.hiddenSuffix} onChange={(e) => set('hiddenSuffix', e.target.value)} spellCheck={false} />
                </Field>
                <Field label="Editable region prefill">
                  <textarea className="input min-h-[60px] font-mono text-[13px]" value={draft.editablePrefill} onChange={(e) => set('editablePrefill', e.target.value)} spellCheck={false} />
                </Field>
                <Field label="Editor placeholder">
                  <input className="input font-mono" value={draft.editablePlaceholder} onChange={(e) => set('editablePlaceholder', e.target.value)} />
                </Field>
              </div>
              <Field label="SQL sandbox dataset (SQL questions only)">
                <select className="input max-w-xs" value={draft.dataset} onChange={(e) => set('dataset', e.target.value)}>
                  <option value="">None</option>
                  {datasets.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          {tab === 'grading' && (
            <div className="space-y-4">
              <ConstructPicker
                label="Required constructs — the answer is wrong without these, even if the output matches"
                groups={constructGroups}
                selected={draft.requiredConstructs}
                onChange={(v) => set('requiredConstructs', v)}
              />
              <ConstructPicker
                label="Forbidden constructs"
                groups={constructGroups}
                selected={draft.forbiddenConstructs}
                onChange={(v) => set('forbiddenConstructs', v)}
              />
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Required keywords (comma separated)">
                  <input className="input font-mono" value={draft.requiredKeywords.join(', ')} onChange={(e) => set('requiredKeywords', splitList(e.target.value))} />
                </Field>
                <Field label="Forbidden keywords (comma separated)">
                  <input className="input font-mono" value={draft.forbiddenKeywords.join(', ')} onChange={(e) => set('forbiddenKeywords', splitList(e.target.value))} />
                </Field>
                <Field label="Options (CHOOSE_AND_WRITE, comma separated)">
                  <input className="input font-mono" value={draft.options.join(', ')} onChange={(e) => set('options', splitList(e.target.value))} />
                </Field>
                <Field label="Max code length">
                  <input type="number" className="input" value={draft.maxCodeLength} onChange={(e) => set('maxCodeLength', Number(e.target.value))} />
                </Field>
                <Field label="Time limit (ms)">
                  <input type="number" className="input" value={draft.timeLimitMs} onChange={(e) => set('timeLimitMs', Number(e.target.value))} />
                </Field>
                <Field label="Memory limit (MB)">
                  <input type="number" className="input" value={draft.memoryLimitMb} onChange={(e) => set('memoryLimitMb', Number(e.target.value))} />
                </Field>
                <Field label="Max score">
                  <input type="number" className="input" value={draft.maxScore} onChange={(e) => set('maxScore', Number(e.target.value))} />
                </Field>
              </div>
              <Field label="Evaluator config (JSON — acceptRegex, html, css, acceptedText, sqlOrdered, constructMessage…)">
                <textarea
                  className={`input min-h-[120px] font-mono text-[13px] ${isJson(draft.configText) ? '' : 'border-rose-400'}`}
                  value={draft.configText}
                  onChange={(e) => set('configText', e.target.value)}
                  spellCheck={false}
                />
                {!isJson(draft.configText) && <p className="mt-1 text-xs text-rose-500">This is not valid JSON.</p>}
              </Field>
            </div>
          )}

          {tab === 'tests' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Public tests are visible to students; hidden tests only run on Submit and are never revealed (§13).
              </p>
              {draft.testCases.map((test, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-ink-800">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <select
                      className="input max-w-[120px]"
                      value={test.visibility}
                      onChange={(e) => updateTest(setDraft, i, { visibility: e.target.value as 'public' | 'hidden' })}
                    >
                      <option value="public">Public</option>
                      <option value="hidden">Hidden</option>
                    </select>
                    <input
                      className="input max-w-[180px]"
                      placeholder="Name"
                      value={test.name}
                      onChange={(e) => updateTest(setDraft, i, { name: e.target.value })}
                    />
                    <select
                      className="input max-w-[160px]"
                      value={test.matcher}
                      onChange={(e) => updateTest(setDraft, i, { matcher: e.target.value })}
                    >
                      {['trimmed', 'exact', 'normalized', 'contains', 'regex', 'unordered_rows'].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="number" step="0.5" className="input max-w-[90px]" title="Weight"
                      value={test.weight}
                      onChange={(e) => updateTest(setDraft, i, { weight: Number(e.target.value) })}
                    />
                    <button
                      className="btn-ghost ml-auto !py-1 text-xs text-rose-600 dark:text-rose-400"
                      onClick={() => setDraft((d) => ({ ...d, testCases: d.testCases.filter((_, j) => j !== i) }))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <Field label="Setup code / extra rows ({{SETUP_CODE}})">
                      <textarea className="input min-h-[70px] font-mono text-[12px]" value={test.setupCode} onChange={(e) => updateTest(setDraft, i, { setupCode: e.target.value })} spellCheck={false} />
                    </Field>
                    <Field label="stdin">
                      <textarea className="input min-h-[70px] font-mono text-[12px]" value={test.stdin} onChange={(e) => updateTest(setDraft, i, { stdin: e.target.value })} spellCheck={false} />
                    </Field>
                    <Field label="Expected output">
                      <textarea className="input min-h-[70px] font-mono text-[12px]" value={test.expectedOutput} onChange={(e) => updateTest(setDraft, i, { expectedOutput: e.target.value })} spellCheck={false} />
                    </Field>
                  </div>
                </div>
              ))}
              <button
                className="btn-secondary"
                onClick={() => setDraft((d) => ({
                  ...d,
                  testCases: [...d.testCases, { visibility: 'hidden', name: '', setupCode: '', stdin: '', expectedOutput: '', matcher: 'trimmed', weight: 1 }],
                }))}
              >
                + Add test case
              </button>
            </div>
          )}

          {tab === 'help' && (
            <div className="space-y-4">
              <div>
                <p className="label">Progressive hints (§15)</p>
                {draft.hints.map((hint, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input
                      className="input" placeholder={`Hint ${i + 1}`} value={hint.body}
                      onChange={(e) => setDraft((d) => ({ ...d, hints: d.hints.map((h, j) => (j === i ? { ...h, body: e.target.value } : h)) }))}
                    />
                    <input
                      type="number" className="input max-w-[90px]" title="Score penalty %" value={hint.penalty}
                      onChange={(e) => setDraft((d) => ({ ...d, hints: d.hints.map((h, j) => (j === i ? { ...h, penalty: Number(e.target.value) } : h)) }))}
                    />
                    <button
                      className="btn-ghost !px-2 text-rose-600 dark:text-rose-400"
                      onClick={() => setDraft((d) => ({ ...d, hints: d.hints.filter((_, j) => j !== i) }))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="btn-secondary" onClick={() => setDraft((d) => ({ ...d, hints: [...d.hints, { body: '', penalty: 15 }] }))}>
                  + Add hint
                </button>
              </div>

              <Field label="Explanation shown after submission (§16)">
                <textarea className="input min-h-[100px]" value={draft.explanation} onChange={(e) => set('explanation', e.target.value)} />
              </Field>

              <div>
                <p className="label">Solutions — the first is the reference, the rest are accepted alternatives</p>
                {draft.solutions.map((sol, i) => (
                  <div key={i} className="mb-2 space-y-1">
                    <div className="flex gap-2">
                      <input
                        className="input max-w-[220px]" placeholder="Note" value={sol.note}
                        onChange={(e) => setDraft((d) => ({ ...d, solutions: d.solutions.map((s, j) => (j === i ? { ...s, note: e.target.value } : s)) }))}
                      />
                      <button
                        className="btn-ghost !px-2 text-rose-600 dark:text-rose-400"
                        onClick={() => setDraft((d) => ({ ...d, solutions: d.solutions.filter((_, j) => j !== i) }))}
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      className="input min-h-[80px] font-mono text-[13px]" value={sol.code} spellCheck={false}
                      onChange={(e) => setDraft((d) => ({ ...d, solutions: d.solutions.map((s, j) => (j === i ? { ...s, code: e.target.value } : s)) }))}
                    />
                  </div>
                ))}
                <button
                  className="btn-secondary"
                  onClick={() => setDraft((d) => ({ ...d, solutions: [...d.solutions, { code: '', note: 'Alternative approach', isPrimary: false }] }))}
                >
                  + Add solution
                </button>
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <p className="label">Exactly what the student sees</p>
                <div className="card p-4">
                  <h3 className="font-medium">{draft.title || 'Untitled question'}</h3>
                  <p className="mt-2 whitespace-pre-line text-sm">{draft.statement || 'No statement yet.'}</p>
                  {draft.instructions && (
                    <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-ink-850">{draft.instructions}</p>
                  )}
                </div>
                <FragmentEditor
                  language={monacoId}
                  contextBefore={split().before}
                  contextAfter={split().after}
                  value={testCode}
                  onChange={setTestCode}
                  onSubmit={dryRun}
                  placeholder={draft.editablePlaceholder}
                  theme={theme}
                  maxLength={draft.maxCodeLength}
                />
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={dryRun} disabled={testing}>
                    {testing ? 'Running…' : 'Test question'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setTestCode(draft.solutions[0]?.code ?? '')}
                    disabled={!draft.solutions[0]?.code}
                  >
                    Load reference solution
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="label">Evaluation result</p>
                {!testResult ? (
                  <div className="card p-6 text-sm text-slate-500 dark:text-slate-400">
                    Run a candidate answer to see exactly how the engine grades it. Load the reference solution
                    and confirm it passes before publishing.
                  </div>
                ) : (
                  <div className="card space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      <VerdictBadge verdict={testResult.verdict} />
                      <span className="ml-auto font-mono text-xs text-slate-500">
                        {testResult.score}/{testResult.maxScore} pts
                      </span>
                    </div>
                    <p className="text-sm">{testResult.feedback}</p>
                    <div className="flex flex-wrap gap-1">
                      {testResult.stages.map((s) => (
                        <span key={s.stage} className={`chip ${s.passed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`} title={s.message}>
                          {s.passed ? '✓' : '✗'} {s.title}
                        </span>
                      ))}
                    </div>
                    {testResult.detectedConstructs.length > 0 && (
                      <div>
                        <p className="label">Detected constructs</p>
                        <div className="flex flex-wrap gap-1">
                          {testResult.detectedConstructs.map((c) => (
                            <code key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-850">{c}</code>
                          ))}
                        </div>
                      </div>
                    )}
                    <div><p className="label">Output</p><CodeBlock code={testResult.stdout} /></div>
                    <div><p className="label">Generated program</p><CodeBlock code={testResult.generatedCode} /></div>
                    {testResult.tests.length > 0 && (
                      <div>
                        <p className="label">Tests</p>
                        <ul className="space-y-1 text-sm">
                          {testResult.tests.map((t, i) => (
                            <li key={i} className={t.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {t.passed ? '✓' : '✗'} {t.name} {t.message ? `— ${t.message}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- helpers

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function ConstructPicker({
  label, groups, selected, onChange,
}: {
  label: string;
  groups: Array<{ group: string; constructs: string[] }>;
  selected: string[];
  onChange(value: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (construct: string) =>
    onChange(selected.includes(construct) ? selected.filter((c) => c !== construct) : [...selected, construct]);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="mb-2 flex flex-wrap gap-1">
        {selected.length === 0 && <span className="text-sm text-slate-400">None</span>}
        {selected.map((c) => (
          <button key={c} className="chip bg-brand-500/15 text-brand-700 dark:text-brand-300" onClick={() => toggle(c)}>
            {c} ✕
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary !py-1 text-xs" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close picker' : 'Pick constructs'}
        </button>
        <input
          className="input flex-1 font-mono text-xs"
          placeholder="Or type custom ids, comma separated (e.g. METHOD:append, ANY:FOR_LOOP|WHILE_LOOP)"
          value={selected.join(', ')}
          onChange={(e) => onChange(splitList(e.target.value))}
        />
      </div>
      {open && (
        <div className="mt-2 max-h-72 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-ink-800">
          {groups.map((group) => (
            <div key={group.group}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.group}</p>
              <div className="flex flex-wrap gap-1">
                {group.constructs.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggle(c)}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                      selected.includes(c)
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-850 dark:text-slate-300'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function updateTest(
  setDraft: React.Dispatch<React.SetStateAction<Draft>>,
  index: number,
  patch: Partial<TestCaseDraft>,
): void {
  setDraft((d) => ({
    ...d,
    testCases: d.testCases.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  }));
}

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function isJson(value: string): boolean {
  try { JSON.parse(value); return true; } catch { return false; }
}

function toApi(draft: Draft): Record<string, unknown> {
  return {
    qid: draft.qid?.trim() ? draft.qid.trim() : undefined,
    language: draft.language,
    topic: draft.topic,
    subtopic: draft.subtopic || null,
    difficulty: draft.difficulty,
    questionType: draft.questionType,
    evaluationType: draft.evaluationType,
    title: draft.title,
    statement: draft.statement,
    instructions: draft.instructions || null,
    learningObjective: draft.learningObjective || null,
    starterCode: draft.starterCode,
    hiddenPrefix: draft.hiddenPrefix || null,
    hiddenSuffix: draft.hiddenSuffix || null,
    editablePrefill: draft.editablePrefill || null,
    editablePlaceholder: draft.editablePlaceholder || null,
    indentFragment: true,
    dataset: draft.dataset || null,
    requiredConstructs: draft.requiredConstructs,
    forbiddenConstructs: draft.forbiddenConstructs,
    requiredKeywords: draft.requiredKeywords,
    forbiddenKeywords: draft.forbiddenKeywords,
    options: draft.options,
    config: isJson(draft.configText) ? JSON.parse(draft.configText) : {},
    maxCodeLength: draft.maxCodeLength,
    timeLimitMs: draft.timeLimitMs,
    memoryLimitMb: draft.memoryLimitMb,
    maxScore: draft.maxScore,
    explanation: draft.explanation || null,
    status: draft.status,
    tags: draft.tags,
    testCases: draft.testCases.map((t) => ({
      visibility: t.visibility,
      name: t.name || null,
      setupCode: t.setupCode || null,
      stdin: t.stdin || null,
      expectedOutput: t.expectedOutput || null,
      matcher: t.matcher,
      weight: t.weight,
    })),
    hints: draft.hints.filter((h) => h.body.trim()).map((h) => ({ body: h.body, penalty: h.penalty })),
    solutions: draft.solutions.filter((s) => s.code.trim()).map((s, i) => ({
      code: s.code, isPrimary: i === 0, note: s.note || null,
    })),
  };
}

function fromApi(q: Record<string, any>): Draft {
  return {
    ...EMPTY,
    qid: q.qid,
    language: q.language,
    topic: q.topic,
    subtopic: q.subtopic ?? '',
    difficulty: q.difficulty,
    questionType: q.questionType,
    evaluationType: q.evaluationType,
    title: q.title ?? '',
    statement: q.statement ?? '',
    instructions: q.instructions ?? '',
    learningObjective: q.learningObjective ?? '',
    starterCode: q.starterCode ?? '',
    hiddenPrefix: q.hiddenPrefix ?? '',
    hiddenSuffix: q.hiddenSuffix ?? '',
    editablePrefill: q.editablePrefill ?? '',
    editablePlaceholder: q.editablePlaceholder ?? '',
    dataset: q.dataset ?? '',
    requiredConstructs: q.requiredConstructs ?? [],
    forbiddenConstructs: q.forbiddenConstructs ?? [],
    requiredKeywords: q.requiredKeywords ?? [],
    forbiddenKeywords: q.forbiddenKeywords ?? [],
    options: q.options ?? [],
    configText: JSON.stringify(q.config ?? {}, null, 2),
    maxCodeLength: q.maxCodeLength ?? 600,
    timeLimitMs: q.timeLimitMs ?? 4000,
    memoryLimitMb: q.memoryLimitMb ?? 128,
    maxScore: q.maxScore ?? 100,
    explanation: q.explanation ?? '',
    status: q.status ?? 'draft',
    tags: q.tags ?? [],
    testCases: (q.testCases ?? []).map((t: Record<string, any>) => ({
      visibility: t.visibility ?? 'public',
      name: t.name ?? '',
      setupCode: t.setupCode ?? '',
      stdin: t.stdin ?? '',
      expectedOutput: t.expectedOutput ?? '',
      matcher: t.matcher ?? 'trimmed',
      weight: t.weight ?? 1,
    })),
    hints: (q.hints ?? []).map((h: Record<string, any>) => ({ body: h.body, penalty: h.penalty ?? 15 })),
    solutions: (q.solutions ?? []).map((s: Record<string, any>) => ({
      code: s.code, note: s.note ?? '', isPrimary: Boolean(s.isPrimary),
    })),
  };
}
