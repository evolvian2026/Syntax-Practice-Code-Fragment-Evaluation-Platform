/**
 * Container entrypoint: migrate, seed an empty database, then serve.
 *
 * Seeding runs only when the database holds no questions. It re-runs every
 * reference solution through the sandbox, so doing it on each restart would be
 * slow, and on a live deployment it could overwrite questions an admin has
 * since edited.
 *
 * Each step is a child process so a step that calls process.exit cannot take
 * the entrypoint down with it, and the server is exec'd last as the process
 * the container's signals reach.
 */
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = (file) => path.join(serverRoot, 'dist', file);

function step(label, file) {
  console.log(`[entrypoint] ${label}`);
  const result = spawnSync(process.execPath, [dist(file)], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`[entrypoint] ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function questionCount() {
  const file = process.env.DATABASE_FILE;
  const conn = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return conn.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  } finally {
    conn.close();
  }
}

step('applying schema', 'db/migrate.js');

const existing = questionCount();
if (existing === 0) {
  step('empty database — seeding the question bank', 'seed/run.js');
} else {
  console.log(`[entrypoint] ${existing} questions present — not seeding`);
}

console.log('[entrypoint] starting server');
const server = spawn(process.execPath, [dist('index.js')], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
