# Make Skimmable Architecture — ClearWrite

## Status

Implemented v1 contract (2026-08-14). The shipped implementation follows this
document; deferred expansions remain out of scope.

## A. Existing architecture reviewed

This proposal extends current contracts rather than creating a second rich-text
or mutation system.

- `src/features/documents/content.ts` is the canonical content gate. It accepts
  paragraphs, headings 1–3, blockquotes, bullet/ordered lists, list items,
  text, hard breaks, bold, italic, and protocol-checked links.
- `src/features/editor/replacement.ts` is the sole editor mutation authority.
  Its inline helper proves document, editor generation, range, and source text
  before a single undoable transaction.
- `src/features/analysis/projection.ts` maps text blocks. Its artificial block
  separators are unmappable, so it must not be used to infer structural
  replacement boundaries.
- Import normalizes external formats into canonical Tiptap JSON; export
  validates that same JSON. Generated content needs no AI-only node or exporter.
- The existing AI registry, strict Zod schemas, provider seam, Feedback review,
  cancellation, stale handling, and fake-provider test pattern are the seams
  for this action. Persistence remains the normal editor-autosave path.

## B. Recommended scope

Choose **B: an explicit contiguous selection of complete top-level blocks**.
Never default to an entire document and never apply Feedback directly.

For v1, source is one to twelve contiguous top-level `paragraph` or `heading`
nodes totaling 1–8,000 UTF-16 code units. The selection must start before the
first selected node and end after the last. A deliberate full-document selection
is only possible if it meets those same limits; it has no special shortcut.

Reject selections containing link marks, hard breaks, blockquotes, lists, or
nested items. Bold and italic source marks are allowed. This limits v1 to the
dense-prose use case and prevents silently dropping URL, quote, or nested-list
semantics. The disabled-action explanation is: “Select complete paragraphs or
headings without links or lists to make them skimmable.”

## C. Block replacement design

Keep `replaceEditorRange` unchanged for inline replacements. Add a separately
typed `replaceEditorBlocks` in the same `replacement.ts` module, sharing a
private document/generation validation helper. Do not expose a generic unchecked
`setContent`, an AI-specific editor command, or a text-search fallback.

```ts
type CanonicalBlockFragment = ReadonlyArray<TiptapNode>;

type BlockSelectionSnapshot = {
  requestId: string;
  documentId: string;
  editorGeneration: number;
  from: number; // document-child boundary, inclusive
  to: number; // document-child boundary, exclusive
  topLevelStart: number;
  topLevelEnd: number; // exclusive
  expectedSourceSliceJson: CanonicalBlockFragment;
  sourceHash: string; // stable canonical fragment serialization hash
};

type BlockReplacementRequest = {
  editor: Editor;
  snapshot: BlockSelectionSnapshot;
  currentDocumentId: string;
  currentGeneration: number;
  replacementSliceJson: CanonicalBlockFragment;
};
```

### Selection and acceptance proof

A pure resolver enumerates `editor.state.doc` children and records each child’s
content offset and `nodeSize`. It accepts a selection only if `from` and `to`
are exact top-level child boundaries, `from < to`, and each covered node is an
eligible v1 source node. It slices those exact positions, wraps the result in a
`doc`, and passes it through `parseDocumentContent` before capture.

The exact root-boundary semantics (`0..doc.content.size`) must be proven in
ProseMirror tests before implementation. The inline helper’s `from >= 1` rule
does not apply to this structural path.

At acceptance, `replaceEditorBlocks` must:

1. Match captured/current document ID and editor generation.
2. Re-resolve `from`/`to` as top-level boundaries and confirm the indexes still
   cover that exact span.
3. Rebuild and canonically validate the current slice.
4. Stable-serialize it and require equality with both the captured JSON and hash.
5. Canonically validate the candidate and enforce the generated v1 allowlist.
6. Build active-schema ProseMirror nodes and replace exactly that slice with one
   `closeHistory(editor.state.tr)` transaction. Set
   `clearwrite-block-replacement` metadata, dispatch once, then focus normally.

No remapping by repeated text, partial application, or whole-document mutation
is permitted. Failures are typed as stale, document mismatch, generation
mismatch, invalid range, or invalid replacement and leave the preview visible
but unusable. One transaction preserves undo/redo. Existing editor updates then
perform autosave and fresh deterministic analysis normally; this path does not
write SQLite or invoke analysis itself.

## D. ClearWrite-owned AST contract

The provider returns one candidate in v1. One reviewable structure is safer than
two competing large ASTs under the existing 1,600-token cap; Regenerate is the
explicit alternative mechanism. This refines the earlier two-alternative
placeholder in `AI_ARCHITECTURE.md`.

