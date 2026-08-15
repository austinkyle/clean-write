# ADR-003: Use a constrained AST and reviewed top-level block replacement for Make Skimmable

## Status

Accepted

## Date

2026-08-14

## Context

ClearWrite’s current AI edits replace inline text only after proving a current ProseMirror range and source text. Make Skimmable needs a selected dense passage to become several native editor blocks, such as a heading, short paragraphs, and a list. Letting a model emit HTML, Markdown, arbitrary Tiptap JSON, or an editor command would bypass the canonical content validator, complicate stale handling, and make formatting or URL changes unsafe.

## Decision

Use a narrow v1 transformation: an explicit contiguous selection of complete top-level paragraphs/headings, without links, hard breaks, quotes, or lists. The provider returns one strictly validated ClearWrite-owned AST candidate. It can generate paragraphs, headings 1–3, bullet/ordered lists with one paragraph per item, and bold/italic text only.

Convert the AST deterministically to canonical Tiptap JSON and validate it with `parseDocumentContent`. Accept it only through a new `replaceEditorBlocks` operation in the existing `replacement.ts` authority. The operation proves document ID, editor generation, exact top-level boundaries, canonical current source slice, and stable source hash before one undoable ProseMirror transaction. The user reviews a read-only preview and explicitly accepts it.

Route the action through the existing server AI seam using Terra low reasoning, one 1,600-token structured response, `store:false`, and bounded source/context data. The model is a candidate generator, never an editor or persistence actor.

## Alternatives considered

### Transform selected text inside the current paragraph

Rejected: a structure-changing result cannot be represented safely by the inline replacement contract.

### Whole-document or Feedback-driven transform

Rejected: it makes accidental manuscript-scale replacement too easy and does not provide a narrower source proof.

### Provider returns HTML, Markdown, or raw Tiptap JSON

Rejected: each permits unsupported nodes, attributes, unsafe links, or a second parser/normalizer outside ClearWrite’s canonical content gate.

### Preserve links, quotes, and nested lists in v1

Rejected: correctly retaining their semantics during structural reshaping needs explicit source-preservation rules and broader replacement tests. The first release should reject them rather than silently degrade them.

### Two AST alternatives per request

Rejected for v1: two sizeable structures make comparison and the 1,600-token budget less reliable. Regenerate is the reviewed alternative mechanism.

## Consequences

- Make Skimmable remains editable and export-compatible because it creates only existing canonical nodes.
- A current inline replacement remains unchanged; structural replacement gains stricter root-boundary and canonical-slice proof.
- Editing after request creation makes the candidate stale instead of trying to find matching text elsewhere.
- Later support for links, blockquotes, nested lists, multiple alternatives, or document-scale transformations requires a new decision and test evidence.
