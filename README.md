# ClearWrite

ClearWrite is a calm writing app that keeps your drafts on your own computer. It helps you write, spot hard-to-read passages, and make focused improvements without moving your documents into a hosted editor. Optional AI tools can rewrite selected text, check grammar, give whole-document feedback, or turn dense paragraphs into a clearer structure; you remain in control of every change.

## What it does

- Keeps documents in a local library with autosave and revision-safe updates.
- Provides a focused editor with headings, bold, italics, links, quotes, lists, undo, and redo.
- Analyzes readability, difficult sentences, complex words, adverbs, qualifiers, passive voice, spelling, grammar, and punctuation.
- Offers safe, review-first replacements so suggestions never silently overwrite a draft.
- Imports Markdown, HTML, plain text, and Word documents and exports clean Markdown, HTML, plain text, or Word documents.
- Provides optional server-side AI actions for selected-text rewrites, synonyms, grammar, full-document Feedback, and Make Skimmable transformations.
- Runs on loopback with a health check and a macOS launch script.

## How it works

ClearWrite is a local-first Next.js application. The browser supplies the editor experience, while the local server handles document storage, analysis requests, imports, exports, and optional AI calls. Documents are stored in SQLite under `data/`; AI keys are read only by the server and are never exposed as browser variables.

AI suggestions are bounded structured responses. The app validates every candidate, shows it in a review dialog, and applies it only after the writer accepts it. If the document changes while a suggestion is being generated, the suggestion is marked stale instead of being applied to the wrong text.

## Tech stack

- Next.js 16 and React 19
- TypeScript
- Tiptap / ProseMirror editor
- SQLite with Drizzle ORM
- Zod response and request validation
- OpenAI Responses API for optional AI actions
- Vitest for unit and integration tests
- Playwright for browser smoke tests

## Setup

Requirements: Node.js 20.9 or newer and npm 10 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:4317>.

For the macOS launch flow, run:

```bash
./start.command
```

The launcher builds when needed, prepares the standalone runtime assets, starts only on loopback, waits for `/api/health`, and opens the default browser. Stop the app with `./stop.command`.

## Optional AI configuration

Put server-only settings in `.env.local`:

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_REWRITE_MODEL=
OPENAI_REVIEW_MODEL=
WRITING_EDITOR_DB_PATH=
```

The model fields may stay blank to use ClearWrite's routed defaults. Never commit `.env.local` or place the API key in a `NEXT_PUBLIC_*` variable. Without a key, local writing, analysis, document management, and import/export continue to work.

## Using ClearWrite

1. Create a document from the left rail or the File menu.
2. Write or import a draft.
3. Switch to Edit mode for readability and language findings.
4. Select text to open the inline AI actions, or use the AI Tools menu.
5. Review a suggestion before using it.
6. Switch to Feedback for a structured editorial read of the whole draft.
7. Select complete paragraphs or headings and choose Make Skimmable to preview a clearer structure before replacing the blocks.

## Project structure

```text
src/app/                 Page, styles, and API routes
src/components/          Editor, analysis, AI, and review UI
src/features/            Document, editor, analysis, import/export, and AI contracts
src/server/               Local services, AI provider boundary, settings, and persistence
tests/unit/               Fast contract and behavior tests
tests/integration/       Database and document integration tests
e2e/                     Playwright browser journeys
db/migrations/            SQLite schema migrations
docs/decisions/           Architecture decision records
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create the standalone production build |
| `npm run start` | Run the standalone production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run strict TypeScript checking |
| `npm test` | Run unit and integration tests |
| `npm run test:coverage` | Run tests with V8 coverage |
| `npm run test:e2e` | Run the Playwright browser suite |

## Privacy and local data

The default database is `data/writing-editor.sqlite`, which is ignored by Git. Runtime files, build output, test artifacts, and `.env.local` are also ignored. AI requests are made only when an AI action is requested and are sent through the server-side provider boundary with `store: false`; the local app records bounded usage metadata rather than document contents.

## Architecture notes

- [ARCHITECTURE.md](ARCHITECTURE.md) — application boundaries and persistence decisions
- [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) — provider, prompt, validation, and review contracts
- [MAKE_SKIMMABLE_ARCHITECTURE.md](MAKE_SKIMMABLE_ARCHITECTURE.md) — block transformation and replacement safety
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — product behavior and scope
- [ADR-001](docs/decisions/ADR-001-local-stack.md), [ADR-002](docs/decisions/ADR-002-ai-candidate-boundary.md), and [ADR-003](docs/decisions/ADR-003-skimmable-structured-block-replacement.md) — foundational decisions
