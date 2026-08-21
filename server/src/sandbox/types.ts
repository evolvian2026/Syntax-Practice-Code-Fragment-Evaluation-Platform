/** Contract shared by every sandbox driver. */
export interface SandboxJob {
  /** Language runtime key: python | node | java | c | cpp */
  runtime: 'python' | 'node' | 'java' | 'c' | 'cpp';
  /** Full, already-assembled source program. */
  source: string;
  stdin?: string;
  timeoutMs: number;
  memoryMb: number;
  /** Extra files written next to the program (name -> content). */
  files?: Record<string, string>;
}

export type SandboxStatus =
  | 'ok'
  | 'compile_error'
  | 'runtime_error'
  | 'timeout'
  | 'memory_exceeded'
  | 'restricted'
  | 'internal_error';

export interface SandboxResult {
  status: SandboxStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  memoryKb: number;
  truncated: boolean;
  /** Structured detail some runtimes emit (e.g. python error class/line). */
  detail?: Record<string, unknown>;
}

export interface SandboxDriver {
  readonly name: string;
  isAvailable(runtime: SandboxJob['runtime']): Promise<boolean>;
  run(job: SandboxJob): Promise<SandboxResult>;
}