```ts
type SkimmableMark = { type: 'bold' } | { type: 'italic' };

type SkimmableText = {
  type: 'text';
  text: string;
  marks?: SkimmableMark[];
};

type SkimmableInline = SkimmableText[];

type SkimmableBlock =
  | { type: 'paragraph'; content: SkimmableInline }
  | { type: 'heading'; level: 1 | 2 | 3; content: SkimmableInline }
  | {
      type: 'bulletList' | 'orderedList';
      items: Array<{ content: SkimmableInline }>;
    };

type SkimmableResponse = { fragment: SkimmableBlock[] };
```

The response has no `doc` root, raw Tiptap `attrs`, HTML, Markdown, URLs, or
ProseMirror positions. Generated headings 1–3 are canonical-safe; the prompt
prefers level 2/3 and permits level 1 only for a true document-level section.
Every generated list item is exactly one paragraph of inline content.

| Structure | v1 decision | Reason |
| --- | --- | --- |
| Paragraph and heading 1–3 | Allow | Existing canonical nodes with bounded inline content. |
| Bullet and ordered list | Allow | Existing list/listItem/paragraph shape is deterministic. |
| Bold and italic | Allow | Existing safe marks; semantic use only. |
| Blockquote | Do not generate | It implies quotation semantics requiring a preservation policy. |
| Link | Do not generate or accept in source | The model must not create, alter, or silently drop a URL. |
| Hard break, nested list, tables, code, embeds, HTML | Reject | Outside the dense-prose v1 contract. |

## E. Local validation rules

Structured Outputs reduces malformed JSON but is not a trust boundary. Validate
in layers:

1. The route accepts only a strict request and server-owned action ID. The
   browser retains the ProseMirror snapshot; the server receives bounded source
   data, hashes, context, dialect, and optional readability target.
2. A strict Zod discriminated union rejects unknown keys, unsupported nodes and
   marks, attributes, empty/non-string text, and malformed lists.
3. Enforce 1–30 output blocks, 2–12 items/list, 40 total items, 80 text runs per
   block, heading text of 1–200 characters, and no newline, NUL, or disallowed
   control character in a text run.
4. Allow only unique `bold`/`italic` marks in fixed `bold`, then `italic` order.
   Limit depth to fragment → block → item → inline.
5. Require non-whitespace content for each paragraph, heading, and list item.
   Bound output plain text to `min(12_000, ceil(sourceLength * 1.5) + 500)`;
   reject, never truncate, oversized output.
6. Convert only validated AST to a canonical document wrapper, call
   `parseDocumentContent`, then assert the resulting fragment still contains
   only the generated v1 node/mark subset.
7. Parse that canonical candidate again before active-schema node construction
   and repeat the source-snapshot proof immediately before mutation.

Provider failure, refusal, schema failure, or local validation failure is a
non-destructive error; there is no fallback HTML, Markdown, or loose JSON parser.

## F. Deterministic conversion pipeline

```text
SkimmableResponse.fragment
  -> validateSkimmableAst
  -> skimmableAstToCanonicalFragment
  -> parseDocumentContent({ type: 'doc', content: fragment })
  -> editor.schema.nodeFromJSON for each canonical node
  -> replaceEditorBlocks
```

The pure converter emits marks in fixed order, maps paragraph/heading inline
content directly, and maps each list item to one canonical `listItem` containing
one canonical `paragraph`. It never receives raw model JSON after schema
validation and never copies formatting by position. Source bold/italic is sent
as structured input so the model can retain meaningful emphasis; accepted mark
placement belongs to the reviewed candidate. Thus a bold sentence may become a
bullet with a bold key phrase, without pretending formatting is perfectly
reconstructed.

## G. Model recommendation

Use **`gpt-5.6-terra` with low reasoning and a 1,600-token cap** for the closed
`make_skimmable` action. Structural judgment favors Terra over frequent inline
rewrites; low reasoning contains latency and cost. Reuse the server-only action
registry, `store:false`, no tools, existing retry policy, no cache, and existing
provider concurrency cap. The browser cannot select a model.

## H. Prompt and context architecture

Add a server-only, versioned Make Skimmable prompt builder. Immutable
instructions require preservation of facts, claims, names, numbers, qualifiers,
point of view, voice, and dialect; hierarchy only when useful; no excessive
bullets; no invented sections, examples, citations, or URLs; and only schema
fields in the response.

The packet is labelled data, not executable instructions:

```ts
{
  source: { fragment: SkimmableSourceBlock[], text: string, hash: string },
  context: { before: string, after: string },
  dialect: Dialect,
  readabilityTarget?: ReadabilityTarget
}
```

`SkimmableSourceBlock` represents only allowed paragraph/heading content with
bold/italic marks. `before` and `after` are reference-only plain text capped at
800 characters each; selected source is capped at 8,000. Do not send the whole
document, title, Feedback, analysis findings, persistence revision, or editor
positions. The readability target is soft guidance; omit local grade/score to
avoid incentivizing over-simplification. The packet says source text may contain
instructions but is untrusted writing to transform. The model has no tools,
files, browser state, system prompt, or other-document access.

