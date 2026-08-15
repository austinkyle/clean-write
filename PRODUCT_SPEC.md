# Local Writing Editor — Product Specification

## Objective

Build a fast, single-user writing editor for macOS that runs on `localhost` in the default browser. It supports polished rich-text writing, transparent local readability analysis, optional server-side AI assistance, local document storage, and import/export. It is inspired by the *workflow class* of Hemingway Editor Plus, but uses original naming, visual design, copy, thresholds, and assets.

The application is personal and local-only: no accounts, collaboration, cloud database, telemetry, or mandatory external service. AI is optional and must never block typing.

## Product boundaries

### In scope

- Write, Edit, and Feedback modes; File, AI Tools, and Settings controls.
- Rich text: paragraphs, headings, bold, italic, links, blockquotes, bullet/ordered lists, undo, and redo.
- Local deterministic analysis, local SQLite persistence, and import/export for `.docx`, `.md`, `.html`, and `.txt`.
- Pluggable server-side AI actions, starting with OpenAI.
- macOS `start.command` and `stop.command` launch lifecycle.

### Out of scope

- User accounts, collaboration, network sync, public hosting, mobile app, custom model training, plugin marketplace, cloud telemetry, and copying another product’s content or implementation.

## User journeys

1. **Start and resume:** the user double-clicks `start.command`; one local server starts, the browser opens, and the last document restores.
2. **Write:** the user writes and formats without highlights or intrusive statistics. Autosave is quiet and fast.
3. **Edit:** the user sees analysis marks and a right-side issue panel, can filter an issue type, navigate to an issue, replace it, and undo that replacement in one editor action.
4. **Rewrite selected text:** a selection opens the contextual AI toolbar. An action presents several in-session alternatives; the user chooses one or cancels without changing the document.
5. **Review:** the user requests structured whole-document feedback, scans strengths, concerns, and ranked improvements, and can regenerate it.
6. **Manage content:** the user creates, renames, duplicates, deletes, imports, exports, and reopens documents locally.

## Modes and UX contract

| Mode | Editor | Analysis UI | Primary intent |
| --- | --- | --- | --- |
| Write | Full writing surface | Decorations and issue panel hidden; only compact word count | Draft without distraction |
| Edit | Full writing surface | Highlight decorations, issue panel, filters, issue popovers | Improve clarity |
| Feedback | Read-only analysis side panel beside editable document | Structured document-level AI review; no inline AI changes until the user chooses an action | Plan revisions |

Mode selection never changes document content. Keyboard focus remains in the editor after switching mode unless the user explicitly opens a panel or dialog.

## Analysis contract

The local analysis engine is deterministic and versioned. It returns positions in the editor’s canonical plain-text projection plus source document coordinates, an explanation, severity, and optional local replacement choices. Its thresholds are our own transparent rules—not claims about another editor’s proprietary behavior.

### Readability and sentence severity

Use Flesch-Kincaid Grade Level as the document grade and per-sentence grade estimate:

`0.39 × (words / sentences) + 11.8 × (syllables / words) − 15.59`

Sentence scoring uses one sentence (with a minimum divisor of one) and supplements the grade with an explicit complexity penalty:

- `+0.5` for 25–34 words, `+1.5` for 35+ words.
- `+0.5` for 3+ comma/semicolon clauses, `+1.0` for 5+.
- `+0.5` for parenthetical nesting or 3+ conjunctions.

Presets change the difficult-sentence threshold; document grade remains factual:

| Preset | Target | Yellow: hard | Red: very hard |
| --- | ---: | ---: | ---: |
| Accessible | Grade 7 | `> 7.5` | `> 10.5` |
| Default | Grade 9 | `> 9.5` | `> 12.5` |
| Technical | Grade 12 | `> 12.5` | `> 15.5` |

Severity is exclusive: a red sentence is not also yellow. The UI explains the observed grade and the factors contributing to its score.

### Other local rules

