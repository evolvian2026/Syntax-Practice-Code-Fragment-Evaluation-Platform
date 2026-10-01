/**
 * A read-only look inside the database, for when there is no sqlite3 client
 * to hand — inside the container, for one.
 *
 *   node server/scripts/db.mjs                 every table, with its row count
 *   node server/scripts/db.mjs <table>         its columns and first rows
 *   node server/scripts/db.mjs <table> <n>     its columns and first n rows
 *
 * Opens the file read-only, so it is safe against a running server. Any column
 * whose name suggests a secret is masked rather than printed.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DATABASE_FILE ?? path.resolve(here, '..', '..', 'data', 'syntax-practice.db');
const SECRET = /password|hash|secret|token|api_?key/i;

let db;
try {
  db = new Database(file, { readonly: true, fileMustExist: true });
} catch {
  console.error(`No database at ${file}. Run \`npm run setup\` first, or set DATABASE_FILE.`);
  process.exit(1);
}

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all().map((row) => row.name);

const [table, limitArg] = process.argv.slice(2);

if (!table) {
  console.log(`${file}\n`);
  const width = Math.max(...tables.map((name) => name.length));
  for (const name of tables) {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
    console.log(`  ${name.padEnd(width)}  ${String(n).padStart(6)}`);
  }
  console.log(`\n${tables.length} tables. Show one with: node server/scripts/db.mjs <table>`);
  process.exit(0);
}

if (!tables.includes(table)) {
  console.error(`No table "${table}". Run without arguments to list them.`);
  process.exit(1);
}

const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
console.log(`${table}\n`);
for (const c of columns) {
  console.log(`  ${c.name.padEnd(24)} ${(c.type || 'ANY').padEnd(9)} ${c.pk ? 'primary key' : c.notnull ? 'not null' : ''}`);
}

const limit = Math.min(Math.max(Number(limitArg) || 5, 1), 200);
const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ?`).all(limit).map((row) => {
  const shown = {};
  for (const [key, value] of Object.entries(row)) {
    if (SECRET.test(key)) shown[key] = '••••••';
    else if (typeof value === 'string' && value.length > 60) shown[key] = `${value.slice(0, 57)}…`;
    else shown[key] = value;
  }
  return shown;
});
console.log(`\nfirst ${rows.length} row${rows.length === 1 ? '' : 's'}:`);
console.table(rows);
