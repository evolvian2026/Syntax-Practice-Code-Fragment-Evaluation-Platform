/**
 * Container entrypoint: migrate, seed until a seed has completed, then serve.
 *
 * Whether to seed is decided by a marker the seed writes when it reaches the
 * end — not by whether any questions exist. A seed interrupted part-way (a
 * container killed by a health check while it ran, say) leaves some questions
 * behind; counting them would skip seeding forever and serve a partial bank.
 * Re-seeding is safe: it upserts by question id and replaces each question's
 * hints, tests and solutions rather than appending.
 *
 * A seed that finishes with some questions failing — a toolchain left out of
 * the image with TOOLCHAINS=false, for example — is reported and the server
 * starts anyway. Failing the container instead would only restart it into a
 * loop, and those questions are simply absent from the bank.
 *
 * Each step is a child process so a step that calls process.exit cannot take
 * the entrypoint down with it, and the server receives the container's signals.
 */
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (file) => path.join(serverRoot, 'dist', file);

function run(label, file) {
  console.log(`[entrypoint] ${label}`);
  return spawnSync(process.execPath, [dist(file)], { stdio: 'inherit', env: process.env }).status;
}

function readState() {
  const conn = new Database(process.env.DATABASE_FILE, { readonly: true, fileMustExist: true });
  try {
    const seeded = conn.prepare("SELECT value FROM schema_meta WHERE key = 'seeded_at'").get();
    const questions = conn.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
    return { seededAt: seeded?.value ?? null, questions };
  } finally {
    conn.close();
  }
}

if (run('applying schema', 'db/migrate.js') !== 0) {
  console.error('[entrypoint] the schema could not be applied — see the error above');
  process.exit(1);
}

const before = readState();
if (before.seededAt) {
  console.log(`[entrypoint] seeded at ${before.seededAt} (${before.questions} questions) — not seeding`);
} else {
  const status = run(
    before.questions > 0 ? `resuming an unfinished seed (${before.questions} questions so far)` : 'seeding the question bank',
    'seed/run.js',
  );
  const after = readState();
  if (!after.seededAt) {
    // The seed itself refused or crashed — for instance the production guard
    // rejecting the seed passwords. Nothing to serve.
    console.error(`[entrypoint] seeding did not complete (exit ${status}) — see the error above`);
    process.exit(1);
  }
  if (status !== 0) {
    console.warn(
      `[entrypoint] WARNING: seeding finished but some questions failed verification (listed above); `
      + `serving the ${after.questions} that passed. Once the cause is fixed, add the rest with `
      + `\`docker compose exec app node server/dist/seed/run.js\` — seeding is safe to repeat.`,
    );
  }
}

console.log('[entrypoint] starting server');
const server = spawn(process.execPath, [dist('index.js')], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
