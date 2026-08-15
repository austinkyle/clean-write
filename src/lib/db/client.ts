import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';

import * as schema from './schema';

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function getDatabasePath(explicitPath?: string): string {
  return explicitPath ?? process.env.WRITING_EDITOR_DB_PATH ?? path.join(process.cwd(), 'data', 'writing-editor.sqlite');
}

export function openDatabase(explicitPath?: string) {
  const databasePath = getDatabasePath(explicitPath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });

  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 3000');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'db', 'migrations') });

  return { db, sqlite, databasePath };
}

let appDatabase: ReturnType<typeof openDatabase> | undefined;

export function getDatabase() {
  appDatabase ??= openDatabase();
  return appDatabase;
}

export function resetDatabaseForTests() {
  appDatabase?.sqlite.close();
  appDatabase = undefined;
}
