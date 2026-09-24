/**
 * Boots the *compiled* server and checks it answers.
 *
 * Every other test runs from src/ through tsx, so none of them can see a
 * problem that exists only in dist/. One did: tsc does not copy the schema or
 * the Python harnesses, and the production build crashed on boot for as long
 * as the project existed without anything failing. This is the check that
 * would have caught it.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-smoke-'));
const port = String(4700 + Math.floor(Math.random() * 200));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: port,
  DATABASE_FILE: path.join(dir, 'smoke.db'),
  SANDBOX_WORKDIR: path.join(dir, 'sandbox'),
  JWT_SECRET: 'smoke-test-secret-'.padEnd(64, 'x'),
  AI_ENABLED: 'false',
};

const fail = (message) => {
  console.error(`✗ compiled build: ${message}`);
  process.exitCode = 1;
};

for (const asset of ['db/schema.sql', 'sandbox/harness/py_exec.py', 'sandbox/harness/py_ast.py']) {
  if (!fs.existsSync(path.join(serverRoot, 'dist', asset))) fail(`dist/${asset} is missing`);
}

const migrate = spawnSync(process.execPath, ['dist/db/migrate.js'], { cwd: serverRoot, env, encoding: 'utf8' });
if (migrate.status !== 0) fail(`migrate exited ${migrate.status}\n${migrate.stderr}`);

const server = spawn(process.execPath, ['dist/index.js'], { cwd: serverRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (d) => { output += d; });
server.stderr.on('data', (d) => { output += d; });

let healthy = false;
for (let i = 0; i < 40 && process.exitCode !== 1; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (res.ok && (await res.json()).env === 'production') { healthy = true; break; }
  } catch { /* not listening yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

server.kill('SIGTERM');
fs.rmSync(dir, { recursive: true, force: true });

if (!healthy) fail(`did not become healthy\n${output}`);
if (process.exitCode !== 1) console.log('✓ compiled build boots and answers /api/health in production mode');
