# Deterministic Analysis Engine Design

## Status and scope

This document is the implementation contract for the next ClearWrite phase. It designs local statistics, readability, style detections, worker scheduling, and non-persistent ProseMirror highlights. It does **not** authorize grammar, AI, import/export, or production analysis code in the current review step.

The canonical document remains validated Tiptap JSON in SQLite. Analysis is derived client state, never written to `content_json`, `plain_text`, document revisions, or export formats.

## Review verdict and required preflight

The current Phase 0–2 architecture is suitable for this design: documents are remounted on document switches, database access is server-only, and persisted revision handling is separate from the interactive editor. The following must be handled before or in Luna's first analysis increment:

1. **Hard-break validation mismatch:** `StarterKit` supports `hardBreak`, but `src/features/documents/content.ts` accepts only inline text nodes. A Shift+Enter document could therefore fail autosave. Extend the existing canonical-content validator to accept only the supported `hardBreak` shape before projecting it. Do not accept arbitrary inline nodes.
2. **Do not reuse `toPlainText` as analysis projection:** it intentionally serves persisted derived text and adds a newline after both a nested paragraph and its enclosing blockquote. It has no position map. The analysis projection is a separate module with its own defined separators.
3. **Do not couple analysis identity to persisted revision:** typing is ahead of autosave. Use a client-local editor generation for analysis freshness; persisted revisions only protect SQLite saves.

The architectural validation test at `tests/unit/prosemirror-position-semantics.test.ts` executed against the actual installed Tiptap/ProseMirror schema. It proves that text positions are absolute document positions and that bold/link marks do not add to text-node position width.

## Source layout

```text
src/
├── features/analysis/
│   ├── types.ts                 # worker-safe input/output and normalized findings
│   ├── projection.ts            # PM document -> Projection, offset-to-PM mapper
│   ├── statistics.ts            # pure statistics from Projection
│   ├── segmentation.ts          # sentence/token segmentation with offsets
│   ├── syllables.ts             # local English syllable estimator
│   ├── readability.ts           # FK grade and sentence difficulty
│   ├── normalize.ts             # validation, sorting, overlap priority
│   ├── dictionaries/
│   │   ├── adverb-exceptions.ts
│   │   ├── qualifiers.ts
│   │   ├── participles.ts
│   │   └── simple-alternatives.ts
│   └── detectors/
│       ├── adverbs.ts
│       ├── qualifiers.ts
│       ├── passive-voice.ts
│       └── complex-terms.ts
├── components/editor/
│   ├── analysis-extension.ts    # Tiptap Extension / PM Plugin, decorations only
│   └── RichTextEditor.tsx       # accepts analysis state and emits transactions
├── components/analysis/
│   ├── AnalysisPanel.tsx
│   └── FindingPopover.tsx
├── features/analysis/useAnalysisCoordinator.ts
└── workers/analysis.worker.ts
```

Pure modules under `features/analysis` must import neither React, Tiptap, the database, nor browser DOM APIs. `projection.ts` is the sole exception: it imports ProseMirror model types, runs on the main thread, and never crosses the worker boundary.

## Projection and exact range mapping

### Coordinate system

All analysis ranges are zero-based, half-open UTF-16 code-unit offsets: `[textStart, textEnd)`. This exactly matches JavaScript string indexing, `Intl.Segmenter` indices, `String.slice`, ProseMirror text-node offsets, and `Decoration.inline(from, to)`. Do not use grapheme indices for stored finding ranges. Emoji and other astral Unicode characters consume two UTF-16 units but are never split because token/sentence boundaries come from JavaScript segmentation.

### Projection shape

```ts
type ProjectionSegment = {
  kind: 'text' | 'hard_break' | 'block_separator';
  textStart: number;
  textEnd: number;
  pmFrom: number | null;
  pmTo: number | null;
  blockIndex: number;
};

type ProjectionBlock = {
  index: number;
  nodeType: 'paragraph' | 'heading' | 'blockquote_paragraph' | 'list_item_paragraph';
  textStart: number;
  textEnd: number;
  pmContentFrom: number;
  pmContentTo: number;
  isEmpty: boolean;
};

type Projection = {
  text: string;
  segments: ProjectionSegment[];
  blocks: ProjectionBlock[];
};
```

