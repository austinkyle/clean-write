# Implementation Plan — Local Writing Editor

## Operating rules for the implementation agent

- This specification is the current contract. Implement no feature not listed here without updating the relevant planning document and explaining the reason.
- Keep the app local-only and bind it to loopback. Do not add analytics, authentication, cloud persistence, or a SaaS dependency.
- Do not expose or commit API keys. Create `.env.example` with variable names only; do not create or edit a real `.env.local` without the user’s approval.
- Work in small, tested vertical slices. Run the named checks before moving past each checkpoint. Do not mark browser flows verified without executing them.
- Preserve the app’s original visual identity; do not use Hemingway’s trademarks, logo, assets, UI copy, or code.

## Phase 0 — Scaffold and guardrails

**Goal:** establish the local project and tooling without building product features.

- [ ] Initialize Next.js App Router + TypeScript project and lock dependencies.
- [ ] Add ESLint/formatting, Vitest, Playwright, test scripts, `.gitignore`, `.env.example`, and `data/.gitkeep`.
- [ ] Add `docs/decisions/ADR-001-local-stack.md` documenting the SQLite/Tiptap/Next decision.
- [ ] Configure test-safe SQLite path and test isolation.

**Acceptance:** `npm run lint`, `npm test`, `npm run build`, and a basic Playwright smoke test pass on a clean checkout.

## Phase 1 — Persistence and document lifecycle

**Goal:** documents and settings survive restart.

- [x] Implement validated SQLite connection, migrations, document/settings/app-state repositories, and bounded revision history.
- [x] Add document routes/services: create, list, retrieve, update, rename, duplicate, soft-delete, restore last opened.
- [x] Build a minimal application shell with document list, new/rename/duplicate/delete-confirm flows, title editing, autosave status, and recovery error state.

**Acceptance:** a document can be created, changed, renamed, duplicated, deleted with confirmation, reopened after server restart, and restores the last opened document.

**Checkpoint:** run repository/service integration tests, build, and document lifecycle E2E test.

## Phase 2 — Editor foundation and Write mode

**Goal:** rich text is pleasant and correct before analysis exists.

- [x] Define a restricted Tiptap schema with paragraphs, headings, strong, em, links, blockquotes, bullet/ordered lists, and history.
- [x] Add editor toolbar, keyboard shortcuts, selection preservation, accessible labels/tooltips, and write-mode layout.
- [x] Connect editor transactions to debounced autosave; ensure no content loss if save fails/retries.

**Acceptance:** all required formatting works, undo/redo works, formatting persists after reopen, and Write mode has no analysis decorations/panel.

## Phase 3 — Deterministic analysis engine

**Goal:** produce tested local findings independently of UI.

- [x] Implement projection, segmentation, statistics, readability, and detector modules with fixtures for edge cases.
- [x] Implement readability target controls and versioned exception/dictionary data.
- [x] Implement analysis Web Worker with request ID, stale generation/fingerprint checks, and large-document degradation.

**Acceptance:** pure unit tests prove statistic counts, grade calculations, sentence severity, detector boundaries, and replacement ranges. Typical 10,000-character analysis completes in a performance-budget test without blocking the UI thread.

## Phase 4 — Edit mode and issue interaction

**Goal:** visually explain and safely fix local findings.

- [x] Add analysis-decoration extension, issue colors/patterns, visibility toggles, counts, and right-hand issue panel.
- [x] Add clickable findings and one-click local complex-term replacements.
- [x] Add target preset control and reclassification behavior.

**Acceptance:** highlights anchor through normal text edits, toggles do not change content, changing preset alters sentence classifications, and local replacement preserves surrounding formatting and undoes in one step.

**Checkpoint:** execute Edit-mode E2E suite in Chromium and inspect for console errors/accessibility regressions.

## Phase 5 — Import/export

**Goal:** move user-owned text in and out safely.

- [x] Implement typed import parsers and sanitization pipeline for TXT, Markdown, HTML, DOCX.
- [x] Implement clean exports for the same formats, with safe filenames.
- [x] Add File-menu import/export actions with invalid-file/error states and canonical-content normalization.

