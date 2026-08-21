/**
 * Boots the platform for the end-to-end run: a throwaway database, the full
 * seed (taxonomy, datasets, badges, learning paths, 142 verified questions),
 * then the API serving the production client bundle.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.tmp', 'e2e');
const dbFile = path.join(dataDir, 'e2e.db');

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: process.env.E2E_PORT ?? '4300',
  DATABASE_FILE: dbFile,
  JWT_SECRET: 'e2e-secret',
  AI_ENABLED: 'false',
};

const run = (label, args) => {
  console.log(`[e2e] ${label}…`);
  const result = spawnSync('npx', args, { cwd: path.join(root, 'server'), env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[e2e] ${label} failed`);
    process.exit(1);
  }
};

if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  console.log('[e2e] building the client bundle…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: path.join(root, 'client'), env: process.env, stdio: 'inherit' });
  if (build.status !== 0) process.exit(1);
}

run('migrating', ['tsx', 'src/db/migrate.ts']);
run('seeding', ['tsx', 'src/seed/run.ts']);

console.log('[e2e] starting the server…');
const server = spawnSync('npx', ['tsx', 'src/index.ts'], {
  cwd: path.join(root, 'server'),
  env,
  stdio: 'inherit',
});
process.exit(server.status ?? 0);