Project every ProseMirror `node.isTextblock` in document order. This yields paragraphs and headings directly; paragraphs nested in a blockquote/list are labelled by context. List wrappers themselves are not text blocks. Empty text blocks still create a `ProjectionBlock` with equal text offsets so paragraph statistics are correct, but create no text segment.

For each text block, descend through inline children in order:

- A text node contributes its literal `node.text` and a `text` segment.
- A supported `hardBreak` contributes one literal `\n` and a `hard_break` segment.
- Inline marks such as bold, italic, and links never create projection characters or boundaries. Adjacent marked/unmarked text nodes create adjacent segments.
- Insert exactly one artificial `\n` `block_separator` *between* consecutive text blocks, never before the first or after the last. It has `pmFrom: null` and `pmTo: null`.

This projection is not a search index. It is rebuilt from the current `EditorState.doc` for each analysis request; identical words are distinguished by their segment and absolute offset.

### Actual ProseMirror position semantics

The installed schema was exercised in `tests/unit/prosemirror-position-semantics.test.ts` with a heading, plain/bold/link text, and nested list items. Observed text-node positions were:

| Text | Absolute PM position |
| --- | ---: |
| `Plan` in heading | 1 |
| first `Same ` in paragraph | 7 |
| bold `Same` | 12 |
| link ` link` | 16 |
| `First item` in list paragraph | 25 |
| `Second item` in list paragraph | 39 |

`doc.descendants((node, pos) => ...)` supplies the absolute position **before** each descendant node. A text node with `N` UTF-16 units occupies `[pos, pos + N)`. A non-text block node occupies an opening token, its content, and a closing token; its child content starts at `blockPos + 1`. For a text block discovered at `blockPos`, a nested inline callback position `inlinePos` maps to `blockPos + 1 + inlinePos`. The proof also constructs `Decoration.inline(7, 21)`, whose range covers text across plain, bold, and link nodes without modifying document content.

### Offset-to-PM mapping

`mapTextRange(projection, textStart, textEnd)` has this exact contract:

1. Reject empty, negative, reversed, or out-of-bounds ranges.
2. Find every projection segment intersecting `[textStart, textEnd)`.
3. Reject if any intersected segment is an artificial `block_separator` or has null PM coordinates. Sentence segmentation is block-local, so legitimate deterministic findings should never cross one.
4. Convert the first intersected offset to `pmFrom = segment.pmFrom + (textStart - segment.textStart)`.
5. Convert the exclusive end using the last intersected segment: `pmTo = last.pmFrom + (textEnd - last.textStart)`.
6. Reject if `pmFrom >= pmTo`, `pmTo > doc.content.size`, or `doc.textBetween(pmFrom, pmTo, '')` is incompatible with the finding excerpt after normalizing only hard-break/newline representation.

Ranges may cross any number of inline-mark segments because their PM text coordinates are contiguous. Findings never span artificial block separators. An unrecognized inline atom added in a future editor schema must either receive its own explicit projection mapping or make its containing range unmappable; never silently string-search around it.

## Worker protocol and freshness

### Main-thread responsibilities

The main thread owns Tiptap/ProseMirror documents, builds `Projection`, maps text offsets to PM positions, builds decorations, handles clicks, and retains UI state. It increments `editorGeneration` on every doc-changing transaction; this generation resets when the editor remounts for another document.

### Structured-clone-safe messages

```ts
type AnalyzeRequest = {
  type: 'analyze';
  requestId: number;
  documentId: string;
  editorGeneration: number;
  projection: {
    text: string;
    blocks: Array<Pick<ProjectionBlock, 'index' | 'nodeType' | 'textStart' | 'textEnd' | 'isEmpty'>>;
  };
  settings: { readabilityTarget: 'accessible' | 'default' | 'technical' };
};

type AnalyzeResponse = {
  type: 'result';
  requestId: number;
  documentId: string;
  editorGeneration: number;
  textHash: string;
  statistics: AnalysisStatistics;
  readability: ReadabilityResult;
  findings: TextFinding[];
};
```

