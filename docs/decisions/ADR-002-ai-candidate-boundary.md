# ADR-002: Keep AI candidate-only behind a server provider seam

## Status

Accepted

## Date

2026-08-13

## Context

CleanWrite already has canonical Tiptap JSON, client-local editor generations,
exact ProseMirror ranges, and one validated replacement helper. AI features
need remote text generation but must preserve local-first ownership, undo
semantics, formatting safety, and optional configuration.

## Decision

Use stateless, server-only Responses API requests through one small
`AIProvider` interface, initially `OpenAIProvider`. The model produces
schema-validated candidates only. The browser reviews candidates and applies a
chosen one exclusively through the existing centralized replacement path after
document ID, generation, range, and expected text are revalidated.

Use `store: false`, no hosted conversations/files/tools, a closed action
registry, strict Zod response schemas, and centralized model routing. Grammar
returns source-relative findings that are locally reconciled; it never supplies
trusted ProseMirror positions.

## Alternatives considered

### Let the provider return editor commands or HTML

Rejected: this would couple a remote response to editor state, complicate stale
handling, and permit unsafe structures outside the canonical validator.

### One route per AI button with provider calls in components

Rejected: it duplicates security, prompt, timeout, model, and error handling,
and makes a future provider change cross-cutting.

### Persist Response threads for regeneration

Rejected: rewrite operations are independent and stateless requests minimize
remote persistence and accidental context disclosure.

## Consequences

- AI may be unavailable without impairing local writing.
- Candidate acceptance remains one undoable ProseMirror transaction.
- Tests inject a fake provider; no live key is required for CI.
- Make Skimmable requires a separately validated block-slice extension of the
  existing replacement helper before it can ship.
