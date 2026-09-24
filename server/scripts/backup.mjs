/**
 * Online backup of the SQLite database, safe while the server is running.
 *
 *   node server/scripts/backup.mjs [destination]
 *
 * Copying the .db file directly while the app writes to it can capture a torn
 * page, and misses whatever is still in the -wal file. SQLite's backup API
 * produces a consistent snapshot instead. The result is checked with
 * integrity_check before it is reported as good.
 */
import path from 'node:path';
import Database from 'better-sqlite3';

const source = process.env.DATABASE_FILE;
if (!source) {
  console.error('DATABASE_FILE is not set.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destination = process.argv[2]
  ?? path.join(path.dirname(source), `backup-${stamp}.db`);

const db = new Database(source, { readonly: true, fileMustExist: true });
await db.backup(destination);
db.close();

const copy = new Database(destination, { readonly: true });
const integrity = copy.pragma('integrity_check', { simple: true });
const questions = copy.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
const submissions = copy.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
copy.close();

if (integrity !== 'ok') {
  console.error(`Backup written to ${destination} but failed integrity_check: ${integrity}`);
  process.exit(1);
}
console.log(`✓ ${destination} — ${questions} questions, ${submissions} submissions, integrity ok`);
