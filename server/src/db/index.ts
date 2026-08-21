import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

/**
 * Application database handle.
 *
 * SQLite is used as the default engine so the platform runs with zero external
 * services. All access goes through this module and the repositories in
 * `src/db/repositories`, so swapping in PostgreSQL/MySQL means re-implementing
 * one layer rather than touching feature code (see docs/DATABASE.md).
 */
export function db(): Database.Database {
  if (instance) return instance;
  const file = config.databaseFile;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  return instance;
}

export function schemaSql(): string {
  return fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
}

/** Creates every table if missing. Safe to call repeatedly. */
export function migrate(target: Database.Database = db()): void {
  target.exec(schemaSql());
  target
    .prepare(`INSERT INTO schema_meta(key, value) VALUES ('version', '1')
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run();
}

export function resetDatabase(target: Database.Database = db()): void {
  const tables = target
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  target.pragma('foreign_keys = OFF');
  for (const t of tables) target.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  target.pragma('foreign_keys = ON');
  migrate(target);
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}

/** JSON helpers — every JSON column in the schema is stored as TEXT. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
