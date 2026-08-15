import type { AppDatabase } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { DialectSchema, type Dialect } from '@/features/ai/dialect';

const DIALECT_KEY = 'dialect';
const DEFAULT_DIALECT: Dialect = 'us';

export function getDialect(db: AppDatabase): Dialect {
  const row = db.select().from(settings).where(eq(settings.key, DIALECT_KEY)).get();
  if (!row) return DEFAULT_DIALECT;
  const parsed = DialectSchema.safeParse(JSON.parse(row.valueJson));
  return parsed.success ? parsed.data : DEFAULT_DIALECT;
}

export function setDialect(db: AppDatabase, value: unknown): Dialect {
  const dialect = DialectSchema.parse(value);
  db.insert(settings).values({ key: DIALECT_KEY, valueJson: JSON.stringify(dialect), updatedAt: new Date() }).onConflictDoUpdate({ target: settings.key, set: { valueJson: JSON.stringify(dialect), updatedAt: new Date() } }).run();
  return dialect;
}