Send projected text and compact block ranges, not Tiptap JSON, ProseMirror nodes, positions, or editor objects. The worker performs segmentation, statistics, readability, and detectors. The main thread maps valid `TextFinding` ranges to PM ranges and drops invalid/mismatched results.

Use a worker-local deterministic FNV-1a 32-bit text hash for diagnostics. Acceptance requires matching `documentId`, `requestId` greater than the last accepted request, `editorGeneration`, and hash before results replace UI state. Generation is the authoritative identity; the hash is a useful assertion, not a security primitive.

An older response is ignored even if it arrives last. A new edit maps existing decorations provisionally through `tr.mapping` so they do not jump while the 250 ms debounce runs, marks them stale, and disables finding actions until the current generation succeeds. On a new document, clear the extension state before applying new results. Persisted document `revision` must never gate or delay worker analysis.

## Statistics and segmentation

### Definitions

| Statistic | Rule |
| --- | --- |
| Characters | Unicode code points in the complete projection text, including spaces and artificial block separators. Use `Array.from(text).length` for this display-only count. |
| Letters | Unicode letters matched by `/\p{L}/gu` over projection text. |
| Words | `Intl.Segmenter('en', { granularity: 'word' })` segments with `isWordLike`; contractions such as `don't` count as one, em/en dashes separate surrounding words. Fallback: Unicode letter/number runs with internal apostrophe variants (`'`, `’`) permitted. |
| Sentences | Nonempty sentence spans produced independently for each text block; headings and list items participate. |
| Paragraphs | Count nonempty ordinary paragraph text blocks outside lists plus nonempty `listItem` blocks (one per item); headings and blockquote paragraphs are excluded from the paragraph number. |
| Reading time | `ceil(words / 200)` minutes; a nonempty document below one minute displays “Under 1 min read.” Empty is `0 min`. |

The worker uses `Intl.Segmenter` when it exists in the worker runtime. It emits UTF-16 indices. The fallback is local and deterministic, not a remote NLP service.

### Sentence segmentation

`segmentBlock(text, absoluteStart)` first calls `Intl.Segmenter('en', { granularity: 'sentence' })`. It trims leading/trailing whitespace from each emitted piece while retaining its absolute source offsets. It merges adjacent pieces if the apparent terminator belongs to a recognized abbreviation (`Dr.`, `Mrs.`, `Ms.`, `Mr.`, `Prof.`, `Sr.`, `Jr.`, `vs.`, `etc.`, `e.g.`, `i.e.`, `U.S.`, month abbreviations), a decimal (`3.14`), or a single-letter initial. It preserves closing quotes/brackets after terminal punctuation. A terminal `...`/`…` closes a sentence only when followed by substantial whitespace and an uppercase word; otherwise it remains with the current sentence. A nonempty text block with no terminating punctuation is one sentence.

The fallback scans terminal `.?!…` plus an optional run of closing quote/bracket characters, only splitting before whitespace when the preceding token is not an abbreviation, decimal, or protected initial. It never crosses a text-block boundary. This is a practical English segmenter, not a claim of full linguistic correctness.

## Readability and sentence difficulty

### Flesch-Kincaid Grade Level

For a document with `W` words, `S` sentence spans, and `Y` estimated syllables:

`grade = 0.39 * (W / S) + 11.8 * (Y / W) - 15.59`

Compute with full precision; round only the displayed value to one decimal. Return `null`/`—` when `W < 3` or `S === 0`. A sentence's base grade uses its own `W`, `S = 1`, and `Y`. No score is reported as another product's score.

### Syllables

Implement a small local estimator; add no dictionary dependency. Normalize to lower case, map smart apostrophes to ASCII, strip nonletters, then:

1. Return an explicit exception count when present (`queue`, `people`, `business`, `every`, `different`, `beautiful`, `fire`, `hour`, `rhythm`, and tested common irregulars).
2. Count vowel groups `[aeiouy]+`.
3. Subtract one for a silent terminal `e` when there is more than one group, except consonant-plus-`le` endings.
4. Subtract one for common silent `-ed`/`-es` endings only when a preceding consonant makes it plausible.
5. Clamp to at least one.

