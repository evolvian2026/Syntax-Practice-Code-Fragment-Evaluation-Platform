import { useRef, useState } from 'react';
import { ErrorNote, Spinner } from '../../components/ui';
import { api, getToken } from '../../lib/api';

interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  results: Array<{ index: number; qid?: string; status: string; error?: string }>;
}

/** §19 — bulk upload, import and export of questions. */
export function AdminImportExport() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'upsert' | 'create'>('upsert');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runImport = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      const questions = Array.isArray(parsed) ? parsed : parsed.questions;
      if (!Array.isArray(questions)) throw new Error('Expected a JSON array, or an object with a "questions" array.');
      const res = await api.post<ImportResult>('/admin/questions-import', { questions, mode, dryRun });
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    setBusy(true);
    try {
      // The export route sets a download filename; fetch it directly to keep the auth header.
      const response = await fetch('/api/admin/questions-export', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'questions-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <h2 className="font-medium">Import questions</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Paste or upload a JSON array of questions in the same shape the export produces. In
          <strong> upsert</strong> mode, a question whose QID already exists is updated in place.
        </p>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
          />
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>Choose file…</button>
          <select className="input max-w-[160px]" value={mode} onChange={(e) => setMode(e.target.value as 'upsert' | 'create')}>
            <option value="upsert">Upsert by QID</option>
            <option value="create">Always create new</option>
          </select>
        </div>

        <textarea
          className="input min-h-[240px] font-mono text-[12px]"
          placeholder='{"questions": [ ... ]}'
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />

        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => runImport(true)} disabled={busy || !text.trim()}>
            Validate only
          </button>
          <button className="btn-primary" onClick={() => runImport(false)} disabled={busy || !text.trim()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>

        {error && <ErrorNote message={error} />}
        {busy && <Spinner />}

        {result && (
          <div className="space-y-2">
            <p className="text-sm">
              {result.dryRun ? 'Validation: ' : 'Imported: '}
              <span className="text-emerald-600 dark:text-emerald-400">{result.created} created</span>,{' '}
              <span className="text-brand-600 dark:text-brand-400">{result.updated} updated</span>,{' '}
              <span className="text-rose-600 dark:text-rose-400">{result.failed} failed</span>
            </p>
            {result.failed > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-rose-300 p-2 text-xs dark:border-rose-900">
                {result.results.filter((r) => r.status === 'failed').map((r) => (
                  <li key={r.index} className="text-rose-600 dark:text-rose-400">
                    #{r.index} {r.qid ?? ''}: {r.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="card space-y-3 p-4">
        <h2 className="font-medium">Export questions</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Downloads every question — including test cases, hints, solutions and grading rules — as a JSON
          file you can version-control or import into another instance.
        </p>
        <button className="btn-primary" onClick={exportAll} disabled={busy}>Download questions-export.json</button>

        <div className="border-t border-slate-200 pt-3 dark:border-ink-800">
          <h3 className="mb-2 text-sm font-medium">Question format</h3>
          <pre className="code-block max-h-96 overflow-auto text-[11px]">{SAMPLE}</pre>
        </div>
      </div>
    </div>
  );
}

const SAMPLE = `{
  "questions": [
    {
      "qid": "PY-LOOPS-0099",
      "language": "python",
      "topic": "loops",
      "subtopic": "for",
      "difficulty": "Easy",
      "questionType": "COMPLETE_LOOP",
      "evaluationType": "OUTPUT",
      "title": "Print every number",
      "statement": "Write a for loop that prints every number.",
      "starterCode": "numbers = [1, 2, 3]\\n\\n{{STUDENT_CODE}}",
      "requiredConstructs": ["FOR_LOOP"],
      "forbiddenConstructs": [],
      "testCases": [
        { "visibility": "public", "expectedOutput": "1\\n2\\n3", "matcher": "trimmed" },
        { "visibility": "hidden", "setupCode": "numbers = [9]", "expectedOutput": "9" }
      ],
      "hints": [{ "body": "Which loop walks a list?", "penalty": 10 }],
      "solutions": [{ "code": "for n in numbers:\\n    print(n)", "isPrimary": true }],
      "explanation": "A for loop iterates over each element.",
      "status": "published"
    }
  ]
}`;
