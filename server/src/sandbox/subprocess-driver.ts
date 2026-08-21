import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { SandboxDriver, SandboxJob, SandboxResult, SandboxStatus } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_DIR = path.join(here, 'harness');

export interface SpawnOptions {
  cmd: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
  /** Collect a JSON payload the child writes to fd 3. */
  captureChannel?: boolean;
  env?: NodeJS.ProcessEnv;
  memoryMb?: number;
}

export interface SpawnOutcome {
  stdout: string;
  stderr: string;
  channel: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
  spawnError?: string;
}

/**
 * Minimal environment handed to sandboxed children: no inherited secrets,
 * no proxy variables, no HOME pointing at the app user's directory.
 */
function sandboxEnv(cwd: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: cwd,
    TMPDIR: cwd,
    LANG: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    NODE_OPTIONS: '',
    ...extra,
  };
}

export async function runProcess(opts: SpawnOptions): Promise<SpawnOutcome> {
  const maxBytes = config.sandbox.maxOutputBytes;
  const timeoutMs = Math.min(opts.timeoutMs, config.sandbox.hardTimeoutMs);
  const started = Date.now();

  return new Promise<SpawnOutcome>((resolve) => {
    const stdio: Array<'pipe' | 'ignore'> = ['pipe', 'pipe', 'pipe'];
    if (opts.captureChannel) stdio.push('pipe');

    let child;
    try {
      child = spawn(opts.cmd, opts.args, {
        cwd: opts.cwd,
        env: sandboxEnv(opts.cwd, opts.env),
        stdio,
        detached: true, // own process group, so we can kill the whole tree
      });
    } catch (err) {
      resolve({
        stdout: '', stderr: '', channel: '', exitCode: null, signal: null,
        timedOut: false, durationMs: 0, truncated: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let channel = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const append = (target: 'out' | 'err', chunk: Buffer) => {
      const current = target === 'out' ? stdout : stderr;
      if (current.length >= maxBytes) {
        truncated = true;
        return;
      }
      const next = current + chunk.toString('utf8');
      const clipped = next.length > maxBytes ? next.slice(0, maxBytes) : next;
      if (clipped.length < next.length) truncated = true;
      if (target === 'out') stdout = clipped;
      else stderr = clipped;
    };

    child.stdout?.on('data', (c: Buffer) => append('out', c));
    child.stderr?.on('data', (c: Buffer) => append('err', c));
    const extra = (child.stdio as unknown[])[3] as NodeJS.ReadableStream | undefined;
    extra?.on?.('data', (c: Buffer) => {
      if (channel.length < maxBytes * 4) channel += c.toString('utf8');
    });

    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGKILL');
    }, timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout, stderr, channel, exitCode, signal, timedOut,
        durationMs: Date.now() - started, truncated,
      });
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout, stderr, channel, exitCode: null, signal: null, timedOut,
        durationMs: Date.now() - started, truncated,
        spawnError: err.message,
      });
    });
    child.on('close', (code, signal) => finish(code, signal));

    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
    }
    child.stdin?.end();
  });
}

export async function makeWorkDir(prefix: string): Promise<string> {
  const base = config.sandbox.workDir;
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, `${prefix}-`));
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** `ulimit` wrapper so compiled binaries obey CPU/memory/file limits too. */
export function limitedShellCommand(command: string, memoryMb: number, timeoutMs: number): string[] {
  const cpuSeconds = Math.max(1, Math.ceil(timeoutMs / 1000) + 1);
  const kb = memoryMb * 1024;
  return [
    '-c',
    `ulimit -t ${cpuSeconds} -v ${kb} -f 4096 -n 64 -c 0 2>/dev/null; exec ${command}`,
  ];
}

async function commandExists(cmd: string): Promise<boolean> {
  const out = await runProcess({
    cmd: '/bin/sh',
    args: ['-c', `command -v ${JSON.stringify(cmd).slice(1, -1)} >/dev/null 2>&1`],
    cwd: os.tmpdir(),
    timeoutMs: 3000,
  });
  return out.exitCode === 0;
}

const availabilityCache = new Map<string, boolean>();
export async function isCommandAvailable(cmd: string): Promise<boolean> {
  if (availabilityCache.has(cmd)) return availabilityCache.get(cmd)!;
  const ok = await commandExists(cmd);
  availabilityCache.set(cmd, ok);
  return ok;
}

export function mapStatus(outcome: SpawnOutcome, ok: boolean): SandboxStatus {
  if (outcome.timedOut) return 'timeout';
  if (outcome.signal === 'SIGKILL') return 'timeout';
  if (outcome.spawnError) return 'internal_error';
  return ok ? 'ok' : 'runtime_error';
}

export const subprocessDriverMeta = { name: 'subprocess' };
export type { SandboxDriver, SandboxJob, SandboxResult };
