import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '@/lib/db/client';
import { documentRevisions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  createDocument,
  deleteDocument,
  duplicateDocument,
  getDocument,
  listDocuments,
  renameDocument,
  setLastOpenedDocument,
  updateDocumentContent,
} from '@/server/documents/service';

const handles: ReturnType<typeof openDatabase>[] = [];

function createTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clearwrite-documents-'));
  const handle = openDatabase(path.join(directory, 'test.sqlite'));
  handles.push(handle);
  return handle.db;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.sqlite.close();
});

describe('document persistence service', () => {
  it('creates and reads a valid canonical Tiptap document', () => {
    const db = createTestDatabase();
    const created = createDocument(db, { title: 'First draft' });
    const loaded = getDocument(db, created.id);

    expect(created.title).toBe('First draft');
    expect(loaded.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(loaded.plainText).toBe('');
  });

  it('updates content, renames, orders by updated time, and restores last opened', () => {
    const db = createTestDatabase();
    const first = createDocument(db, { title: 'First' });
    const second = createDocument(db, { title: 'Second' });

    updateDocumentContent(db, first.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A saved thought.' }] }],
    });
    renameDocument(db, first.id, 'Renamed first');
    setLastOpenedDocument(db, first.id);

    expect(getDocument(db, first.id).title).toBe('Renamed first');
    expect(getDocument(db, first.id).plainText).toBe('A saved thought.');
    expect(listDocuments(db).map((document) => document.id)).toEqual([first.id, second.id]);
  });

  it('duplicates independently and deletes only the selected document', () => {
    const db = createTestDatabase();
    const original = createDocument(db, { title: 'Original' });
    updateDocumentContent(db, original.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original text' }] }],
    });

    const copy = duplicateDocument(db, original.id);
    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Original Copy');
    expect(copy.content).toEqual(getDocument(db, original.id).content);

    updateDocumentContent(db, copy.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed copy' }] }],
    });
    expect(getDocument(db, original.id).plainText).toBe('Original text');

    deleteDocument(db, copy.id);
    expect(listDocuments(db).map((document) => document.id)).toEqual([original.id]);
    expect(() => getDocument(db, copy.id)).toThrow('Document not found');
  });

  it('rejects malformed IDs and unsupported editor content', () => {
    const db = createTestDatabase();
    expect(() => getDocument(db, 'not-a-uuid')).toThrow('Invalid document id');
    expect(() => updateDocumentContent(db, createDocument(db, {}).id, { type: 'paragraph' })).toThrow('Invalid document content');
  });

  it('persists only canonical editor JSON and rejects analysis metadata', () => {
    const db = createTestDatabase();
    const document = createDocument(db, {});
    updateDocumentContent(db, document.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }, { type: 'hardBreak' }, { type: 'text', text: 'after' }] }] });
    expect(getDocument(db, document.id).content).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }, { type: 'hardBreak' }, { type: 'text', text: 'after' }] }] });
    expect(() => updateDocumentContent(db, document.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'analysis-highlight' }] }] }] })).toThrow('Invalid document content');
  });

  it('keeps the newest content when rapid saves arrive in sequence', () => {
    const db = createTestDatabase();
    const document = createDocument(db, { title: 'Race test' });
    const firstContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older content' }] }] };
    const newestContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Newest content' }] }] };

    updateDocumentContent(db, document.id, firstContent);
    updateDocumentContent(db, document.id, newestContent);

    expect(getDocument(db, document.id).plainText).toBe('Newest content');
  });

  it('prunes revision snapshots to the newest fifty while keeping current content', () => {
    const db = createTestDatabase();
    const document = createDocument(db, {});
    for (let index = 1; index <= 55; index += 1) updateDocumentContent(db, document.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Revision ${index}` }] }] }, index);
    expect(db.select().from(documentRevisions).where(eq(documentRevisions.documentId, document.id)).all()).toHaveLength(50);
    expect(getDocument(db, document.id).plainText).toBe('Revision 55');
  });
});