Expected limitation: English spelling has irregular pronunciations. This is consistent and testable, not dictionary-grade phonetics.

### Target presets and classification

| Preset | Target | Hard (yellow) | Very hard (red) |
| --- | ---: | ---: | ---: |
| Accessible | 7 | score `> 7.5` | score `> 10.5` |
| Default | 9 | score `> 9.5` | score `> 12.5` |
| Technical | 12 | score `> 12.5` | score `> 15.5` |

For each sentence, compute `difficultyScore = FK sentence grade + lengthPenalty + clausePenalty + nestingPenalty`:

- word count 25–34: `+0.5`; 35+: `+1.5`
- comma/semicolon clause markers 3–4: `+0.5`; 5+: `+1.0`
- parenthetical nesting or 3+ coordinating conjunctions: `+0.5`

Do not classify a sentence under eight words as hard or one under twelve words as very hard. This eligibility floor prevents technical short phrases from creating noisy highlights. Classify red first, then yellow; a red sentence never emits a second yellow finding. Finding metadata records grade, difficulty score, word count, and every applied penalty so the sidebar can explain the result.

## Detectors and lexicons

All detector outputs are pure `TextFinding` values with exact projection offsets. Lexicon modules export readonly data; no detector embeds a giant word list.

### Adverbs

Tokenize with the word tokenizer. Match alphabetic `-ly` tokens with a curated exception set of common non-adverbs/adjectives/nouns (`family`, `only`, `early`, `friendly`, `lovely`, `lonely`, `silly`, `ugly`, `holy`, `lively`, `timely`, `costly`, `orderly`, `scholarly`, `daily`). Suppress a capitalized token that appears away from sentence start as a conservative proper-name guard. The match is advisory, not a grammar claim; it excludes the exception set rather than pretending suffixes are part-of-speech tagging.

### Qualifiers / weasel words

Use a case-insensitive, Unicode word-boundary matcher over a longest-first lexicon: multi-word entries (`a little`, `a bit`, `kind of`, `sort of`) before tokens (`actually`, `almost`, `basically`, `fairly`, `just`, `maybe`, `perhaps`, `possibly`, `pretty`, `quite`, `rather`, `really`, `somewhat`, `totally`, `very`). Store an explanation and `removable: boolean` with each entry. `just` and `pretty` remain low-confidence because they can have non-qualifying meanings; the UI labels them “possible qualifier.”

### Possible passive voice

Use a conservative sentence-local pattern, labelled exactly “possible passive voice”: a form of `be` or `get` (`am`, `is`, `are`, `was`, `were`, `be`, `been`, `being`, `get`, `gets`, `got`, `getting`), optional `not`/`being`, then a likely past participle. Likely participles are `-ed`, `-en`, `-wn`, `-nt`, `-lt`, `-pt`, `-ought`, plus a small irregular set (`built`, `bought`, `caught`, `done`, `driven`, `given`, `made`, `known`, `seen`, `sent`, `shown`, `taken`, `told`, `written`). Exclude an adjective/copular exception set such as `tired`, `ready`, `aware`, `afraid`, `interested`, `married`, `gone`, `open`, `closed`; do not attempt phrasal-verb or agent detection. Range covers the full matched predicate; metadata includes the auxiliary, participle, and a low/medium confidence. No automatic replacement.

### Complex words and phrases

`simple-alternatives.ts` exports versioned entries such as `approximately → about`, `commence → start`, `demonstrate → show`, `determine → find out`, `facilitate → help`, `implement → use`, `numerous → many`, `obtain → get`, `purchase → buy`, `require → need`, `subsequently → later`, `utilize → use`, plus multi-word entries such as `in order to → to` and `at this point in time → now`. Match case-insensitively at token/phrase boundaries; sort or trie-match longest phrase first to prevent overlapping duplicates. Suggestions preserve all-caps/title-case/initial lowercase where the alternative can be safely transformed. Metadata retains original lexicon key and `{ label, replacement }[]` for one-click replacement later.

## Normalized result model

