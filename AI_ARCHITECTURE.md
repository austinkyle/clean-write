# AI Architecture — ClearWrite

## Status and decision

This is the implementation contract for Phases 6 and 7. It adds optional,
server-only AI assistance without changing ClearWrite's local-first source of
truth: canonical Tiptap JSON in SQLite and the mounted Tiptap editor remain
authoritative. It does not authorize live AI calls in this architecture pass.

The existing editor has the required safety seam:

```text
selection or finding snapshot
  -> validated AI request -> candidate-only response -> review UI
  -> current editor range revalidation -> replaceEditorRange(...)
  -> one ProseMirror history transaction -> autosave -> local re-analysis
```

The provider never receives an editor object and never mutates editor state.
`src/features/editor/replacement.ts` remains the only mutation path. Its
current text replacement contract must be reused unchanged for inline AI
actions; Pass B may extend that *same helper* with a separately validated block
slice replacement for Make Skimmable.

## Existing contracts inspected

- Canonical content is restricted by `src/features/documents/content.ts` to
  paragraphs, headings 1–3, blockquotes, lists, text, hard breaks, bold,
  italic, and safe links. It is the only acceptable rich output target.
- `projectDocument` and `mapTextRange` use exact UTF-16 projection offsets and
  ProseMirror positions. Artificial block separators are intentionally
  unmappable.
- A `MappedFinding` holds `pmFrom`, `pmTo`, `excerpt`, and a client-local
  `editorGeneration`. Decorations become stale after a document-changing
  transaction.
- `replaceEditorRange` checks document ID, editor generation, range, and exact
  current text before dispatching one undoable transaction. It must not be
  bypassed or replaced by text search.
- SQLite `revision` protects autosave ordering. It is not an editor-generation
  substitute and must not gate interactive analysis or AI acceptance.
- Current settings are browser localStorage only for readability target and
  finding visibility. The SQLite `settings` table has no service/UI yet; there
  is no dialect setting or settings API. Phase 6 must add a small typed settings
  service for dialect rather than pretend one exists.
- Import/export accepts only canonical content. AI rich output must use the same
  validator, never raw HTML rendering.

## Server-only boundary

```text
client hooks/components
  -> POST /api/ai/{rewrite|synonyms|grammar|feedback}
  -> route schema + same-origin guard + request limits
  -> AiService + closed ActionRegistry
  -> AIProvider.executeStructured(...)
  -> OpenAIProvider (only module importing `openai`)
  -> validated response/view model
```

Suggested files:

```text
src/features/ai/
  types.ts                 # client-safe request/result/view model types
  actions.ts               # closed action registry and model classes
  schemas.ts               # Zod request/response schemas
  dialect.ts               # one normalized dialect enum and labels
  prompts/{base,rewrite,grammar,feedback}.ts
  rich-output.ts           # constrained skimmable AST -> canonical JSON
src/server/ai/
  config.ts                # server-only env parsing and model overrides
  provider.ts              # provider-neutral interface and error classes
  openai-provider.ts       # the only OpenAI SDK import
  service.ts               # validation, context, cache, retries, telemetry
  grammar-reconciliation.ts
src/app/api/ai/{rewrite,synonyms,grammar,feedback}/route.ts
src/components/ai/{SelectionAiToolbar,RewriteReviewDialog,FeedbackPanel}.tsx
```

`features/ai` must not import `openai`, Node APIs, SQLite, or editor objects.
Routes stay thin: parse, verify local request origin, call the service, then
serialize a stable result/error envelope. Only `server/ai` reads
`process.env.OPENAI_API_KEY`.

## Provider seam and current OpenAI integration

Use one deliberately small interface:

```ts
export interface AIProvider {
  readonly id: 'openai';
  isConfigured(): boolean;
  executeStructured<T>(request: ProviderStructuredRequest<T>): Promise<ProviderResult<T>>;
}
```

