# ADR-001: Local Next.js, Tiptap, and SQLite stack

## Status

Accepted

## Context

CleanWrite is a single-user macOS writing application that must run locally, feel immediate while typing, persist without a hosted service, and keep future AI credentials server-side. The first implementation phase needs a small, dependable foundation that can grow into the approved editor and analysis architecture.

## Decision

Use one Next.js App Router process bound to `127.0.0.1`, React and TypeScript for the application, Tiptap/ProseMirror for the rich-text editor in a later phase, SQLite via `better-sqlite3` and Drizzle for local persistence, Zod at input/AI boundaries, Vitest for unit/integration tests, and Playwright for browser acceptance tests.

## Alternatives considered

- **Electron:** rejected because the user explicitly wants the normal browser and it adds packaging/runtime complexity.
- **Cloud database or hosted backend:** rejected because the application is personal, local, and must work without external services.
- **Browser localStorage as the source of truth:** rejected because document history and structured content need transactional persistence and a clear backup location.
- **A distributed service architecture:** rejected because one local user and one process do not justify queues, service discovery, or operational overhead.

## Consequences

- The database file and runtime state are local and must be excluded from Git.
- Server routes can access future provider credentials without sending them to browser JavaScript.
- The application remains easy to launch from Finder with app-owned lifecycle scripts.
- Tiptap and AI provider dependencies are introduced when their implementation phases begin; Phase 0 does not prematurely build those features.
