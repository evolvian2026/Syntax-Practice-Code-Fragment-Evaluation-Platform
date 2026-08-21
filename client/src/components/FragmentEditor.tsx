import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';

/**
 * §10 — the fragment editor.
 *
 * The provided code is rendered as read-only, syntax-highlighted context above
 * and below a single editable Monaco instance. Protected code is never part of
 * the editable model, so there is nothing for a student to overwrite — no
 * range-guard hacks, and the editable region is unmistakable.
 */

interface Props {
  language: string;
  contextBefore: string;
  contextAfter: string;
  value: string;
  onChange(value: string): void;
  onRun?(): void;
  onSubmit?(): void;
  placeholder?: string | null;
  theme: 'dark' | 'light';
  readOnly?: boolean;
  maxLength?: number;
}

export function FragmentEditor({
  language, contextBefore, contextAfter, value, onChange,
  onRun, onSubmit, placeholder, theme, readOnly, maxLength,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const actionsRef = useRef({ onRun, onSubmit });
  const [height, setHeight] = useState(140);

  // Keep the keybindings pointing at the latest handlers without re-registering.
  useEffect(() => {
    actionsRef.current = { onRun, onSubmit };
  }, [onRun, onSubmit]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme('syntax-practice-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0b1020',
        'editor.lineHighlightBackground': '#131c31',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#a5b4fc',
        'editorCursor.foreground': '#818cf8',
        'editor.selectionBackground': '#4338ca55',
      },
    });
    monaco.editor.defineTheme('syntax-practice-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
        'editor.lineHighlightBackground': '#f1f5f9',
        'editorLineNumber.foreground': '#94a3b8',
      },
    });
    monaco.editor.setTheme(theme === 'dark' ? 'syntax-practice-dark' : 'syntax-practice-light');

    // §10 — keyboard shortcuts.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => actionsRef.current.onRun?.());
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => actionsRef.current.onSubmit?.(),
    );

    const resize = () => {
      const lines = Math.max(4, editor.getModel()?.getLineCount() ?? 4);
      setHeight(Math.min(460, lines * 21 + 26));
    };
    editor.onDidChangeModelContent(resize);
    resize();
    if (!readOnly) editor.focus();
  };

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === 'dark' ? 'syntax-practice-dark' : 'syntax-practice-light');
  }, [theme]);

  const format = () => editorRef.current?.getAction('editor.action.formatDocument')?.run();

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-ink-800 dark:bg-ink-950">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-1.5 dark:border-ink-800 dark:bg-ink-900">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Provided code
        </span>
        <button type="button" onClick={format} className="text-[11px] text-slate-500 hover:text-brand-500 dark:text-slate-400">
          Format
        </button>
      </div>

      {contextBefore.trim().length > 0 && (
        <ReadOnlyContext code={contextBefore} language={language} theme={theme} />
      )}

      <div className="relative border-y-2 border-dashed border-brand-500/60 bg-white dark:bg-ink-950">
        <div className="absolute right-2 top-1 z-10 select-none font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-500">
          Your code
        </div>
        <div style={{ height }}>
          <Editor
            language={language}
            value={value}
            onChange={(next) => {
              const text = next ?? '';
              onChange(maxLength && text.length > maxLength ? text.slice(0, maxLength) : text);
            }}
            onMount={handleMount}
            theme={theme === 'dark' ? 'syntax-practice-dark' : 'syntax-practice-light'}
            options={{
              readOnly,
              minimap: { enabled: false },
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              fontSize: 14,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
              autoIndent: 'full',
              renderLineHighlight: 'line',
              padding: { top: 12, bottom: 8 },
              scrollbar: { alwaysConsumeMouseWheel: false, vertical: 'auto' },
              suggestOnTriggerCharacters: true,
              quickSuggestions: { other: true, comments: false, strings: false },
              wordWrap: 'on',
              bracketPairColorization: { enabled: true },
              placeholder,
            } as never}
          />
        </div>
      </div>

      {contextAfter.trim().length > 0 && (
        <ReadOnlyContext code={contextAfter} language={language} theme={theme} />
      )}

      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 dark:border-ink-800 dark:text-slate-400">
        <span>
          <kbd className="rounded border border-slate-300 px-1 dark:border-ink-700">Ctrl</kbd>
          {' + '}
          <kbd className="rounded border border-slate-300 px-1 dark:border-ink-700">Enter</kbd> to run
        </span>
        {maxLength && (
          <span className={value.length > maxLength * 0.9 ? 'text-amber-500' : ''}>
            {value.length} / {maxLength}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only context pane. Uses a plain Monaco instance in read-only mode so the
 * highlighting matches the editable region exactly.
 */
function ReadOnlyContext({ code, language, theme }: { code: string; language: string; theme: 'dark' | 'light' }) {
  const trimmed = code.replace(/^\n+|\n+$/g, '');
  const lines = trimmed.split('\n').length;
  return (
    <div
      className="select-none opacity-70"
      style={{ height: Math.min(300, lines * 21 + 16) }}
      aria-label="Provided code (read only)"
    >
      <Editor
        language={language}
        value={trimmed}
        theme={theme === 'dark' ? 'syntax-practice-dark' : 'syntax-practice-light'}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          lineNumbers: 'off',
          folding: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          scrollbar: { vertical: 'hidden', horizontal: 'auto', alwaysConsumeMouseWheel: false },
          padding: { top: 8, bottom: 8 },
          contextmenu: false,
        }}
      />
    </div>
  );
}
