import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.WRITING_EDITOR_DB_PATH ?? './data/writing-editor.sqlite',
  },
});
