# Iteration 2 — execution-backend-adapter-contract

**Date:** 2026-05-10
**Spec commit at start:** 02e00c93166bdec84a884bad0a35dfd6d32a6b3e
**Codex output:** tasks/review-logs/_codex_spec_review_execution-backend-adapter-contract_iter2_2026-05-10T02-23-06Z.txt

## Findings classification

### Codex findings
| # | Section | Severity | Class | Disposition |
|---|---|---|---|---|
| 1 | §4.1, §9.1, §13.5 | critical | mechanical | accept — finalise() write-ownership still split between adapter and caller |
| 2 | §4.1, §13.1.1, §14 Chunk 5 | critical | mechanical | accept — delegated dispatch parent-update split between adapter and caller |
| 3 | §8.1, §8.2, §14 | important | mechanical | accept — registry "every mode resolves" rule conflicts with chunked rollout |
| 4 | §4.1, §9.3, §13.1 | important | mechanical | accept — BackendTerminalState under-specified; eventEmittedAt referenced but not in shape |

### Rubric findings (my own pass)

None new this iteration — the four Codex findings cover the gap surface introduced by iteration 1's edits. Each is a consistency tighten rather than a new direction.

## Mechanical changes applied

**§4.1 ExecutionBackend interface:**
- Added a fully-specified `BackendTerminalState` interface (agentRunId, backendTaskId, status, failureReason, completedAt, eventEmittedAt, resultSummary, raw) — addresses F4.
- Updated `dispatch()` doc-comment to make adapter-owned writes explicit for both lifecycles (in-process: returns LoopResult, post-completion block writes parent; delegated: adapter enqueues backend task AND writes parent UPDATE inside `dispatch()`) — addresses F2.
- Updated `finalise()` doc-comment to make adapter-owned writes explicit (adapter writes adapter-owned columns AND parent agent_runs terminal UPDATE through input.tx in 4 numbered steps; idempotency rule for race-loser path named) — addresses F1.
- Updated `BackendFinalisationResult` doc-comments to reflect new ownership: `finalised` true only after both writes issued; `parentTerminalStatus` returned for observability only.

**§8.1 Registry:**
- Clarified `BackendNotRegistered` is per-call lazy validation, not boot-time enumeration. Explained why Chunks 3 + 4 boot fine despite registering subsets (dispatch-site still uses if/else until Chunk 5 cutover) — addresses F3.

**§9.1 finaliseAgentRunFromBackend:**
- Re-wrote post-block prose: orchestration only — load + lock + hand off; adapter owns ALL writes through `input.tx`. Removed the wrong "caller writes the parent agent_runs terminal update" comment.
- Added "Why adapter owns the parent UPDATE" subsection: existing `finaliseAgentRunFromIeeRun` already owns the full parent UPDATE (PR #279); lifting that body unchanged into the IEE adapter's `finalise()` preserves the no-behaviour-change claim. Alternative (return projection, caller writes) rejected because it doubles the surface for no execution gain.

**§9.3 loadTerminalState helper:**
- Removed the inline mini-shape definition; replaced with pointer to §4.1's full interface so there is one source of truth.

**§13.1.1 Delegated dispatch sequence — rewritten end to end:**
- Step 1 unchanged (adapter enqueues with idempotency key).
- Step 2: changed from "caller updates parent" to "ADAPTER updates parent" — same UPDATE shape, just lives inside `dispatch()`.
- Step 3 (orphan cleanup): adapter writes `iee_runs.status = 'cancelled', failureReason = 'parent_orphaned'` AND either throws `ParentRunNotDispatchable` or returns an in_process-shaped result indicating already-terminal. Both options permitted; IEE adapter throws (existing behaviour). Dispatch-site caller treats the error as recoverable diagnostic.
- Step 4 unchanged (reconciliation orphan-skip rule).

**§13.5 No-silent-partial-success:**
- Updated to reflect new ownership: adapter writes both adapter-owned columns AND parent terminal UPDATE in same tx; either both commit or both roll back. There is no path where one row writes and the other does not.

## Rejected / reclassified findings

None.

## Iteration 2 Summary

- Mechanical findings accepted:  4 (Codex: 4, Rubric: 0)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0

The spec now has a single, consistent ownership model: the adapter owns ALL writes for its lifecycle. The dispatch-site caller is purely an orchestrator that loads + locks + hands off to the adapter inside a transaction. `BackendTerminalState` is fully specified with `eventEmittedAt` named. The registry's "every mode resolves" rule is now explicitly lazy/per-call, removing the chunk-3-can't-boot trap.