```ts
type FindingCategory =
  | 'hard_sentence' | 'very_hard_sentence'
  | 'adverb' | 'qualifier' | 'passive_voice' | 'complex_word'
  | 'grammar' | 'spelling' | 'punctuation';

type FindingSeverity = 'info' | 'warning' | 'critical';

type TextFinding = {
  id: string; // stable FNV hash of engineVersion/category/range/matched text
  category: FindingCategory;
  severity: FindingSeverity;
  textStart: number;
  textEnd: number;
  excerpt: string;
  message: string;
  explanation: string;
  confidence?: 'low' | 'medium' | 'high';
  suggestions?: Array<{ label: string; replacement: string; kind: 'local' | 'ai' }>;
  metadata: Record<string, string | number | boolean | string[]>;
};

type MappedFinding = TextFinding & {
  pmFrom: number;
  pmTo: number;
  editorGeneration: number;
  isStale: boolean;
};
```

`normalizeFindings` verifies category, range, excerpt equality, finite metadata, and legal suggestions; drops malformed/out-of-bounds worker output; sorts by `textStart`, then longer range first, then category priority. Grammar later uses the same model with `metadata.issueSubtype`, `suggestions[0]`, and server-provided confidence.

## Decorations, clicks, and toggles

Implement `analysis-extension.ts` as a Tiptap `Extension` whose `addProseMirrorPlugins` creates one keyed `Plugin<AnalysisPluginState>`. Plugin state stores all mapped findings, visible categories, stale status, and a `DecorationSet`; it never mutates document nodes.

Commands send plugin metadata:

- `replaceAnalysis({ generation, findings, visibleCategories })` validates a current result and rebuilds the set.
- `setVisibleCategories(categories)` rebuilds only decorations from stored mapped findings; no worker request.
- `clearAnalysis()` empties state on document switch or Write mode.

On every transaction, map the existing `DecorationSet` and mapped PM ranges through `tr.mapping` for provisional visual stability. A document-changing transaction marks state stale; fresh matching worker output replaces it. Never rebuild the Tiptap editor because findings or toggles changed.

Decorations use `Decoration.inline(pmFrom, pmTo, attrs, spec)`. The priority/layer rule is:

1. sentence severity is a low-opacity background (`hard` yellow, `very hard` red);
2. word/phrase findings are nested foreground underline/outline layers (`adverb`, `qualifier`, `passive` blue; `complex` purple);
3. selected/hovered finding uses an outline and must remain visible above every category;
4. grammar later uses green underline, not an opaque background.

Avoid relying on nested DOM attributes to identify clicks. In the plugin `handleClick`, use the clicked ProseMirror position and the plugin state's mapped finding index to select all findings containing it, then choose the narrowest range; ties use selected finding, then category priority `grammar > complex_word > passive_voice > qualifier > adverb > very_hard_sentence > hard_sentence`. Dispatch a callback/event with the actual `MappedFinding`. This works despite nested/overlapping decoration spans. A later popover verifies `editorGeneration` and the exact current text range before offering a replacement.

Persist category visibility under an allowlisted `settings` key such as `analysisVisibility`, defaulting every deterministic category to `true`. Write mode clears/hides decorations; Edit restores visible categories from cached current analysis or schedules analysis immediately; Feedback has no inline decorations.

Define semantic CSS tokens now, not literal component colors:

```css
--analysis-hard-bg; --analysis-very-hard-bg;
--analysis-style-line; --analysis-complex-line; --analysis-grammar-line;
--analysis-selected-outline;
```

Provide light/dark values later in the theme work.

## Sidebar state

Edit-mode `AnalysisPanel` receives `AnalysisResult | null`, toggle state, selected finding ID, and callbacks. It contains:

1. **Readability:** grade or `—`, target preset, and a short transparent caveat.
2. **Document:** words, sentences, paragraphs, characters, letters, reading time.
3. **Style:** six toggleable rows with count and semantic swatch: hard, very hard, adverbs, qualifiers, possible passive voice, complex words.
4. **Issue detail:** only on explicit click, with explanation and local alternatives when present.

The panel never invents findings/scores while analysis is unavailable, stale, or disabled for a large document.

## Scheduling and performance

