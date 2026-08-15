import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '@/lib/db/client';
import { getDialect, setDialect } from '@/server/settings/service';

const openHandles: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.sqlite.close();
});

describe('local SQLite foundation', () => {
  it('creates the database directory, applies the foundation migration, and enables safe pragmas', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'clearwrite-db-'));
    const databasePath = path.join(tempDirectory, 'nested', 'writing-editor.sqlite');

    const handle = openDatabase(databasePath);
    openHandles.push(handle);

    expect(fs.existsSync(databasePath)).toBe(true);
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);

    const tables = handle.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'documents',
      'document_revisions',
      'settings',
      'app_state',
    ]));
  });

  it('persists the selected writing dialect in local settings', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'clearwrite-settings-'));
    const handle = openDatabase(path.join(tempDirectory, 'writing-editor.sqlite'));
    openHandles.push(handle);

    expect(getDialect(handle.db)).toBe('us');
    expect(setDialect(handle.db, 'british')).toBe('british');
    expect(getDialect(handle.db)).toBe('british');
  });
});
