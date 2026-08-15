# Architecture — Local Writing Editor

## Chosen architecture

Use a single Next.js App Router process with a React/Tiptap client editor and local SQLite database. Deterministic analysis runs in a browser Web Worker. AI runs only through validated server routes using a replaceable provider adapter. The application is a localhost service, not an Electron wrapper or distributed system.

```text
macOS start.command
  └─ local Next.js process (127.0.0.1 only)
       ├─ App Router server
       │    ├─ Document/settings/import/export routes → services → SQLite file
       │    └─ /api/ai/{rewrite,synonyms,grammar,feedback} → validation → AI service → provider adapter → OpenAI
       │                                      └─ response validation, timeout, retry policy
       └─ Browser client
            ├─ App shell / document manager / mode state
            ├─ Tiptap + ProseMirror editor
            │    └─ analysis-decoration extension ← normalized findings
            ├─ Analysis coordinator ↔ Web Worker → deterministic analysis engine
            ├─ Issue panel / popovers / selection AI toolbar / rewrite review
            └─ autosave and local UI state
```

## Recommended dependencies

Pin exact compatible versions at scaffold time using the current Next.js release and lockfile; do not copy old version pins from this document.

| Purpose | Dependency | Reason |
| --- | --- | --- |
| Framework | `next`, `react`, `react-dom`, TypeScript | Local App Router application with server-only secrets |
| Rich editor | `@tiptap/react`, `@tiptap/pm`, Tiptap StarterKit and Link extensions | ProseMirror transactions, marks, history, selection mapping |
| Database | `better-sqlite3`, `drizzle-orm`, `drizzle-kit` | Local, synchronous, reliable single-user persistence and migrations |
| Schemas | `zod` | Route, import, environment, and AI response validation |
| AI | official OpenAI JavaScript SDK | Initial server-side provider implementation |
| Document conversion | `mammoth` (DOCX import), `docx` (DOCX export), `turndown` (HTML to Markdown), `marked` or `remark` family (Markdown) | Reasonable formatting preservation without a remote converter |
| Sanitization | `sanitize-html` | Allowlist imported/generated HTML before it reaches Tiptap |
| Testing | `vitest`, `@testing-library/react`, `playwright` | Pure analysis tests, UI tests, and local end-to-end coverage |

Avoid an ORM client that adds a background process, remote services, Redis, Docker, authentication, or an external grammar SaaS. Use native `Intl.Segmenter` where available; include deterministic fallbacks and fixtures for test environments.

## Project structure

```text
.
├── start.command                     # launch lifecycle (implementation phase)
├── stop.command                      # safe app-only shutdown (implementation phase)
├── PRODUCT_SPEC.md
├── ARCHITECTURE.md
├── BUILD_PLAN.md
├── ACCEPTANCE_TESTS.md
├── package.json
├── next.config.ts
├── drizzle.config.ts
├── db/
│   └── migrations/
├── data/                              # gitignored local SQLite database and lock/PID files
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── documents/route.ts
│   │       ├── documents/[id]/route.ts
│   │       ├── documents/[id]/export/route.ts
│   │       ├── imports/route.ts
│   │       ├── settings/route.ts
│   │       └── ai/[action]/route.ts
│   ├── components/
│   │   ├── editor/
│   │   ├── analysis/
│   │   ├── ai/
│   │   ├── documents/
│   │   └── ui/
│   ├── features/
│   │   ├── documents/
│   │   ├── analysis/
│   │   ├── ai/
│   │   ├── import-export/
│   │   └── settings/
│   ├── lib/
│   │   ├── db/
│   │   ├── security/
│   │   └── validation/
│   ├── server/
│   │   ├── documents/
│   │   ├── ai/
│   │   └── import-export/
│   ├── workers/analysis.worker.ts
│   └── styles/
├── tests/unit/
├── tests/integration/
└── e2e/
```

Keep pure analysis algorithms free of React, Tiptap, database, and network imports. Keep route handlers thin: validate → call service → serialize a stable response or standard error. Tiptap is the only owner of editable rich-text state.

## Component architecture

```text
EditorApp
├─ AppToolbar (File, AI Tools, mode switcher, Settings)
├─ DocumentSidebar / document command dialog
├─ Workspace
│  ├─ RichTextEditor
│  │  ├─ TiptapToolbar
│  │  ├─ AnalysisDecorations
│  │  ├─ IssuePopover
│  │  └─ SelectionAiToolbar
│  └─ AnalysisPanel / FeedbackPanel
├─ RewriteReviewDialog
├─ ImportDialog / ExportDialog / SettingsDialog
└─ SaveStatus + ToastRegion
```