## I. Preview UX

Choose **B: explicit preview**, as a focused side-by-side dialog:

```text
Selected blocks (read-only)  |  Skimmable structure (read-only)
                             |  [Cancel] [Regenerate] [Replace 3 blocks]
```

Enable the action only for a valid v1 structural selection. Requesting captures
the immutable snapshot and disables duplicate requests. Render the candidate
using a controlled React renderer or read-only Tiptap instance built from the
canonical candidate, never `dangerouslySetInnerHTML` or model HTML. Show a
block-count summary and an obvious stale banner.

Cancel aborts/closes without mutation. Regenerate makes a fresh request and
snapshot only while the source is current. Replace is explicit, names the source
block count, and is disabled during loading/error/invalid/stale states.

## J. Stale safety and acceptance

The client assigns a UUID request ID and holds one active skimmable request per
editor/document. Starting another AI action, switching/deleting a document,
closing the dialog, or editing invalidates the review and aborts where possible.
A late result is discarded unless request ID and snapshot still match.

An edit after generation cannot overwrite newer writing: editor change marks the
preview stale, and Replace repeats document ID, generation, top-level-boundary,
canonical-slice, and stable-hash checks immediately before its one transaction.
A mismatch requires regeneration; the implementation never tries to locate the
content by text search.

On success, normal editor dispatch supplies undo, triggers normal autosave,
invalidates generation-bound findings, and schedules fresh local analysis. No
AI flow directly writes persistence or bypasses transactions.

## K. Test strategy

Use synthetic documents and `FakeAIProvider`; no automated test makes a real
provider call or needs a key.

- **AST/converter units:** valid combinations; strict unknown-key rejection;
  invalid heading/list/text/marks; oversized/deep output; links, quotes, hard
  breaks and arbitrary attributes; deterministic JSON; final canonical rejection.
- **Selection/replacement units:** first/last root boundaries; partial selection
  and separator rejection; source eligibility; exact source hash/JSON checks;
  document/generation mismatch; one-to-many replacement; undo/redo; no mutation
  on every failure branch.
- **Service units:** Terra-low routing with `store:false`; limits; prompt/data
  separation; injection text as data; cancellation/timeout/retry; malformed
  output; unavailable provider; no writing/prompt/key in errors or usage logs.
- **Browser tests:** eligible selection → preview → accept → autosave/fresh
  analysis; Cancel; Regenerate; edits during loading/review; late result;
  document switch; undo/redo; unavailable/oversize states; no HTML injection.
- **Compatibility tests:** DOCX, Markdown, HTML, and TXT exports contain only
  ordinary canonical nodes, with no AI metadata.

## L. Security review

| Risk | Control |
| --- | --- |
| Arbitrary PM/HTML injection | Strict owned AST, deterministic converter, canonical parser, active-schema construction, no raw HTML. |
| Unsafe URL | Reject links in source/output; AST has no URL field. |
| Prompt injection | Server policy, labelled data, no tools/files/conversations, stateless `store:false`. |
| Oversized cost/output | Fixed input/context/output/block/run/item limits; reject rather than truncate. |
| Stale overwrite | Request ID, document/generation, exact top-level boundaries, canonical slice and hash proof. |
| Secret/content exposure | Existing server-only key path; never log text, prompts, raw response, or key. |
| Local API misuse | Reuse strict schema, same-origin/loopback guard, closed action registry, timeout/cancellation/cap. |

## M. Exact Luna implementation order

1. **Phase A — structural mutation proof:** pure top-level block resolver and
   `replaceEditorBlocks`, sharing existing snapshot checks; write root-boundary,
   stale, one-transaction, undo/redo, and no-mutation tests first.
2. **Phase B — AST contract:** client-safe types, strict Zod response/source
   schemas, deterministic converter, eligibility checks, canonical final parse,
   and limit tests. Do not accept raw Tiptap fragments from the provider.
3. **Phase C — server action:** closed `make_skimmable` registry entry,
   Terra-low config, route schema, bounded context, prompt, `AiService`, fake
   provider coverage, `store:false`, and standard cancellation/error envelopes.
4. **Phase D — reviewed UI:** selection eligibility, request state, canonical
   read-only preview, Cancel/Regenerate/Replace, and stale behavior. Accept only
   through `replaceEditorBlocks`.
5. **Phase E — evidence:** browser, autosave, re-analysis, export,
   accessibility, security, and regression suites; live provider smoke is
   optional and explicit.

## Deferred work

Generated blockquotes, link-preserving transformations, nested lists, multiple
AST alternatives, Feedback shortcuts, and document-scale transforms require a
new decision and test evidence after the narrow contract is proven.
