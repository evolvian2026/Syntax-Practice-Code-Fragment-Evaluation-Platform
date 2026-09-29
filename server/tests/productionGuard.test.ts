import { describe, expect, it } from 'vitest';
import { parseCorsOrigins } from '../src/app.js';
import { checkProductionConfig } from '../src/productionGuard.js';

const STRONG = 'a'.repeat(64);

const base = {
  env: 'production',
  jwtSecret: STRONG,
  corsOrigin: 'https://practice.example.com',
  sandbox: { driver: 'docker' },
  seedPasswords: { admin: 'a-private-admin-pass', student: 'a-private-student-pass' },
} as const;

const safeEnv = {
  JWT_SECRET: STRONG,
  SEED_ADMIN_PASSWORD: 'a-private-admin-pass',
  SEED_STUDENT_PASSWORD: 'a-private-student-pass',
};

const check = (
  overrides: Record<string, unknown> = {},
  env: Record<string, string | undefined> = safeEnv,
  seeding = false,
  uid = 1000,
) => checkProductionConfig({ ...base, ...overrides } as any, { env: env as NodeJS.ProcessEnv, seeding, uid });

describe('production guard', () => {
  it('stays out of the way in development', () => {
    const report = check({ env: 'development', jwtSecret: 'dev-only-secret-change-me' }, {});
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('accepts a safe production configuration', () => {
    expect(check().errors).toEqual([]);
  });

  it('refuses the committed fallback secret', () => {
    const report = check({ jwtSecret: 'dev-only-secret-change-me' }, { ...safeEnv, JWT_SECRET: undefined });
    expect(report.errors.join(' ')).toMatch(/JWT_SECRET is not set/);
  });

  it('refuses the fallback secret even when set explicitly', () => {
    // Copying .env.example verbatim sets JWT_SECRET to the published value.
    const report = check({ jwtSecret: 'dev-only-secret-change-me' }, { ...safeEnv, JWT_SECRET: 'dev-only-secret-change-me' });
    expect(report.errors).toHaveLength(1);
  });

  it('refuses a short secret', () => {
    const report = check({ jwtSecret: 'short' }, { ...safeEnv, JWT_SECRET: 'short' });
    expect(report.errors.join(' ')).toMatch(/at least 32/);
  });

  it('refuses to seed the passwords printed in the README', () => {
    const report = check(
      { seedPasswords: { admin: 'admin123', student: 'student123' } },
      { JWT_SECRET: STRONG },
      true,
    );
    expect(report.errors.filter((e) => /SEED_/.test(e))).toHaveLength(2);
  });

  it('only checks seed passwords when seeding', () => {
    const report = check({ seedPasswords: { admin: 'admin123', student: 'student123' } }, { JWT_SECRET: STRONG }, false);
    expect(report.errors).toEqual([]);
  });

  it('warns, but does not refuse, on an open CORS origin and a bare-host sandbox', () => {
    const report = check({ corsOrigin: '*', sandbox: { driver: 'subprocess' } });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(2);
  });

  it('treats the subprocess sandbox inside a container as the intended layout', () => {
    const report = check({ sandbox: { driver: 'subprocess' } }, { ...safeEnv, RUNNING_IN_CONTAINER: 'true' });
    expect(report.warnings).toEqual([]);
  });

  it('warns against the docker driver inside a container', () => {
    // That combination needs the Docker socket mounted into a public web app.
    const report = check({ sandbox: { driver: 'docker' } }, { ...safeEnv, RUNNING_IN_CONTAINER: 'true' });
    expect(report.warnings.join(' ')).toMatch(/root on the host/);
  });

  it('warns when running as root, where the fork-bomb backstop is not enforced', () => {
    const report = check({}, safeEnv, false, 0);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(' ')).toMatch(/RLIMIT_NPROC/);
  });

  it('does not warn about root for an unprivileged user', () => {
    expect(check({}, safeEnv, false, 1000).warnings.join(' ')).not.toMatch(/root/i);
  });
});

describe('CORS_ORIGIN parsing', () => {
  it('allows any origin for *', () => {
    expect(parseCorsOrigins('*')).toBe(true);
  });

  it('tolerates the spaces and trailing slashes a pasted value tends to have', () => {
    expect(parseCorsOrigins(' https://a.vercel.app/ , https://practice.example.com//,'))
      .toEqual(['https://a.vercel.app', 'https://practice.example.com']);
  });
});