`ProviderStructuredRequest<T>` contains the resolved model, reasoning effort,
output cap, server-built instructions, JSON data packet, Zod schema, and an
`AbortSignal`. It never receives a route `Request`, editor instance, arbitrary
client model ID, or raw unvalidated body. `AiService` owns the action registry,
context construction, retry policy, output validation, and provider-independent
errors. A `FakeAIProvider` implements the same interface in tests.

Use the current official JavaScript SDK and the Responses API. The intended
OpenAI adapter pattern is:

```ts
const response = await openai.responses.parse({
  model: request.model,
  store: false,
  instructions: request.instructions,
  input: [{ role: 'user', content: request.dataPacket }],
  reasoning: { effort: request.reasoningEffort },
  max_output_tokens: request.maxOutputTokens,
  text: { format: zodTextFormat(request.schema, request.schemaName) },
}, { signal: request.signal, maxRetries: 0 });

if (response.status === 'incomplete') throw new AIOutputLimitError();
if (response.output_parsed === null) throw new AIInvalidResponseError();
return request.schema.parse(response.output_parsed);
```

At implementation time, pin a current `openai` release compatible with the
existing Zod 4 dependency, and first add a compile/runtime proof for
`responses.parse` plus `zodTextFormat`. The SDK-parsed value is parsed by the
action schema again; structured output reduces malformed JSON, but it is not a
trust boundary. Do not fall back to manual JSON/Markdown parsing. Do not add
tools, `previous_response_id`, background mode, Assistants, threads, vector
stores, or hosted document/files APIs.

Responses are stored by default, so every request sets `store: false`. Requests
are stateless: no returned response/reasoning item is retained or replayed.
Only selected text and bounded local context are sent.

This pattern was verified against OpenAI's current [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), which documents `responses.parse`, `zodTextFormat`, and `output_parsed`, and its [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses), which documents that Responses are stored by default and `store: false` disables storage. Current [model guidance](https://developers.openai.com/api/docs/guides/latest-model) and the [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)/[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) model pages support the selected Responses, structured-output, and reasoning-effort configuration.

## Configuration and model routing

`OPENAI_API_KEY` is the only secret. It is read in `server/ai/config.ts`, never
placed in a `NEXT_PUBLIC_` variable, SQLite, settings JSON, localStorage,
client response, exception message, or log. If missing, `isConfigured()` is
false; the app remains usable and AI controls are disabled with: “Add your
OpenAI API key to enable AI tools.” The API returns `AI_UNAVAILABLE`, not a
provider exception.

Application settings contain only `dialect`. They are allowlisted, persisted
locally, and exposed through a typed settings route when Phase 6 implements
that small missing settings foundation. Model choice is server configuration,
not a browser preference. Defaults live in one `MODEL_ROUTING` table; optional
environment overrides are allowlisted model IDs:

```dotenv
OPENAI_API_KEY=
OPENAI_REWRITE_MODEL=
OPENAI_REVIEW_MODEL=
```

Use one internal enum everywhere: `us`, `british`, `canadian`, `australian`,
`indian`, `irish`, `south_african`, and `new_zealand`; its presentation labels
are US, British, Canadian, Australian, Indian, Irish, South African, and New
Zealand. `AiService` loads the allowlisted persisted setting as authoritative
and passes a single dialect instruction to all rewrite/grammar/feedback prompt
builders. The client may include its current value only as a validated stale
settings hint, not as a provider/model selector.

| Workload | Default model | Reasoning | Alternatives |
| --- | --- | --- | --- |
| Simplify, polish, rephrase, shorten, add detail, tone, finding rewrites | `gpt-5.6-luna` | `low` | 3 for Rephrase; otherwise 2 |
| Synonyms | `gpt-5.6-luna` | `none` | up to 8 terms |
| Grammar blocks | `gpt-5.6-luna` | `low` | n/a |
| Custom instruction | `gpt-5.6-terra` | `low` | 2 |
| Make Skimmable | `gpt-5.6-terra` | `low` | 1 structured candidate |
| Document feedback | `gpt-5.6-terra` | `medium` | one structured report |

