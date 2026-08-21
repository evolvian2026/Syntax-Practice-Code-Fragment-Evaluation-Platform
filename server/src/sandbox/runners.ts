import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import {
  HARNESS_DIR, cleanupWorkDir, isCommandAvailable, limitedShellCommand,
  makeWorkDir, runProcess,
} from './subprocess-driver.js';
import type { SandboxJob, SandboxResult } from './types.js';

function emptyResult(partial: Partial<SandboxResult>): SandboxResult {
  return {
    status: 'ok', stdout: '', stderr: '', exitCode: 0, signal: null,
    durationMs: 0, memoryKb: 0, truncated: false, ...partial,
  };
}

// ------------------------------------------------------------------ python
export async function runPython(job: SandboxJob): Promise<SandboxResult> {
  const dir = await makeWorkDir('py');
  try {
    const payload = JSON.stringify({
      source: job.source,
      stdin: job.stdin ?? '',
      timeLimitMs: job.timeoutMs,
      memoryMb: job.memoryMb,
    });
    const outcome = await runProcess({
      cmd: config.sandbox.pythonBin,
      args: ['-I', '-B', path.join(HARNESS_DIR, 'py_exec.py')],
      cwd: dir,
      stdin: payload,
      timeoutMs: job.timeoutMs + 2000, // harness enforces the real limit first
      captureChannel: true,
      memoryMb: job.memoryMb,
    });

    if (outcome.spawnError) {
      return emptyResult({ status: 'internal_error', stderr: outcome.spawnError, exitCode: null });
    }

    let parsed: any = null;
    const raw = outcome.channel || extractInlineResult(outcome.stdout);
    if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }

    if (!parsed) {
      // The harness never reported: process was killed hard (OOM/timeout).
      const status = outcome.timedOut || outcome.signal === 'SIGKILL' ? 'timeout' : 'runtime_error';
      return emptyResult({
        status,
        stdout: outcome.stdout,
        stderr: outcome.stderr || (status === 'timeout' ? 'Execution timed out.' : 'Execution failed.'),
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        durationMs: outcome.durationMs,
        truncated: outcome.truncated,
      });
    }

    const statusMap: Record<string, SandboxResult['status']> = {
      ok: 'ok',
      timeout: 'timeout',
      syntax_error: 'compile_error',
      restricted: 'restricted',
      runtime_error: 'runtime_error',
      memory_exceeded: 'memory_exceeded',
    };

    return emptyResult({
      status: statusMap[parsed.status] ?? 'runtime_error',
      stdout: parsed.stdout ?? '',
      stderr: parsed.stderr ?? '',
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      durationMs: parsed.durationMs ?? outcome.durationMs,
      memoryKb: parsed.memoryKb ?? 0,
      truncated: outcome.truncated,
      detail: parsed.error ?? undefined,
    });
  } finally {
    await cleanupWorkDir(dir);
  }
}

function extractInlineResult(stdout: string): string | null {
  const marker = '\n__SANDBOX_RESULT__';
  const idx = stdout.lastIndexOf(marker);
  return idx === -1 ? null : stdout.slice(idx + marker.length);
}

/** Static Python analysis (AST). Never executes the code. */
export async function analyzePython(
  source: string,
  opts: { mode?: 'analyze' | 'compare'; candidates?: string[]; kind?: 'auto' | 'exec' | 'eval' } = {},
): Promise<any> {
  const dir = await makeWorkDir('pyast');
  try {
    const outcome = await runProcess({
      cmd: config.sandbox.pythonBin,
      args: ['-I', '-B', path.join(HARNESS_DIR, 'py_ast.py')],
      cwd: dir,
      stdin: JSON.stringify({
        mode: opts.mode ?? 'analyze',
        source,
        candidates: opts.candidates ?? [],
        kind: opts.kind ?? 'auto',
      }),
      timeoutMs: 8000,
    });
    if (!outcome.stdout.trim()) {
      return { ok: false, error: { type: 'AnalyzerError', message: outcome.stderr || 'analysis failed' } };
    }
    try {
      return JSON.parse(outcome.stdout);
    } catch {
      return { ok: false, error: { type: 'AnalyzerError', message: 'invalid analyzer output' } };
    }
  } finally {
    await cleanupWorkDir(dir);
  }
}

// -------------------------------------------------------------------- node
export async function runNode(job: SandboxJob): Promise<SandboxResult> {
  const dir = await makeWorkDir('js');
  try {
    const file = path.join(dir, 'program.mjs');
    await fs.writeFile(file, wrapJavaScript(job.source), 'utf8');
    for (const [name, content] of Object.entries(job.files ?? {})) {
      await fs.writeFile(path.join(dir, name), content, 'utf8');
    }
    const outcome = await runProcess({
      cmd: config.sandbox.nodeBin,
      args: [
        `--max-old-space-size=${job.memoryMb}`,
        '--no-warnings',
        '--permission',           // Node permission model: no fs writes, no child processes, no addons
        `--allow-fs-read=${dir}/*`,
        file,
      ],
      cwd: dir,
      stdin: job.stdin ?? '',
      timeoutMs: job.timeoutMs,
      memoryMb: job.memoryMb,
    });
    const timedOut = outcome.timedOut || outcome.signal === 'SIGKILL';
    return emptyResult({
      status: timedOut ? 'timeout' : outcome.exitCode === 0 ? 'ok' : 'runtime_error',
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      durationMs: outcome.durationMs,
      truncated: outcome.truncated,
    });
  } finally {
    await cleanupWorkDir(dir);
  }
}