**Acceptance:** round-trip fixtures preserve reasonable headings/lists/emphasis; malicious HTML is inert; exports contain no decorations/finding metadata. Verified in unit and browser tests.

## Phase 6 — AI service and selected-text rewriting

**Goal:** offer optional, reviewable rewrites through one provider abstraction.

**Implementation contract:** [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) and
[ADR-002](docs/decisions/ADR-002-ai-candidate-boundary.md). AI generates
candidates only; accepted text must use `replaceEditorRange` after the captured
document/generation/range/text snapshot is revalidated.

- [x] Implement server-only AI config loader, `AIProvider`, `AiService`, action registry, Zod contracts, prompts, timeout/retry/cancellation, error envelope, and privacy-safe in-memory usage metadata.
- [x] Implement selection toolbar, custom instruction field, synonym UI, and shared rewrite review dialog with alternative navigation/regeneration.
- [x] Implement atomic acceptance, stale-selection protection, Undo integration, and clear unavailable/error/disabled states.

**Acceptance:** a fake-provider integration suite proves every action routes through the shared service; browser E2E proves selection → suggestion → accept → undo. Browser bundles and responses contain no key/config secret.

## Phase 7 — Grammar and document Feedback

**Goal:** add non-intrusive AI-assisted editorial review.

**Implementation contract:** use source-relative grammar offsets reconciled to
the captured local projection. Do not accept model-provided ProseMirror
positions or a result from an outdated editor generation.

- [x] Implement debounced/cancelled grammar scheduling in Edit mode, structured grammar finding merge, green issue UI, exact replacement acceptance, and snapshot matching.
- [x] Implement Feedback mode request, structured feedback rendering, regeneration, loading/errors, stale state, no-key/size states, and ranked improvement cards.
- [x] Implement Make Skimmable for explicit contiguous top-level block selections with constrained AST output, canonical conversion, preview, stale-safe block replacement, and history integration.

**Acceptance:** no grammar request is made during continuous typing; stale grammar/feedback/skimmable results cannot apply to changed text; Feedback and Make Skimmable review states are keyboard usable and clear.

## Phase 8 — Launch lifecycle, quality, and release evidence

**Goal:** hand over a robust local application.

- [x] Implement and manually test `start.command`, `stop.command`, health route, PID/token state, duplicate protection, crash cleanup, and no-AI-key path.
- [ ] Complete visual polish for light/dark/system themes and responsive issue drawer.
- [ ] Run full test matrix, measure large-document behavior, verify default-browser launch and safe shutdown on macOS.
- [x] Update README with setup, commands, backup location, AI setup, and limitations.

**Acceptance:** all release acceptance tests pass, start/stop proves it never kills an unrelated Node process, and the user receives executed test evidence plus known limitations.

## Verification commands (to create in Phase 0)

```bash
npm run dev
npm run lint
npm test
npm run test:coverage
npm run test:e2e
npm run build
```

Use a dedicated temporary SQLite path for every test run; E2E must start its own local server and never use a person’s working `data/writing-editor.sqlite`.

## Key technical risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Rich-text range drift | Tiptap transaction mapping for immediate updates; revision/fingerprint gate for async worker/AI results; fixture tests for marks and block boundaries |
| English heuristics create false positives | Conservative rules, exception dictionaries, confidence/explanations, user-controlled visibility, and “possible” passive language |
| AI responses are malformed or risky | Structured output schemas, server-side Zod validation, sanitizer, bounded requests, and no auto-apply |
| Typing jank on large documents | Web Worker, debounces, cancellations, incremental block analysis, stated document thresholds |
| DOCX conversion loses fidelity | Explicit “reasonable formatting” scope; round-trip fixtures; plain-text fallback and visible notice |
| Local lifecycle scripts harm other processes | App-specific PID plus launch token and cwd validation; no broad process-kill command |
| SQLite file corruption/concurrency | WAL, transactions, migrations, atomic backup/export guidance, one local server policy |

## Suggested initial task order

Implement Phases 0–2 before any AI work. Implement Phase 3 with exhaustive tests before rendering highlights. Finish Phase 4 and 5 before Phase 6, so an AI provider configuration failure cannot prevent basic writing. Treat Phase 8 as a hard release gate, not a cosmetic afterthought.