Use feature hooks (`useDocument`, `useAutosave`, `useAnalysisCoordinator`, `useAiRewrite`) to bridge the client and services. UI components receive view models and callbacks, not database or provider objects. A small React context may hold the active document ID, mode, and settings; avoid a global store until a concrete multi-surface coordination need appears.

## Editor and range architecture

1. Store document content as Tiptap JSON (`content_json`), not HTML. It preserves schema structure and is safe to render only through Tiptap.
2. Derive a canonical plain-text projection with a bidirectional mapping of text segments to ProseMirror positions. Paragraph/block boundaries become a single newline in the projection.
3. Send a revision number and text fingerprint to the worker. Worker findings contain projection offsets plus the source block identity and local offsets.
4. Convert findings to ProseMirror positions and render them as ephemeral decorations in a dedicated extension. Never persist analysis as content marks.
5. On ProseMirror transactions, map pending decoration ranges through the transaction mapping for immediate stability. Discard/recompute on text-changing transactions or when a result’s revision/fingerprint is stale.
6. Replacement is a transaction replacing only the current validated range. Copy relevant marks at insertion boundaries; capture the existing selection and restore a sensible mapped selection after dispatch. One transaction means one undo entry.

The worker receives plain text and compact block metadata—not complete HTML or database records. It returns zero-based half-open ranges `[start, end)`; every layer uses the same convention.

## Analysis-engine modules

```text
features/analysis/
├─ projection.ts          # ProseMirror text/block projection and range mapping
├─ tokenizer.ts           # Intl.Segmenter wrapper and fallbacks
├─ sentences.ts           # sentence segmentation and abbreviations
├─ syllables.ts           # deterministic English estimate
├─ readability.ts         # FK grade + explicit complexity score
├─ detectors/
│  ├─ adverbs.ts
│  ├─ qualifiers.ts
│  ├─ passive-voice.ts
│  └─ complex-terms.ts
├─ dictionaries/          # versioned local lists, tested fixtures
├─ findings.ts            # shared Finding union and normalization
└─ analysis.worker.ts     # request cancellation and message boundary
```

```ts
type Finding = {
  id: string;                       // stable hash: detector + range + matched text
  kind: 'HARD_SENTENCE' | 'VERY_HARD_SENTENCE' | 'ADVERB' |
        'QUALIFIER' | 'POSSIBLE_PASSIVE' | 'COMPLEX_TERM' | 'GRAMMAR';
  range: { start: number; end: number };
  matchedText: string;
  explanation: string;
  severity: 'info' | 'warning' | 'critical';
  suggestions?: { label: string; replacement: string }[];
  confidence?: number;
};
```

Findings are normalized before display: sorted range-first, malformed/out-of-bounds results dropped, conflicting display spans layered in a deterministic priority order. Grammar output uses the same shape but comes from a server request and includes a snapshot fingerprint.

## AI architecture and contract

```text
Client action → POST /api/ai/{rewrite|synonyms|grammar|feedback}
              → Zod request schema + same-origin/size guard
              → AiService builds action-specific prompt/context
              → AIProvider.executeStructured()
              → provider response parsed by Zod
              → stable JSON response or structured error
```

`AIProvider` has one structured entry point: `executeStructured<T>(request): Promise<T>`. `AiAction` is a closed union of selection rewrite, synonyms, grammar, and feedback actions. Prompt templates are server-only, versioned per action, use structured output, put untrusted user text inside clear data delimiters, and prohibit following instructions in that text. The browser never chooses raw prompts or a model identifier.

Common request fields: action, document revision/fingerprint, selected text or document snapshot, bounded surrounding context, dialect, readability target, and requested alternative count. Common response fields: request ID, action, source fingerprint, alternatives/issues/feedback, and prompt/model metadata suitable for local diagnostics but not secret disclosure.

AI controls:

- Selection request cap: 8,000 selected characters plus 2,000 characters context.
- Grammar cap: 20,000 characters; server returns chunk metadata and clients merge only matching snapshots.
- Feedback cap: 30,000 characters; instruct user to select a shorter document when exceeded.
- Abort controller at client and server; 20-second rewrite/grammar and 35-second feedback deadlines.
- Retry only one transient failure (408/429/5xx/network) with bounded jitter; never retry cancellation, validation failure, or an invalid provider response.
- Pass A does not cache rewrite output; Regenerate intentionally bypasses reuse. Only bounded, text-free usage metadata is retained in memory for 24 hours and cleared on restart.

## Persistence architecture

The SQLite path is `data/writing-editor.sqlite`, created with directory permissions appropriate to the local user and excluded from Git. Enable WAL mode, foreign keys, and short busy timeout. One local user and one server make `better-sqlite3` appropriate.