Luna is the cost/latency default for repeated bounded transforms. Terra is
reserved for ambiguous instructions and document-level judgment. There is no
per-request escalation router in the first release; changing a default is one
configuration edit after representative evaluation. Never use `max` or Pro
mode by default for this writing workflow.

## Action registry

The registry is the closed server allowlist. It owns action ID, family, prompt
builder, response schema, model class, output cap, context policy, source-size
cap, alternatives, readability inputs, and semantic rules. The server ignores
client-provided model, prompt version, alternative count, and family.

| Family | IDs | Contract |
| --- | --- | --- |
| Inline rewrite | `simplify`, `polish`, `rephrase`, `shorten`, `add_detail`, `more_confident`, `more_friendly`, `more_casual`, `more_formal`, `more_persuasive`, `custom` | `RewriteResponse` |
| Finding rewrite | `hard_sentence_simplify`, `passive_rewrite`, `adverb_rewrite` | `RewriteResponse`; finding metadata informs the prompt only |
| Synonyms | `synonyms` | `SynonymResponse` |
| Rich block rewrite | `make_skimmable` | `SkimmableResponse` |
| Grammar | `grammar_fix` | `GrammarResponse` |
| Feedback | `document_feedback` | `FeedbackResponse` |

`simplify` receives current selected-sentence grade plus configured readability
target. `make_skimmable` receives target and selected grade where available.
`polish` receives neither by default; `synonyms` never receives readability.
All tone actions use one parameterized tone builder, not five handlers.

## Requests, context, and response contracts

The client submits a normalized, strict request with a UUID request ID,
document ID, local `editorGeneration`, source range, `expectedText`, action ID,
and optional custom instruction/finding metadata. The source range is an
ephemeral proof for later application, not a server-side mutation command. The
server validates every field and derives model/prompt/context itself.

```ts
type RewriteRequest = {
  requestId: string;
  documentId: string;
  editorGeneration: number;
  action: RewriteActionId;
  source: { from: number; to: number; text: string; textHash: string };
  context?: { before: string; after: string };
  customInstruction?: string;
  finding?: { category: FindingCategory; message: string; metadata: Record<string, Primitive> };
  dialect: Dialect;
};

type RewriteResponse = {
  alternatives: Array<{ id: string; text: string; rationale: string | null }>;
};
```

Responses do not return HTML, ProseMirror positions, provider IDs, prompts, or
model output prose outside the schema. Each alternative is plain text and must
be nonempty, bounded, and not contain a Markdown fence. Generate two candidates
for normal rewrites and three for Rephrase in one request. This provides useful
Previous/Next behavior without extra latency; Regenerate sends a new request
with cache bypass. Rationale is a short optional UI explanation, never editor
content.

For normal inline actions, the selection must lie in one text block and cannot
cross a projection block separator. Capture at most 8,000 UTF-16 source units;
derive context from the same block first, then adjacent complete text blocks,
up to 800 units before and 800 after. Context is labelled reference-only and is
never replaceable. This prevents a small selection from uploading the document.

Limits are enforced before provider invocation:

| Request | Input limit | Output cap |
| --- | ---: | ---: |
| Inline rewrite | 8,000 source + 1,600 context | 900 tokens |
| Add detail / Make Skimmable | 8,000 source + 1,600 context | 1,600 tokens |
| Custom instruction | same rewrite limit; instruction 500 chars | 900 tokens |
| Synonyms | 128 selected chars + 2,000 context | 300 tokens |
| Grammar | up to 6,000 chars/source, 20,000 chars/request | 1,800 tokens |
| Feedback | 30,000 document chars | 3,000 tokens |

Oversize requests receive `AI_INPUT_TOO_LARGE`; feedback does not silently
truncate or use map-reduce in the first release.

