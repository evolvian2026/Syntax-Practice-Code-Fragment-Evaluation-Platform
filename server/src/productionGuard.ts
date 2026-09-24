import { config, type AppConfig } from './config.js';

/**
 * Refuses to run in production on settings that are only safe on a laptop.
 *
 * The defaults exist so `npm run dev` works with no setup, and every one of
 * them is committed to the repository. In production that turns into a hole:
 * the fallback JWT secret lets anyone mint an admin token, and the demo
 * passwords are printed in the README. Silently falling back is how those
 * reach a public URL, so production fails closed instead.
 */

const DEFAULT_JWT_SECRET = 'dev-only-secret-change-me';
const PUBLISHED_PASSWORDS = new Set(['admin123', 'student123']);
const MIN_SECRET_LENGTH = 32;

export interface GuardReport {
  /** Settings that make production unsafe. The process must not start. */
  errors: string[];
  /** Settings worth a second look, but not unsafe on their own. */
  warnings: string[];
}

export function checkProductionConfig(
  cfg: Pick<AppConfig, 'env' | 'jwtSecret' | 'corsOrigin' | 'sandbox' | 'seedPasswords'>,
  opts: { seeding?: boolean; env?: NodeJS.ProcessEnv; uid?: number } = {},
): GuardReport {
  const report: GuardReport = { errors: [], warnings: [] };
  if (cfg.env !== 'production') return report;

  const env = opts.env ?? process.env;

  if (!env.JWT_SECRET || cfg.jwtSecret === DEFAULT_JWT_SECRET) {
    report.errors.push(
      'JWT_SECRET is not set. The fallback is committed to the repository, so anyone could '
      + 'sign an admin token. Generate one with: openssl rand -hex 32',
    );
  } else if (cfg.jwtSecret.length < MIN_SECRET_LENGTH) {
    report.errors.push(
      `JWT_SECRET is ${cfg.jwtSecret.length} characters; use at least ${MIN_SECRET_LENGTH}. `
      + 'Generate one with: openssl rand -hex 32',
    );
  }

  if (opts.seeding) {
    for (const [role, variable] of [['admin', 'SEED_ADMIN_PASSWORD'], ['student', 'SEED_STUDENT_PASSWORD']] as const) {
      const value = cfg.seedPasswords[role];
      if (!env[variable] || PUBLISHED_PASSWORDS.has(value)) {
        report.errors.push(
          `${variable} is not set, so the seeded ${role} accounts would use the password printed `
          + 'in the README. Set it to something private before seeding.',
        );
      }
    }
  }

  // The sandbox removes os.fork from student code, and behind that sets
  // RLIMIT_NPROC as a backstop against fork bombs. The kernel does not enforce
  // RLIMIT_NPROC for root, so as root that second line is silently off.
  const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : -1);
  if (uid === 0) {
    report.warnings.push(
      'Running as root. The sandbox limits student processes with RLIMIT_NPROC, which the '
      + 'kernel does not enforce for root, so fork-bomb protection loses its backstop. Run as '
      + 'an unprivileged user; the provided Dockerfile does.',
    );
  }

  if (cfg.corsOrigin === '*') {
    report.warnings.push(
      'CORS_ORIGIN is *. The API uses bearer tokens rather than cookies, so this is not an '
      + 'exploit on its own, but set it to the site origin once you know it.',
    );
  }

  // Inside a container the subprocess sandbox is the right choice: the
  // container is the outer boundary. The docker driver would need the Docker
  // socket mounted into a public web app, which hands it root on the host — a
  // far bigger hole than the one it closes.
  const inContainer = env.RUNNING_IN_CONTAINER === 'true';
  if (cfg.sandbox.driver === 'subprocess' && !inContainer) {
    report.warnings.push(
      'Student code runs as a hardened child process directly on this host. Run the app '
      + 'in a container (see the Dockerfile) so the container is an outer boundary, or on a '
      + 'dedicated VM use SANDBOX_DRIVER=docker. Never mount the Docker socket into the app.',
    );
  }
  if (cfg.sandbox.driver === 'docker' && inContainer) {
    report.warnings.push(
      'SANDBOX_DRIVER=docker inside a container means the Docker socket is mounted into the '
      + 'app, which gives it root on the host. Use SANDBOX_DRIVER=subprocess in a container.',
    );
  }

  return report;
}

/** Prints the report and exits if production is unsafe. */
export function enforceProductionGuard(opts: { seeding?: boolean } = {}): void {
  const { errors, warnings } = checkProductionConfig(config, opts);
  for (const warning of warnings) console.warn(`[config] warning: ${warning}`);
  if (errors.length === 0) return;

  console.error('\nRefusing to start: this configuration is unsafe for production.\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nSee docs/DEPLOYMENT.md.\n');
  process.exit(1);
}
