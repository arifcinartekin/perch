import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

// Migrations live in apps/server/drizzle. From source that's two levels up from
// this file; in the bundled build (dist/main.js) it's one level up.
function migrationsFolder(): string {
  const candidates = [
    process.env.PERCH_MIGRATIONS_DIR,
    fileURLToPath(new URL('../../drizzle', import.meta.url)),
    fileURLToPath(new URL('../drizzle', import.meta.url)),
  ];
  const found = candidates.find((p) => p && existsSync(`${p}/meta/_journal.json`));
  if (!found) throw new Error('Database migrations not found; set PERCH_MIGRATIONS_DIR');
  return found;
}

export function openDatabase(path: string): { db: DB; close: () => void } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // Deleted rows are overwritten, not left readable in free pages on disk.
  sqlite.pragma('secure_delete = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return { db, close: () => sqlite.close() };
}