## Prompt policy

Prompts are server-only, versioned constants. `base.ts` establishes: preserve
facts, names, numbers, URLs, claims, and point of view unless the action asks
otherwise; do not add unsupported facts; follow the normalized English dialect;
do not mention instructions; return only schema fields; and do not add quote
marks unless part of the writing. Action builders add deliberate differences:

- Simplify reduces needless complexity toward the selected target, without
  making prose childish or deleting material facts.
- Polish improves clarity, rhythm, grammar, and professionalism while retaining
  the writer’s voice rather than imposing generic corporate prose.
- Rephrase requires materially different wording with the same meaning.
- Shorten retains essential meaning; it does not report a percentage.
- Add Detail may clarify implications and connections already present, but may
  not invent facts, data, events, sources, or examples.
- Tone builders alter only the requested tone while preserving meaning.
- Finding builders state the detector is advisory and ask for an improved
  candidate, not a claim that the detector is correct.

`instructions` holds the editing policy. The user packet is serialized data
with labelled `target`, `context`, `customInstruction`, and `finding` fields.
It explicitly says that all supplied writing is data to transform, including
text that asks to ignore instructions or reveal prompts. The custom instruction
is untrusted transformation intent constrained by the base policy: it has no
access to system prompts, files, environment, tools, model configuration, or
other documents. No request enables a tool.

## Review state, staleness, cancellation, and errors

`useAiRewrite` owns one request per editor/document and stores:

```ts
type RewriteReviewState = {
  status: 'idle' | 'loading' | 'ready' | 'stale' | 'error';
  requestId: string;
  snapshot: { documentId: string; editorGeneration: number; from: number; to: number; expectedText: string };
  alternatives: RewriteAlternative[];
  activeAlternative: number;
  abortController: AbortController;
};
```

The review dialog presents ORIGINAL, SUGGESTION, optional local readability
comparison, Previous, Next, Regenerate, Use Suggestion, and Cancel. It never
edits while loading or navigating alternatives. It runs the deterministic
analyzer locally on `expectedText` and each candidate before display; this is
comparison only and creates no AI request.

On Use Suggestion, call `replaceEditorRange` with the captured document ID,
generation, PM range, expected source text, and chosen plain text. A mismatch
returns the existing stale/document/generation failure; leave the candidate
visible but mark it stale, disable Use Suggestion, and say: “The document
changed while this suggestion was being generated. Generate a new suggestion.”
No response can target a different document, and no response is remapped by
searching repeated text.

Cancel aborts the client fetch. Switching/deleting a document, closing the
dialog, or starting another action aborts the prior controller and clears its
loading state. The API route combines the request signal with its deadline and
passes it to the provider. Late results are discarded unless request ID and
snapshot match active state; network cancellation is an optimization, stale
rejection is mandatory.

Use a 20-second deadline for rewrite/synonym/grammar and 35 seconds for
feedback. Configure the SDK with `maxRetries: 0`, then let `AiService` make at
most one explicit retry for connection failure, 408, 429, or 5xx after 250–750
ms jitter (respect a short Retry-After when available). Do not retry aborts,
invalid keys, bad input, unsupported models, refusals, incomplete output, or
schema failures. Map errors to `AI_UNAVAILABLE`, `AI_TIMEOUT`,
`AI_RATE_LIMITED`, `AI_INVALID_RESPONSE`, `AI_OUTPUT_LIMIT`, `AI_ABORTED`, and
`AI_PROVIDER_UNAVAILABLE`; raw provider payloads never reach the UI.

## Synonyms, grammar, and finding rewrites

`POST /api/ai/synonyms` is separate because it has a smaller specialized
schema:

```ts
type SynonymResponse = { suggestions: Array<{ text: string; note: string | null }> };
```

It returns one to eight distinct, concise, context-sensitive alternatives that
preserve grammatical role where possible. Selecting one still applies via the
normal range helper and stale checks.

