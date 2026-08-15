# Acceptance Test Strategy — Local Writing Editor

## Test layers

| Layer | Tool | Purpose |
| --- | --- | --- |
| Unit | Vitest | Pure text analysis, parsing, scoring, range mapping, prompts/contracts |
| Integration | Vitest + temporary SQLite + route/service harness | Persistence, validation, import/export, provider adapter behavior |
| Browser E2E | Playwright against isolated localhost server/database | Core user journeys, UI state, real Tiptap history, restart behavior |
| Manual macOS | Shell + normal browser | `start.command`/`stop.command`, default-browser launch, PID safety |

All test data is synthetic. Tests use a temporary SQLite database specified by an explicit test-only environment variable. They must never read, modify, or export a user’s `data/writing-editor.sqlite`.

## Unit requirements

### Statistics and readability

- [ ] Counts letters, characters, words, sentences, paragraphs, and reading time for empty, punctuation-heavy, Unicode, headings/lists, and multi-paragraph fixtures.
- [ ] Flesch-Kincaid grade is stable against documented fixture values and handles zero/one-word input without division errors.
- [ ] Sentence complexity penalties are applied independently and explanation metadata names each triggered factor.
- [ ] Accessible, Default, and Technical classify the same sentence differently at their documented thresholds; red never duplicates yellow.

### Finding detectors and ranges

- [ ] Adverb detector matches ordinary `-ly` words but does not match configured exceptions.
- [ ] Qualifier detector is case-insensitive, respects phrase boundaries, and returns exact half-open ranges.
- [ ] Passive heuristic catches representative “was completed” clauses, labels confidence, and avoids known copular/adjectival exceptions.
- [ ] Complex-term matcher prefers longest overlapping phrase and returns available alternatives.
- [ ] Projection/range mapper maintains exact ranges across paragraphs, headings, links, and formatted inline spans.
- [ ] Normalizer rejects invalid/out-of-bounds findings and orders overlapping highlights predictably.
- [ ] A transaction/replacement helper changes only the requested span and preserves neighboring marks.

### AI contracts

- [ ] Every `AiAction` maps to a known request/response schema and prompt version.
- [ ] Request caps reject oversized text before provider invocation.
- [ ] Invalid provider payloads, extra malformed alternatives, unsafe markup, cancellation, timeout, 429, and 5xx produce a safe structured result.
- [ ] Retry occurs once only for configured transient failures; it never retries cancellation or schema failure.

## Integration requirements

- [ ] Migration creates the expected SQLite tables, WAL/foreign keys are enabled, and a document update plus revision is atomic.
- [ ] Create/list/get/update/rename/duplicate/delete routes validate input and have consistent error envelopes.
- [ ] Last-opened document and settings persist through a new service instance.
- [ ] Import rejects oversize, invalid extension/signature, traversal-like names, and unsafe HTML; sanitized accepted HTML contains no scripts, handlers, or unsafe URLs.
- [ ] TXT/Markdown/HTML/DOCX fixture imports and exports preserve reasonable headings, lists, emphasis, links, and paragraphs.
- [ ] Exported content has no analysis classes, decoration metadata, AI request data, or settings.
- [ ] Fake `AIProvider` proves grammar, synonyms, selection rewrites, and feedback use the same `AiService` path. (Grammar, synonyms, and rewrites are covered; Feedback remains deferred.)

## Browser E2E scenarios

### A. Write, save, and resume

1. Start with an empty isolated database and open the app.
2. Create a document, enter text, apply bold/italic/heading/list/blockquote/link formatting, then wait for saved state.
3. Reload and restart the test server; reopen the app.
4. Assert content, title, formatting, last-opened document, and usable undo/redo state are correct.

### B. Edit analysis and controls

1. Enter fixture text containing a difficult sentence, adverb, qualifier, possible passive clause, and complex term.
2. Switch from Write to Edit.
3. Assert each visible issue category has the expected count and accessible name; assert its decoration is present.
4. Toggle each category off/on and verify document text does not change.
5. Change Accessible → Default → Technical and assert difficult-sentence classification changes as specified.
6. Open an issue, use a local complex-term replacement, and assert the surrounding formatting remains and one Undo reverses it.

### C. Selection AI rewrite

1. With fake provider enabled, select text using the browser.
2. Assert the selection toolbar exposes Simplify, Polish, Rephrase, AI Synonyms, More, and custom instruction.
3. Trigger Simplify, inspect original and first suggestion, navigate alternatives, regenerate, accept one.
4. Assert only the selection changed; then press Undo and assert original content returns.
5. Edit selection after starting a request; assert stale suggestion cannot be applied and UI explains why.

### D. Grammar and Feedback

1. Type continuously in Edit mode and assert no grammar request occurs until 1,500 ms of idle time.
2. Resolve fake grammar response; assert green issue explanation, correction, accept, and reject behavior.
3. Change content before a grammar response resolves; assert it is discarded.
4. Switch to Feedback, click Get Feedback, and assert structured summary, strengths, category assessments, and ranked improvements appear without changing document text.
5. Assert loading, unavailable-key, timeout, invalid-result, and regenerate states are clear and non-destructive.

### E. Import, export, settings, and themes

1. Import each fixture format; assert core structure is present and unsafe HTML remains inert.
2. Export each format; inspect resulting files/text and assert no analysis metadata exists.
3. Change theme and dialect/readability preferences; reload and assert persistence.
4. Assert light/dark/system state has adequate controls and keyboard focus; at tablet viewport open/close the labelled issue drawer.

### F. Make Skimmable

1. Select complete contiguous paragraph/headings and assert Make Skimmable is available; partial, linked, quoted, or list selections remain unavailable in v1.
2. Run a fake structured response and assert the preview shows ORIGINAL and SUGGESTED STRUCTURE without changing the editor.
3. Cancel and assert the original blocks remain; accept and assert native headings/lists replace the selected blocks in one history step.
4. Undo and redo the structural replacement; edit while a request is pending and assert the stale candidate cannot apply.

### G. Large document and accessibility smoke

1. Paste a synthetic 100,000-character fixture.
2. Assert editor remains interactable while a non-blocking large-document analysis state appears; stale results do not overwrite newer text.
3. Run Playwright accessibility assertions for keyboard access, dialog focus, visible focus, labels, and no critical violations in key screens.
4. Assert browser console contains no unhandled error during all critical flows.

## Manual macOS lifecycle tests

- [ ] Double-click/execute `start.command` from a different working directory; it resolves its own project path.
- [ ] With dependencies missing, it gives a useful install/prerequisite outcome.
- [ ] It opens exactly one app URL in the default macOS browser after health succeeds.
- [ ] Run it twice; the second invocation detects the healthy app and does not launch a duplicate.
- [ ] Kill the app unexpectedly; a subsequent start removes proven-stale state and starts cleanly.
- [ ] Start an unrelated Node process, run `stop.command`, and verify that unrelated process remains alive while this application exits.
- [ ] Stop with missing/stale PID state; it reports accurately and leaves no unsafe broad kill behavior.

## Release gate

The application is ready only when all unit, integration, and E2E checks pass; manual lifecycle checks have recorded results; a production build succeeds; and no unresolved critical/high security, data-loss, editor-history, or typing-responsiveness defect remains. Passing tests alone do not prove the app’s workflow until the browser and macOS lifecycle scenarios have been executed.
