import type { LanguageAdapter } from '../types.js';
import { cAdapter, cppAdapter, javaAdapter } from './clike.js';
import { javascriptAdapter } from './javascript.js';
import { cssAdapter, htmlAdapter } from './markup.js';
import { pythonAdapter } from './python.js';
import { sqlAdapter } from './sql.js';

/**
 * Language registry (§6, §29).
 *
 * Adding a language means writing one adapter and registering it here - the
 * engine, API, admin builder and student UI need no changes. Aliases let a
 * dialect (postgresql, mariadb, sql) reuse an existing adapter.
 */
const adapters = new Map<string, LanguageAdapter>();

export function registerAdapter(adapter: LanguageAdapter, aliases: string[] = []): void {
  adapters.set(adapter.slug, adapter);
  for (const alias of aliases) adapters.set(alias, adapter);
}

registerAdapter(pythonAdapter, ['py', 'python3']);
registerAdapter(sqlAdapter, ['sql', 'mariadb', 'postgresql', 'postgres']);
registerAdapter(javascriptAdapter, ['js', 'nodejs', 'node']);
registerAdapter(htmlAdapter, ['html5']);
registerAdapter(cssAdapter, ['css3']);
registerAdapter(javaAdapter);
registerAdapter(cAdapter);
registerAdapter(cppAdapter, ['c++', 'cplusplus']);

export function getAdapter(languageSlug: string): LanguageAdapter {
  const adapter = adapters.get(languageSlug.toLowerCase());
  if (!adapter) {
    throw new UnsupportedLanguageError(languageSlug);
  }
  return adapter;
}

export function hasAdapter(languageSlug: string): boolean {
  return adapters.has(languageSlug.toLowerCase());
}

export function listAdapters(): LanguageAdapter[] {
  return [...new Set(adapters.values())];
}

export class UnsupportedLanguageError extends Error {
  constructor(public readonly slug: string) {
    super(`No evaluation adapter is registered for language "${slug}".`);
    this.name = 'UnsupportedLanguageError';
  }
}