`POST /api/ai/grammar` is separate because it produces findings, not a rewrite.
The client schedules it only in Edit mode after 1,500 ms idle; it aborts on a
new document change and never runs per keystroke. It submits changed/current
text-block snapshots (up to 6,000 chars each and 20,000 chars total). First
release behavior is hybrid: automatic debounced checks for changed blocks, plus
an explicit Check Grammar control when a document/selection exceeds the cap.

Each request has immutable source records `{ sourceId, text, textHash,
projectionStart }`. The model returns only source-relative UTF-16 offsets:

```ts
type GrammarResponse = {
  issues: Array<{
    sourceId: string; start: number; end: number; original: string;
    category: 'grammar' | 'spelling' | 'punctuation'; subtype: string;
    explanation: string; replacement: string; confidence: 'low' | 'medium' | 'high';
  }>;
};
```

Reconciliation accepts an issue only when `sourceId` belongs to this request,
offsets are in bounds, `source.text.slice(start, end) === original`, category
and lengths are valid, and `projectionStart + [start,end)` maps through the
captured projection with `mapTextRange`. It creates a normalized local finding
with snapshot generation/request metadata and a single `kind: 'ai'` suggestion.
Repeated text is safe because offsets are bound to one request-owned source;
there is never a global string search. A changed generation discards the whole
grammar response. Existing DecorationSet rendering and `replaceEditorRange`
handle grammar findings like local findings.

Use a process-local bounded LRU/TTL grammar cache keyed by model, prompt
version, dialect, and normalized source hash. TTL is 10 minutes, max 50
entries, no SQLite/cloud persistence, clear on restart, and never log its text.
Rewrites are not cached for Regenerate; identical in-flight calls are deduped.

Finding actions attach through the same rewrite endpoint and registry:
hard/very-hard sentence -> `hard_sentence_simplify`; possible passive ->
`passive_rewrite`; adverb/qualifier selection -> `adverb_rewrite`. Findings stay
advisory and their excerpts remain replacement proof.

## Feedback and Make Skimmable

`POST /api/ai/feedback` is document-level and has no source range/editor
mutation:

```ts
type FeedbackResponse = {
  overallSummary: string;
  strengths: Array<{ title: string; detail: string }>;
  priorityImprovements: Array<{
    rank: number; category: FeedbackCategory; title: string; detail: string; recommendation: string;
  }>;
  areas: Array<{ category: FeedbackCategory; assessment: string }>;
};
```

`FeedbackCategory` is clarity, organization, logic, flow, tone, concision,
repetition, or consistency. Array caps are 3 strengths, 5 priority
improvements, and 8 areas. The panel renders those fields directly for loading,
empty, error, generated, and regenerate states; it never parses Markdown. A
response is display-only, tied to document ID/content fingerprint, and marked
out of date after editing. Over 30,000 characters shows a helpful limit state;
the app does not upload a truncated document.

Make Skimmable is not an inline plain-text rewrite. The implemented v1 action
is documented in `MAKE_SKIMMABLE_ARCHITECTURE.md` and offered only when the
selection exactly covers eligible whole top-level prose blocks. The model
returns one tiny constrained AST (`paragraph`, `heading` level 1–3,
`bulletList`, `orderedList`, `listItem`, `text`, `bold`, `italic`) rather than
HTML or Markdown. Validate with Zod, convert to existing Tiptap JSON, then call
`parseDocumentContent`. `replaceEditorBlocks` in `replacement.ts` proves the
canonical source slice, stable hash, document, generation, and boundaries before
one history transaction. That is the same authoritative mutation boundary with
stricter block proof—not an AI editor API. Reject unsupported nodes/marks/links
and never use `dangerouslySetInnerHTML`.

## Privacy, security, logging, and concurrency

The threat model is proportional to a loopback personal app, but local endpoints
remain untrusted boundaries.