/** Blocks the obvious escape hatches before the student's module body runs. */
function wrapJavaScript(source: string): string {
  return `// --- practice sandbox preamble (student code follows) ---
const __write = process.stdout.write.bind(process.stdout);
const __denied = (what) => (...a) => { throw new Error(what + ' is disabled in the practice sandbox'); };
globalThis.require = __denied('require');
globalThis.fetch = __denied('fetch');
globalThis.XMLHttpRequest = undefined;
globalThis.WebSocket = undefined;
globalThis.process = Object.freeze({
  argv: [],
  env: {},
  platform: process.platform,
  version: process.version,
  stdout: { write: (s) => { __write(String(s)); return true; } },
  exit: __denied('process.exit'),
});
// --- student program ---
${source}
`;
}

// -------------------------------------------------------------------- java
export async function runJava(job: SandboxJob): Promise<SandboxResult> {
  if (!(await isCommandAvailable(config.sandbox.javacBin))) {
    return emptyResult({ status: 'internal_error', stderr: 'Java toolchain (javac) is not installed on this host.' });
  }
  const dir = await makeWorkDir('java');
  try {
    const className = detectJavaClassName(job.source) ?? 'Main';
    await fs.writeFile(path.join(dir, `${className}.java`), job.source, 'utf8');
    const compile = await runProcess({
      cmd: config.sandbox.javacBin,
      args: ['-nowarn', '-encoding', 'UTF-8', `${className}.java`],
      cwd: dir,
      timeoutMs: 20000,
    });
    if (compile.exitCode !== 0) {
      return emptyResult({
        status: 'compile_error',
        stderr: compile.stderr || compile.stdout,
        exitCode: compile.exitCode,
        durationMs: compile.durationMs,
      });
    }
    const run = await runProcess({
      cmd: '/bin/sh',
      args: limitedShellCommand(
        `${config.sandbox.javaBin} -Xmx${job.memoryMb}m -XX:-UsePerfData -Djava.security.manager=disallow -cp . ${className}`,
        job.memoryMb * 8, // JVM needs headroom beyond the heap
        job.timeoutMs,
      ),
      cwd: dir,
      stdin: job.stdin ?? '',
      timeoutMs: job.timeoutMs + 3000,
    });
    const timedOut = run.timedOut || run.signal === 'SIGKILL';
    return emptyResult({
      status: timedOut ? 'timeout' : run.exitCode === 0 ? 'ok' : 'runtime_error',
      stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode,
      signal: run.signal, durationMs: run.durationMs, truncated: run.truncated,
    });
  } finally {
    await cleanupWorkDir(dir);
  }
}

function detectJavaClassName(source: string): string | null {
  const m = /public\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(source)
    ?? /class\s+([A-Za-z_$][\w$]*)/.exec(source);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ c/c++
export async function runNative(job: SandboxJob, lang: 'c' | 'cpp'): Promise<SandboxResult> {
  const compiler = lang === 'c' ? config.sandbox.gccBin : config.sandbox.gppBin;
  if (!(await isCommandAvailable(compiler))) {
    return emptyResult({ status: 'internal_error', stderr: `${compiler} is not installed on this host.` });
  }
  const dir = await makeWorkDir(lang);
  try {
    const src = lang === 'c' ? 'program.c' : 'program.cpp';
    await fs.writeFile(path.join(dir, src), job.source, 'utf8');
    const std = lang === 'c' ? '-std=c11' : '-std=c++17';
    const compile = await runProcess({
      cmd: compiler,
      args: [std, '-O0', '-w', '-o', 'program', src],
      cwd: dir,
      timeoutMs: 20000,
    });
    if (compile.exitCode !== 0) {
      return emptyResult({
        status: 'compile_error',
        stderr: compile.stderr || compile.stdout,
        exitCode: compile.exitCode,
        durationMs: compile.durationMs,
      });
    }
    const run = await runProcess({
      cmd: '/bin/sh',
      args: limitedShellCommand('./program', job.memoryMb, job.timeoutMs),
      cwd: dir,
      stdin: job.stdin ?? '',
      timeoutMs: job.timeoutMs + 2000,
    });
    const timedOut = run.timedOut || run.signal === 'SIGKILL';
    return emptyResult({
      status: timedOut ? 'timeout' : run.exitCode === 0 ? 'ok' : 'runtime_error',
      stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode,
      signal: run.signal, durationMs: run.durationMs, truncated: run.truncated,
    });
  } finally {
    await cleanupWorkDir(dir);
  }
}
