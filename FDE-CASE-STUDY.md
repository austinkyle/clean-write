# CleanWrite — FDE case study

## Evidence boundary

A local writing product with optional AI assistance. Code and test sources were inspected October 5, 2026; this documentation cleanup did not rerun the application/browser suites. The repository demonstrates implementation and acceptance-test design, not a client engagement, observed commercial workflow, production adoption, or measured business outcome.

## 1. Observe: workflow and constraint

**Modeled workflow:** write/import a draft, inspect readability, request a focused suggestion, compare it with the source, apply or reject it, then export. The constraint is improving text without losing document ownership or applying a suggestion to content that has since changed.

**Discovery still required:** watch actual editing sessions; record tools, selection/copy handoffs, revision mistakes, approval steps, edit/review time, privacy requirements, and export needs. The product's design choices are not evidence that this shadowing happened.

## 2. Route: software, AI, human

| Work | Owner | Evidence / reason |
| --- | --- | --- |
| Store documents, calculate readability, map findings and import/export | Software | [Document service](src/server/documents/service.ts), [analysis pipeline](src/features/analysis/pipeline.ts), [import/export](src/server/import-export/service.ts). |
| Suggest rewrites, grammar changes, feedback and skimmable structure | Optional AI | [Server AI boundary](src/server/ai/service.ts), [schemas](src/features/ai/schemas.ts). These are candidate edits, not mutations. |
| Confirm source identity/range/freshness and apply an accepted replacement | Software | [Replacement functions](src/features/editor/replacement.ts) check document/generation and source text or structure before a history transaction. |
| Choose the wording, preserve meaning and decide whether to accept | Human writer | Suggestions require explicit review; editorial authority stays with the writer. |

## 3. Design for failure

| Failure | Implemented response | Limit |
| --- | --- | --- |
| Document or selection changes during generation | Mismatch/staleness checks prevent applying to another source | Tests prove specific mutation paths, not every future integration. |
| Invalid candidate or replacement structure | Schema validation and bounded response checks | Valid structure does not guarantee correct grammar or preserved meaning. |
| No AI key or provider failure | Local writing/analysis remains available; failed AI actions surface errors | Requested AI assistance is unavailable rather than silently accepted. |
| Private draft would reach a provider | AI runs only on requested actions through server-side configuration with `store: false` | Local-first is not an offline guarantee for AI actions; requested content still reaches the provider. |

## 4. Verify: technical evidence and next acceptance

[Replacement tests](tests/unit/replacement.test.ts), [projection tests](tests/unit/projection.test.ts), [skimmable tests](tests/unit/skimmable.test.ts), and [grammar tests](tests/unit/grammar.test.ts) exercise source mapping, stale content and structured edits. [Document integration tests](tests/integration/documents.test.ts) and [browser journeys](e2e/smoke.spec.ts) describe broader product checks. See [acceptance tests](ACCEPTANCE_TESTS.md) for intended behavior; this case study adds no new pass count.

Next: a permission-approved set of actual editing tasks, with writer-approved meaning/quality judgments. Include repeated text, changed documents, formatting boundaries, stale suggestions, imports and exports. Agree on acceptable data-loss behavior, source targeting, export fidelity, review burden and meaning preservation before a trial.

## 5. Measure business value

Baseline drafting, revision, and export time. Compare a matched set of tasks, including review/correction time, candidate rejection, provider costs, and recovery incidents. Track perceived quality and meaning preservation with accountable writers. Faster drafting is recovered capacity; it is not automatically reduced payroll or increased revenue. No measured ROI is supplied here.

## Architecture choice, adoption, and next work

Local SQLite and a loopback server keep ownership/setup explicit while server-side AI boundaries keep keys out of the browser. Deterministic analysis remains usable without model calls. A simpler rules-only editor should remain a comparison option when discovery does not justify AI.

The intended employee change is fewer editing handoffs with review retained. Actual adoption remains unproven. Next: real-task evaluation, observed writer usage, and a measured outcome before broader hosted-workspace claims.
