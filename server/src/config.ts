import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');           // repo root
export const SERVER_ROOT = path.resolve(here, '..');           // /server

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  databaseFile: process.env.DATABASE_FILE ?? path.join(ROOT, 'data', 'syntax-practice.db'),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',

  /** Execution sandbox */
  sandbox: {
    /** 'subprocess' (default, hardened child process) or 'docker' (container per run). */
    driver: (process.env.SANDBOX_DRIVER ?? 'subprocess') as 'subprocess' | 'docker',
    workDir: process.env.SANDBOX_WORKDIR ?? path.join(ROOT, '.tmp', 'sandbox'),
    defaultTimeoutMs: int('SANDBOX_TIMEOUT_MS', 4000),
    hardTimeoutMs: int('SANDBOX_HARD_TIMEOUT_MS', 15000),
    defaultMemoryMb: int('SANDBOX_MEMORY_MB', 128),
    maxOutputBytes: int('SANDBOX_MAX_OUTPUT', 64 * 1024),
    maxConcurrent: int('SANDBOX_MAX_CONCURRENT', 4),
    pythonBin: process.env.PYTHON_BIN ?? 'python3',
    nodeBin: process.env.NODE_BIN ?? process.execPath,
    javacBin: process.env.JAVAC_BIN ?? 'javac',
    javaBin: process.env.JAVA_BIN ?? 'java',
    gccBin: process.env.GCC_BIN ?? 'gcc',
    gppBin: process.env.GPP_BIN ?? 'g++',
    dockerImagePython: process.env.DOCKER_IMAGE_PYTHON ?? 'python:3.11-alpine',
    dockerImageNode: process.env.DOCKER_IMAGE_NODE ?? 'node:20-alpine',
    dockerImageJava: process.env.DOCKER_IMAGE_JAVA ?? 'eclipse-temurin:21-jdk-alpine',
    dockerImageC: process.env.DOCKER_IMAGE_C ?? 'gcc:13',
  },

  /** Scoring / gamification */
  scoring: {
    xpPerDifficulty: { Easy: 10, Medium: 20, Hard: 35 } as Record<string, number>,
    hintPenaltyCap: int('HINT_PENALTY_CAP', 60),      // max % that hints can deduct
    solutionRevealScore: int('SOLUTION_REVEAL_SCORE', 0),
    levelXpStep: int('LEVEL_XP_STEP', 250),
  },

  ai: {
    enabled: bool('AI_ENABLED', true),
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-opus-5',
    maxTokens: int('AI_MAX_TOKENS', 1200),
  },

  seedPasswords: {
    admin: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
    student: process.env.SEED_STUDENT_PASSWORD ?? 'student123',
  },
};

export type AppConfig = typeof config;
