import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HARNESS_DIR, cleanupWorkDir, isCommandAvailable, makeWorkDir, runProcess } from './subprocess-driver.js';
import type { SandboxJob, SandboxResult } from './types.js';

/**
 * Container driver — one throwaway container per execution.
 *
 * Enabled with SANDBOX_DRIVER=docker. Gives kernel-level isolation on top of the
 * in-process guards: no network, read-only rootfs, dropped capabilities, pid cap.
 * Falls back to the subprocess driver automatically when the daemon is absent.
 */
export async function dockerAvailable(): Promise<boolean> {
  if (!(await isCommandAvailable('docker'))) return false;
  const probe = await runProcess({ cmd: 'docker', args: ['info', '--format', '{{.ServerVersion}}'], cwd: '/tmp', timeoutMs: 6000 });
  return probe.exitCode === 0;
}

function imageFor(runtime: SandboxJob['runtime']): string {
  switch (runtime) {
    case 'python': return config.sandbox.dockerImagePython;
    case 'node': return config.sandbox.dockerImageNode;
    case 'java': return config.sandbox.dockerImageJava;
    default: return config.sandbox.dockerImageC;
  }
}

function commandFor(runtime: SandboxJob['runtime']): string[] {
  switch (runtime) {
    case 'python': return ['python3', '-I', '-B', '/sandbox/py_exec.py'];
    case 'node': return ['node', '--no-warnings', '/sandbox/program.mjs'];
    case 'java': return ['sh', '-c', 'cd /sandbox && javac -nowarn Main.java && java -cp . Main'];
    case 'c': return ['sh', '-c', 'cd /sandbox && gcc -std=c11 -w -o program program.c && ./program'];
    case 'cpp': return ['sh', '-c', 'cd /sandbox && g++ -std=c++17 -w -o program program.cpp && ./program'];
  }
}

export async function runInDocker(job: SandboxJob): Promise<SandboxResult> {
  const dir = await makeWorkDir('docker');
  try {
    if (job.runtime === 'python') {
      await fs.copyFile(path.join(HARNESS_DIR, 'py_exec.py'), path.join(dir, 'py_exec.py'));
    } else {
      const names: Record<string, string> = { node: 'program.mjs', java: 'Main.java', c: 'program.c', cpp: 'program.cpp' };
      await fs.writeFile(path.join(dir, names[job.runtime]), job.source, 'utf8');
    }

    const seconds = Math.ceil((job.timeoutMs + 1000) / 1000);
    const args = [
      'run', '--rm', '-i',
      '--network=none',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=64',
      `--memory=${job.memoryMb}m`,
      `--memory-swap=${job.memoryMb}m`,
      '--cpus=1',
      '--read-only',
      '--tmpfs', '/tmp:rw,size=16m,noexec',
      '-v', `${dir}:/sandbox:ro`,
      '-w', '/sandbox',
      '--user', '65534:65534',
      imageFor(job.runtime),
      ...commandFor(job.runtime),
    ];

    const stdin = job.runtime === 'python'
      ? JSON.stringify({ source: job.source, stdin: job.stdin ?? '', timeLimitMs: job.timeoutMs, memoryMb: job.memoryMb })
      : (job.stdin ?? '');

    const outcome = await runProcess({
      cmd: 'docker',
      args,
      cwd: dir,
      stdin,
      timeoutMs: seconds * 1000 + 5000,
    });

    if (job.runtime === 'python') {
      // In-container the harness cannot use fd 3, so it falls back to the inline marker.
      const marker = '\n__SANDBOX_RESULT__';
      const idx = outcome.stdout.lastIndexOf(marker);
      if (idx !== -1) {
        try {
          const parsed = JSON.parse(outcome.stdout.slice(idx + marker.length));
          const map: Record<string, SandboxResult['status']> = {
            ok: 'ok', timeout: 'timeout', syntax_error: 'compile_error',
            restricted: 'restricted', runtime_error: 'runtime_error', memory_exceeded: 'memory_exceeded',
          };
          return {
            status: map[parsed.status] ?? 'runtime_error',
            stdout: parsed.stdout ?? '', stderr: parsed.stderr ?? '',
            exitCode: outcome.exitCode, signal: outcome.signal,
            durationMs: parsed.durationMs ?? outcome.durationMs,
            memoryKb: parsed.memoryKb ?? 0, truncated: outcome.truncated,
            detail: parsed.error ?? undefined,
          };
        } catch { /* fall through */ }
      }
    }

    const timedOut = outcome.timedOut || outcome.exitCode === 137;
    return {
      status: timedOut ? 'timeout' : outcome.exitCode === 0 ? 'ok' : 'runtime_error',
      stdout: outcome.stdout, stderr: outcome.stderr,
      exitCode: outcome.exitCode, signal: outcome.signal,
      durationMs: outcome.durationMs, memoryKb: 0, truncated: outcome.truncated,
    };
  } finally {
    await cleanupWorkDir(dir);
  }
}
