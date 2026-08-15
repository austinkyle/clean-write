CREATE TABLE IF NOT EXISTS "documents" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "content_json" text NOT NULL,
  "plain_text" text NOT NULL DEFAULT '',
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL,
  "deleted_at" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "content_json" text NOT NULL,
  "created_at" integer NOT NULL,
  "reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value_json" text NOT NULL,
  "updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_state" (
  "key" text PRIMARY KEY NOT NULL,
  "value_json" text NOT NULL
);