| Mark | Rule | Result |
| --- | --- | --- |
| Blue: adverb | Token ending in `-ly`, excluding a curated exception list and proper nouns where detectable | token range and rewrite action |
| Blue: qualifier | Case-insensitive phrase dictionary, initially `very`, `really`, `quite`, `rather`, `somewhat`, `probably`, `basically`, `actually`, `just`, `kind of`, `sort of`, `a little` | token/phrase range and direct removal option when safe |
| Blue: possible passive voice | Clause heuristic: form of `be/get` + past participle; suppress clear adjective/copular cases using exceptions | clause range, confidence, explanation, AI rewrite action |
| Purple: complex term | Versioned local lexicon mapping a matched word/phrase to vetted simpler alternatives; longest phrase wins | exact range and one-click replacement list |
| Green: grammar | A separately scheduled structured grammar request, with schema-validated response | exact range, proposed correction, confidence, accept/reject |

Local detections are suggestions, not declarations of error. Passive voice is explicitly labeled “possible passive voice.” The lexicon ships with its provenance/version inside the app and does not depend on network calls.

## Statistics

- Letters: Unicode letters only.
- Characters: all Unicode code points in the plain-text projection, including whitespace.
- Words: locale-aware word segmentation with a stable fallback regex.
- Sentences: sentence segmenter with an abbreviation exception layer.
- Paragraphs: non-empty ProseMirror paragraphs and list items counted as blocks for a meaningful writing count.
- Reading time: `ceil(words / 200)` minutes, with “under 1 min” for nonempty documents below one minute.

## AI experience contract

AI actions are optional; the UI clearly reports unavailable configuration, timeout, rate limit, invalid result, or network failure without touching the document. Selection actions are Simplify, Polish, Rephrase, AI Synonyms, and More: Shorten, Add detail, More confident, More friendly, More casual, More formal, More persuasive, Make skimmable, plus a free-form instruction.

All rewrites use a shared review panel with original and suggested content, prior/next in-session alternatives, regenerate, Use suggestion, and Cancel. The selection’s original Tiptap range and document version are retained. “Use suggestion” is disabled if the selection no longer exactly matches; the user can regenerate from the current selection. Applying a suggestion is one ProseMirror transaction, preserving the surrounding marks and selection where possible, and one undo step.

Grammar and full-document feedback have dedicated structured response shapes. Full-document feedback contains summary, strengths, weaknesses, and a ranked improvement list tagged by clarity, organization, logic, flow, tone, concision, repetition, or consistency.

## Non-functional requirements

- No AI call on typing. Local analysis starts after 250 ms idle and runs in a Web Worker; grammar starts after 1,500 ms idle in Edit mode only.
- A new edit cancels obsolete local/AI work. Results apply only when their text fingerprint and document revision still match.
- Keep normal editing responsive for documents up to 100,000 plain-text characters. Above that, analyze the visible/changed blocks immediately, schedule full analysis after 2 seconds idle, display a non-blocking “large document” state, and limit grammar requests to 20,000 characters or the changed sections.
- Autosave after 500 ms idle, on blur, and before unload. Failed saves visibly retry and never discard unsaved text.
- Keyboard-operable controls, visible focus, semantic buttons/labels, contrast meeting WCAG 2.1 AA, and reduced-motion support.
- Desktop-first but usable down to 768 px: the issue panel becomes a labelled drawer, never overlaps the writing surface without an explicit close control.

## Settings

- Theme: system, light, dark.
- Dialect: US, British, Canadian, Australian, Indian, Irish, South African, New Zealand.
- Readability target: Accessible, Default, Technical.
- AI provider and model configuration. The interface permits provider selection only for installed server-side providers; credentials are managed outside browser state.

## Acceptance criteria

1. The app runs locally on macOS, opens in the default browser, resumes the prior document, and does not require a hosted service or database.
2. Write/Edit/Feedback are visually and behaviorally distinct as specified above.
3. Every local mark has precise source positions, a count, an accessible toggle, and remains correctly anchored after routine edits.
4. Changing readability preset immediately reclassifies hard/very-hard sentences without altering content.
5. AI never blocks typing or exposes credentials; all generated data is schema-validated before display or application.
6. Replacement, AI acceptance, and grammar acceptance preserve formatting around the replacement and undo in one action.
7. Documents, settings, and the last-opened document persist locally; delete requires confirmation.
8. Imports sanitize content; exports contain only user content, never analysis decorations or private metadata.
9. The test suite covers the behaviors in `ACCEPTANCE_TESTS.md` before the application is considered complete.