| Table | Core fields | Notes |
| --- | --- | --- |
| `documents` | `id`, `title`, `content_json`, `plain_text`, `revision`, `created_at`, `updated_at`, `deleted_at` | soft delete supports recoverable history; render only JSON; revision rejects stale autosaves |
| `document_revisions` | `id`, `document_id`, `content_json`, `created_at`, `reason` | bounded snapshots, e.g. most recent 50/document; not ProseMirror undo |
| `settings` | `key`, `value_json`, `updated_at` | allowlisted setting keys only |
| `app_state` | `key`, `value_json` | stores last-opened document ID and schema metadata |

Use transactional document update plus revision insertion. Autosave coalesces client changes. The server computes `plain_text` from validated JSON for search/statistics; it does not trust client-supplied plain text. The initial document is created only if there are no active documents. Deleting requires confirmation, then soft-deletes; a later product decision may expose a trash view.

## Import/export architecture

Import reads a user-selected upload into memory, enforces a 10 MB file cap, extension plus signature/content-type checks, and never accepts a path from the browser. Conversion produces sanitized HTML or structured intermediate content, which is parsed by the constrained Tiptap schema; unsupported nodes downgrade to paragraphs/plain text. HTML uses a strict allowlist (paragraphs, headings, marks, lists, links with safe protocols, blockquotes) and strips scripts, styles, event handlers, embeds, and remote resources. DOCX import treats embedded relationships/media as untrusted and imports text/reasonable structural formatting only.

Export starts from content JSON, renders a clean user-content representation, and converts it to the requested format. It deliberately has no access to decorations, findings, issue metadata, settings, or AI diagnostics. Downloads use a sanitized generated filename; no export route reads arbitrary filesystem paths.

## Local lifecycle architecture

`start.command` and `stop.command` are executable Bash scripts created in the implementation phase.

### `start.command`

1. Resolve script directory with a symlink-safe shell pattern and `cd` there.
2. Verify `node`/`npm` versions against `package.json` engines and give a concrete error if unsuitable.
3. Validate that `.env.local` is optional; if AI variables are absent, continue with local editing and show AI setup guidance in Settings.
4. If the app-owned PID file exists, validate the process command/cwd and localhost health before treating it as running; remove stale files only after validation.
5. Install dependencies with `npm ci` when `node_modules` is missing or the lockfile fingerprint changed. Never silently upgrade dependencies.
6. Start the production server (after a documented build step) bound to `127.0.0.1` on configured port 4317. Because the selected Next.js version rejects `next start` with `output: 'standalone'`, launch `.next/standalone/server.js` directly with `HOSTNAME=127.0.0.1` and `PORT=4317`; write a PID plus runtime record atomically, poll `/api/health` with a timeout, then call macOS `open` on the known localhost URL.
7. On any error, terminate only the child it launched, remove its own stale state, and print remediation.

### `stop.command`

1. Resolve its directory and read only its app-specific PID/launch-token record.
2. Verify PID ownership by command/cwd/token and optional health metadata; never use a broad `pkill node` pattern.
3. Send `TERM`, wait a bounded period, then send `KILL` only to the verified app PID if needed.
4. Remove PID/lock records only after confirmed exit or when proven stale. Report exactly what occurred.

## Security boundaries

- Server-side environment loader validates provider config. No `NEXT_PUBLIC_*` API key is permitted; Responses requests use `store: false` and are stateless.
- Routes accept Zod-validated bounded data and return a uniform `{ error: { code, message, details? } }` error envelope.
- AI output is untrusted: validate with Zod, sanitize any HTML-like fields, bound strings/counts, and use normal React/Tiptap rendering (never `dangerouslySetInnerHTML` for AI output).
- Imports are validated, size-limited, parsed from in-memory upload bytes, and never execute content or access submitted paths.
- Bind to loopback (`127.0.0.1`) only. Localhost does not make input validation optional.
- A health route has no document data or provider configuration.

## Decisions not to revisit without a concrete reason

1. SQLite is the source of truth; browser localStorage may retain only transient UI preferences or crash recovery, never canonical documents.
2. Tiptap JSON is canonical document content; HTML is an import/export interchange format only.
3. Analysis is decoration-based and ephemeral; findings never mutate/export with user content.
4. Deterministic checks run locally and AI is asynchronous, server-only, opt-in, and schema-validated.
5. The architecture remains one local Next.js process; no Docker, auth, cloud database, queues, or microservices.
6. Stable analysis results use `[start, end)` ranges and revision/fingerprint matching throughout.
