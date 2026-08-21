import { config } from '../config.js';
import { dockerAvailable, runInDocker } from './docker-driver.js';
import { analyzePython, runJava, runNative, runNode, runPython } from './runners.js';
import type { SandboxJob, SandboxResult } from './types.js';

export type { SandboxJob, SandboxResult, SandboxStatus } from './types.js';
export { analyzePython };

/**
 * Bounded queue so a burst of submissions cannot fork-bomb the host.
 * Student code always runs in a child process/container, never in this one.
 */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  private release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const gate = new Semaphore(Math.max(1, config.sandbox.maxConcurrent));

let dockerReady: boolean | null = null;
async function useDocker(): Promise<boolean> {
  if (config.sandbox.driver !== 'docker') return false;
  if (dockerReady === null) dockerReady = await dockerAvailable();
  return dockerReady;
}

export async function execute(job: SandboxJob): Promise<SandboxResult> {
  const release = await gate.acquire();
  try {
    const normalized: SandboxJob = {
      ...job,
      timeoutMs: Math.min(job.timeoutMs || config.sandbox.defaultTimeoutMs, config.sandbox.hardTimeoutMs),
      memoryMb: Math.min(job.memoryMb || config.sandbox.defaultMemoryMb, 512),
    };

    if (await useDocker()) return await runInDocker(normalized);

    switch (normalized.runtime) {
      case 'python': return await runPython(normalized);
      case 'node': return await runNode(normalized);
      case 'java': return await runJava(normalized);
      case 'c': return await runNative(normalized, 'c');
      case 'cpp': return await runNative(normalized, 'cpp');
      default:
        return {
          status: 'internal_error', stdout: '', stderr: `unsupported runtime: ${normalized.runtime}`,
          exitCode: null, signal: null, durationMs: 0, memoryKb: 0, truncated: false,
        };
    }
  } finally {
    release();
  }
}

export async function sandboxHealth(): Promise<Record<string, unknown>> {
  return {
    driver: config.sandbox.driver,
    dockerAvailable: config.sandbox.driver === 'docker' ? await useDocker() : await dockerAvailable().catch(() => false),
    maxConcurrent: config.sandbox.maxConcurrent,
    hardTimeoutMs: config.sandbox.hardTimeoutMs,
  };
}