- Create one reusable module worker after the editor is available; terminate it on editor-app unmount.
- In Edit mode, schedule analysis 250 ms after the latest content-changing transaction. Rapid edits reset the timer. On entering Edit or opening a document already in Edit, schedule immediately.
- Write mode does not schedule new analysis and hides/clears decorations. Cached result may remain in coordinator memory only for the active generation.
- No network, database, React state update per token, or worker call happens directly in the typing transaction.
- Normal target: documents up to 100,000 projection characters. The worker must use linear passes; do not repeatedly `slice` the whole document in detector loops.
- 100,001–300,000 characters: show a non-blocking large-document message, analyze changed/current text blocks after 250 ms, and defer full analysis until 2,000 ms idle.
- Above 300,000 characters: show statistics only and require explicit user action for a full analysis; never freeze the editor.

Performance fixtures should be synthetic 1,000-, 5,000-, and 10,000-word documents with mixed paragraphs/lists. CI assertions should catch accidental quadratic growth rather than enforce fragile microsecond targets: 10,000 words completes in a worker within a generous 1.5 s local test budget and no detector may scan the same full string per lexicon entry.

## Exact test plan

### Unit

- Projection: one/multiple paragraphs; heading+paragraph; bold; italic; link; blockquote; bullet/ordered lists; repeated identical text; Unicode/emoji; hard break after validator preflight; empty blocks; separator-unmappable ranges.
- Mapping: every mapped range returns exact `doc.textBetween`; repeated identical text maps the requested instance; a sentence spanning bold/link segments maps to one PM range; stale/unmappable separator ranges are dropped.
- Statistics: empty; one sentence; multiple paragraphs; contractions; em dash; list items; Unicode code points.
- Segmentation: abbreviations, decimals, initials, closing quotes, ellipses, multiple sentences, headings, and list items with no punctuation.
- Readability: known simple/difficult fixture, empty input, fewer-than-three-word input, all target thresholds, and red-exclusive-over-yellow behavior.
- Syllables: `cat`, `make`, `table`, `queue`, `people`, `business`, `rhythm`, contractions, and punctuation-stripped words.
- Detectors: true/exception adverbs; every qualifier type including multi-word boundaries; passive true positives and adjective false positives; complex single/multi-word replacements; exact substrings/offsets for every output.
- Normalization: malformed/out-of-bounds ranges, overlap ordering, and stable IDs.
- Worker coordinator: older request/result rejected after newer generation/result; toggles do not invoke worker.

### Editor/integration

- Position semantics proof remains green against the installed schema.
- Plugin builds decorations for mapped findings, hides category decoration without content mutation, maps provisional decorations through a transaction, clears on document switch, hides in Write, and restores only in Edit.
- Click tests choose narrowest/highest-priority finding at overlap and expose the exact PM range.
- E2E: Edit shows real counts from a fixture; toggles alter only highlights; a click opens correct detail; typing while worker result is delayed never applies stale result; Write has no decorations.

## Dependencies

No new dependency is justified for this phase.

- `Intl.Segmenter` is native, worker-safe, offset-preserving, and has a deterministic fallback for older environments.
- `@tiptap/core`, `@tiptap/pm/state`, and `@tiptap/pm/view` are already transitively installed with Tiptap and provide the schema, plugin, transaction mapping, and `DecorationSet` primitives required.
- A full NLP/POS library would increase bundle/worker cost and still would not provide certainty for passive voice; conservative heuristics plus curated local data are a better fit.
- A pronunciation dictionary is disproportionate for FK estimation; the exception-backed heuristic above is transparent and testable.

## Luna implementation sequence

1. Correct hard-break canonical validation and add its persistence regression test; add the projection module and full mapping fixtures before any detector.
2. Implement worker-safe types, tokenizer, statistics, sentence segmentation, and syllables with tests.
3. Implement FK/readability targets and sentence difficulty with threshold tests.
4. Implement dictionaries and detectors one module at a time with exact offset tests.
5. Build worker protocol and coordinator stale-result tests; keep it invisible in UI first.
6. Add the decoration extension/plugin with mapping, category filtering, Write/Edit clearing, and overlap/click tests.
7. Build the Edit sidebar and persisted toggles; run E2E fixture flows and performance fixtures.
8. Review against this document before adding grammar or any AI action.
