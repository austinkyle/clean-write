import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import type { AppDatabase } from '@/lib/db/client';
import { appState, documentRevisions, documents } from '@/lib/db/schema';
import {
  DEFAULT_DOCUMENT_CONTENT,
  type DocumentContent,
  parseDocumentContent,
  toPlainText,
} from '@/features/documents/content';

const DocumentIdSchema = z.string().uuid();
const TitleSchema = z.string().trim().max(200);
const LAST_OPENED_KEY = 'lastOpenedDocumentId';
export const REVISION_RETENTION_LIMIT = 50;

export type DocumentRecord = {
  id: string;
  title: string;
  content: DocumentContent;
  plainText: string;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
};

function validateId(id: string) {
  const parsed = DocumentIdSchema.safeParse(id);
  if (!parsed.success) throw new Error('Invalid document id');
  return parsed.data;
}

function normalizeTitle(title?: string) {
  const parsed = TitleSchema.safeParse(title ?? '');
  if (!parsed.success) throw new Error('Invalid document title');
  return parsed.data || 'Untitled';
}

function serializeContent(content: DocumentContent) {
  return JSON.stringify(content);
}

function mapDocument(row: typeof documents.$inferSelect): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    content: parseDocumentContent(JSON.parse(row.contentJson)),
    plainText: row.plainText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

function getActiveRow(db: AppDatabase, id: string) {
  const validatedId = validateId(id);
  const row = db.select().from(documents).where(and(eq(documents.id, validatedId), isNull(documents.deletedAt))).get();
  if (!row) throw new Error('Document not found');
  return row;
}

function pruneRevisions(db: AppDatabase, documentId: string) {
  const stale = db.select({ id: documentRevisions.id }).from(documentRevisions).where(eq(documentRevisions.documentId, documentId)).orderBy(desc(documentRevisions.createdAt), desc(documentRevisions.id)).all().slice(REVISION_RETENTION_LIMIT);
  if (stale.length) db.delete(documentRevisions).where(inArray(documentRevisions.id, stale.map((revision) => revision.id))).run();
}

export function createDocument(db: AppDatabase, input: { title?: string; content?: unknown } = {}) {
  const content = input.content === undefined ? DEFAULT_DOCUMENT_CONTENT : parseDocumentContent(input.content);
  const now = new Date();
  const row = {
    id: randomUUID(),
    title: normalizeTitle(input.title),
    contentJson: serializeContent(content),
    plainText: toPlainText(content),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    deletedAt: null,
  };

  db.insert(documents).values(row).run();
  setLastOpenedDocument(db, row.id);
  return mapDocument(row);
}

export function listDocuments(db: AppDatabase) {
  return db.select().from(documents).where(isNull(documents.deletedAt)).orderBy(desc(documents.updatedAt)).all().map(mapDocument);
}

export function getDocument(db: AppDatabase, id: string) {
  return mapDocument(getActiveRow(db, id));
}

export function updateDocumentContent(db: AppDatabase, id: string, input: unknown, requestedRevision?: number) {
  const row = getActiveRow(db, id);
  const content = parseDocumentContent(input);
  const now = new Date();
  const contentJson = serializeContent(content);
  const revision = requestedRevision ?? row.revision + 1;
  if (!Number.isInteger(revision) || revision < 0) throw new Error('Invalid document revision');
  if (revision <= row.revision) return mapDocument(row);

  db.transaction((transaction) => {
    transaction.update(documents).set({ contentJson, plainText: toPlainText(content), updatedAt: now, revision }).where(eq(documents.id, row.id)).run();
    transaction.insert(documentRevisions).values({
      id: randomUUID(),
      documentId: row.id,
      contentJson,
      createdAt: now,
      reason: 'autosave',
    }).run();
    pruneRevisions(transaction as unknown as AppDatabase, row.id);
  });

  return getDocument(db, row.id);
}

export function renameDocument(db: AppDatabase, id: string, title: string) {
  const row = getActiveRow(db, id);
  db.update(documents).set({ title: normalizeTitle(title), updatedAt: new Date() }).where(eq(documents.id, row.id)).run();
  return getDocument(db, row.id);
}

export function duplicateDocument(db: AppDatabase, id: string) {
  const source = getActiveRow(db, id);
  const now = new Date();
  const copy = {
    id: randomUUID(),
    title: `${source.title} Copy`.slice(0, 200),
    contentJson: source.contentJson,
    plainText: source.plainText,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    deletedAt: null,
  };
  db.insert(documents).values(copy).run();
  setLastOpenedDocument(db, copy.id);
  return mapDocument(copy);
}

export function deleteDocument(db: AppDatabase, id: string) {
  const row = getActiveRow(db, id);
  db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, row.id)).run();
  const lastOpened = getLastOpenedDocumentId(db);
  if (lastOpened === row.id) {
    db.insert(appState).values({ key: LAST_OPENED_KEY, valueJson: JSON.stringify(null) }).onConflictDoUpdate({
      target: appState.key,
      set: { valueJson: JSON.stringify(null) },
    }).run();
  }
}

export function setLastOpenedDocument(db: AppDatabase, id: string) {
  const row = getActiveRow(db, id);
  db.insert(appState).values({ key: LAST_OPENED_KEY, valueJson: JSON.stringify(row.id) }).onConflictDoUpdate({
    target: appState.key,
    set: { valueJson: JSON.stringify(row.id) },
  }).run();
}

export function getLastOpenedDocumentId(db: AppDatabase) {
  const state = db.select().from(appState).where(eq(appState.key, LAST_OPENED_KEY)).get();
  if (!state) return null;
  const parsed = z.string().uuid().nullable().safeParse(JSON.parse(state.valueJson));
  return parsed.success ? parsed.data : null;
}
