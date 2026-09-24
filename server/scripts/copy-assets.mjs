/**
 * Copies every non-TypeScript file under src/ into dist/, keeping its path.
 *
 * `tsc` emits only JavaScript, but the server reads some files relative to its
 * own modules at runtime: the schema, and the Python sandbox harnesses. Without
 * this step the compiled build crashed on boot looking for dist/db/schema.sql,
 * and nothing noticed because development and every test run from src/.
 *
 * The list is discovered rather than written down, so an asset added later is
 * copied without anyone having to remember this file exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(serverRoot, 'src');
const dist = path.join(serverRoot, 'dist');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let copied = 0;
for (const file of walk(src)) {
  if (file.endsWith('.ts')) continue;
  const target = path.join(dist, path.relative(src, file));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
  copied += 1;
}

console.log(`copied ${copied} runtime asset${copied === 1 ? '' : 's'} into dist/`);
