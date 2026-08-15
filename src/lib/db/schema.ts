import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  contentJson: text('content_json').notNull(),
  plainText: text('plain_text').notNull().default(''),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

export const documentRevisions = sqliteTable('document_revisions', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  contentJson: text('content_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  reason: text('reason').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
});