| Risk | Required mitigation |
| --- | --- |
| Key exposure | Server-only env loader; no public variable, storage, logs, or error echo |
| Remote persistence | `store: false`; stateless requests; no threads/files/vector stores |
| Prompt injection in writing | Server instructions/policy; labelled data packet; no tools or agent capabilities |
| Oversized/costly input | Per-action server limits and input validation before provider call |
| Unsafe/rich model output | Strict schema, local parse, canonical validator, no raw HTML |
| Stale/racing result | Request IDs, document/generation/text proof, centralized replacement revalidation |
| Duplicate clicks | Disable active action, abort superseded request, one in-flight key, global provider cap 2 |
| Local request spoofing | Same-origin Origin/Host validation for AI POST routes, strict JSON schemas, loopback binding, no body-selected model |
| Content in diagnostics | Never log selected text, documents, prompts, raw responses, or API keys |

Keep a small in-memory usage record for 24 hours (or a bounded local SQLite
metadata table only if persistence is later justified): request ID, action,
model, input/output token counts, latency, cache/retry flag, and coarse error
class. It contains no writing. It is not billing, telemetry, or cloud analytics.

## Test strategy

No automated test may call OpenAI. Inject `FakeAIProvider` into `AiService` and
use synthetic content only.

- Unit: registry completeness, strict limits, prompt data boundaries, response
  schemas, Zod revalidation, dialect propagation, model routing, rich AST
  rejection, and error/retry rules.
- Unit: grammar reconciliation with repeated text, emoji UTF-16 offsets,
  malformed/overlapping/out-of-block results, and stale generation rejection.
- Integration: fake successful rewrites, alternatives, synonyms, grammar,
  feedback, provider substitution, unavailable key, timeout, 429, malformed
  output, cancellation, retry-once, no retry for abort/schema failure, cache,
  and no writing in usage/log capture.
- Browser: selection -> review -> accept -> undo/redo; stale edit; cancel/switch
  late response; grammar debounce; Feedback states; unavailable controls; and
  no secret/config in browser bundles or API JSON.
- Optional manual smoke: explicit opt-in key, one `store:false` request, no CI.

## Luna implementation order

### Pass A — bounded selected-text AI

1. Add `openai` and a current-SDK/Zod structured-output proof; add server-only
   config and typed dialect settings. Do not create `.env.local`.
2. Add provider-neutral types, `AIProvider`, `OpenAIProvider`, fake provider,
   action registry, centralized prompts, routes, error envelope, request caps,
   origin guard, timeout/retry/cancellation, and privacy-safe usage metadata.
3. Implement inline rewrites, selection toolbar, custom instruction, review
   dialog, local readability comparison, and stale-safe acceptance through the
   existing replacement helper.
4. Add synonyms and finding-based rewrite entry points through that service.
5. Complete unit/integration/E2E evidence before exposing a real key path.

### Pass B — AI analysis and structured review

1. Add grammar schemas, scheduling, snapshotting, reconciliation, cache,
   green findings, and accept/reject UI.
2. Add Feedback request/render/regenerate with the strict feedback contract.
3. Make Skimmable is implemented through the canonical block-slice extension,
   strict AST conversion, Terra route, preview, and ProseMirror/history tests.
4. Run all non-AI regressions, fake-provider suites, then one optional live
   smoke.

## Open questions to resolve with tests, not assumptions

1. Pinning must prove the current SDK helper works with the project’s Zod 4;
   `responses.parse`/`zodTextFormat` is the chosen API, but compatibility is a
   Pass A gate.
2. Evaluate Luna grammar on a fixed synthetic dialect fixture. If it misses the
   bar, change the single grammar model-class default to Terra; do not add a
   dynamic router first.
3. The Settings button is inert. Pass A must decide its minimal typed dialect UI
   while retaining existing local readability/visibility behavior.
4. Exact same-origin handling must cover `127.0.0.1` and the user’s intentional
   local hostname without accepting arbitrary Origin values.
