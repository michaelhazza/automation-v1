# Dual Review Log — personal-assistant-v2-operator

**Files reviewed:** branch-level diff vs `main` on `claude/personal-assistant-post-merge-audit` (Major task — cross-owner delegation, operator session lifecycle, sandbox filesystem watcher; ~250 files / ~25k LoC). Focused review on caller-named high-risk areas: cross-owner privacy projection, approver gate, path traversal prevention, delegation state machine, IPC retry, multi-tenant safety on new tables.
**Iterations run:** 3/3
**Timestamp:** 2026-05-13T22:04:44Z
**Commit at finish:** 9c7a6518

---

## Iteration 1

Codex command: `codex review --base main` (no custom prompt — this Codex CLI version rejects `[PROMPT]` alongside `--base`; default reviewer instructions used).

Codex returned 4 findings: 2 P1, 2 P2.

**[REJECT] P1 — `server/services/capabilityMapService.ts:119-120` — recompute paths strip `owner_user_id`**
  Reason: Real defect, but the file is outside the caller's stated review scope (caller listed crossOwner*, reviewService, runTracePure, agentRuns/taskEventStream, watcher, bridge, agentExecutionEventService). The related invariant is already tracked in `tasks/todo.md` as `PA-V2-CONFORMANCE-7` (which covers the agents.ownerUserId write-side — currently dormant because there is no production write surface). The reference-recompute path that strips owner does have a theoretical exposure, but the fix requires consolidating two recompute functions — a refactor that exceeds dual-reviewer's surgical mandate and was not flagged by either `pr-reviewer` or `spec-conformance` (full pass) ahead of dual-review. Routed to backlog by surfacing in this log; the operator can decide whether to fold into PA-V2-CONFORMANCE-7 or open a new deferred item.

**[REJECT] P1 — `server/services/actionService.ts:160` — `approverUserId` never wired from agent-execution middleware**
  Reason: Real defect, but **already extensively tracked** in `tasks/todo.md` lines 131–142 under "Cross-owner approver wiring (adversarial finding, post-V2-build)". The adversarial-reviewer found this on 2026-05-14 with a complete remediation plan:
   1. Add `executorOwnerUserId` to `MiddlewareContext` in `server/services/middleware/types.ts`
   2. Populate it in the agent execution loop on cross-owner sub-runs
   3. Call `deriveApproverUserId()` in `proposeActionMiddleware.ts`
  Workaround documented: `reviewService.approveItem` `isWrongApprover` gate partially mitigates. The fix is cross-file plumbing (middleware types + execution loop + middleware impl) — too broad for dual-reviewer's surgical mandate. Already deferred with full plan; no new action required.

**[ACCEPT] P2 — `server/services/agentExecutionEventService.ts:744-745` — cursor advancement on filtered pages (streamEvents)**
  Reason: Real defect with infinite-retry potential. For non-owner viewers, `runTraceProjectionForViewer` can redact every event in a page, leaving `events` empty while `hasMore` is true. The cursor falls back to `fromSeq - 1`, the client retries the same window, and never advances. Surgical 4-line fix: compute `highestSequenceNumber` and `highestTaskSequence` from the raw `page` rows, not the projected `events` array. Applied.

**[ACCEPT] P2 — `server/jobs/workflowGateStallNotifyJob.ts:236` — `ask_initiator` re-emits awaiting event on every sweep**
  Reason: Real defect. For `ask_initiator` policy, `terminalAt` stays NULL by design (substep is non-terminal). The same row matches the sweep WHERE clause again on every cron tick; the SET statement writes the same `awaiting_cross_owner_approval` status, so the row stays open. `proposeAction` is deduped via `idempotencyKey` (DB unique), but `appendEvent` is not — so each sweep appends a fresh `cross_owner_substep.awaiting_initiator_decision` event to the run trace. Fix: pre-emit query for an existing action with `idempotencyKey = 'cross_owner_ask_initiator:${row.id}'`; if found, skip the whole branch (suppression-is-success per DEVELOPMENT_GUIDELINES §8.33). First sweep wins; subsequent sweeps no-op. Applied.

Lint + typecheck after iteration 1 fixes: 0 new errors. Only pre-existing `@react-pdf/renderer` typecheck errors (unrelated module).

## Iteration 2

Codex command: `codex review --uncommitted` (working tree now contains iter 1 fixes).

Codex returned 1 new P2 finding:

**[ACCEPT] P2 — `server/services/agentExecutionEventService.ts:883-892` — same cursor bug in sibling `streamEventsByTask`**
  Reason: Codex correctly spotted that I had only fixed the run-scoped `streamEvents`; the task-scoped `streamEventsByTask` has the same shape (computes `highestTaskSequence` / `highestSequenceNumber` from `projectedEvents`, falls to `null`/`0` when projection redacts all rows). Same surgical fix applied — switch to raw-`page`-driven high-water marks, mirroring iter 1.

Lint + typecheck after iteration 2 fix: 0 new errors.

## Iteration 3

Codex command: `codex review --uncommitted` (working tree contains iter 1 + iter 2 fixes).

Codex returned 2 new P2 findings:

**[ACCEPT] P2 — `server/routes/taskEventStream.ts:111-115` — route drops raw cursor**
  Reason: Service-layer fix from iter 2 made `streamEventsByTask` return correct high-water marks, but the replay route at `/api/tasks/:taskId/event-stream/replay` only serializes `{ events, hasGap, oldestRetainedSeq }` — `highestSequenceNumber` and `highestTaskSequence` never reach the client. Even with the service-layer fix, the task-replay client cannot advance past a fully redacted page. Surgical 3-line fix: add `hasMore`, `highestSequenceNumber`, `highestTaskSequence` to the JSON response, consistent with the run-scoped `/api/agent-runs/:runId/events` route (which serializes the full `AgentExecutionEventPage` object). Applied.

**[ACCEPT] P2 — `server/services/operatorSandboxFileEventBridge.ts:33-41` — `isR2Retryable` drops 408/429**
  Reason: Real defect, introduced by an in-flight quality fix in this branch's uncommitted diff (was `isRetryable: () => true`, narrowed to a predicate that only matches `ECONNRESET`/`ETIMEDOUT`/`ENOTFOUND` + HTTP >= 500). R2 commonly returns HTTP 429 (Too Many Requests) under throttling and 408 (Request Timeout) on slow uploads — both are transient and should be retried. The narrower predicate would now fail-fast on rate-limited uploads. Surgical fix: add `408` and `429` to the retryable status check. Applied.

Lint + typecheck after iteration 3 fixes: 0 new errors.

---

## Changes Made

- `server/services/agentExecutionEventService.ts` — `streamEvents` and `streamEventsByTask` now derive `highestSequenceNumber` / `highestTaskSequence` from the raw page rows, not the projected events. Protects non-owner consumers from infinite-retry on fully redacted pages.
- `server/jobs/workflowGateStallNotifyJob.ts` — `ask_initiator` branch checks for an existing `cross_owner_ask_initiator:${substep_id}` action before appending the awaiting event. Suppression-is-success on re-sweep; first sweep wins.
- `server/routes/taskEventStream.ts` — replay response now includes `hasMore`, `highestSequenceNumber`, `highestTaskSequence` so clients can advance past private windows.
- `server/services/operatorSandboxFileEventBridge.ts` — `isR2Retryable` now retries HTTP 408 + 429 in addition to 5xx + net-level errors. Recovers transient throttling.

## Rejected Recommendations

- **iter 1 P1 — `capabilityMapService.ts` strips `owner_user_id` on reference recompute.** Real but out of scope for dual-reviewer; routed to backlog (related to `PA-V2-CONFORMANCE-7` deferred item). Operator decision: either consolidate `recomputeCapabilityMap` + `recomputeCapabilityMapWithOwner` into a single function that always joins to `agents.ownerUserId`, or accept the gate-only enforcement plus the architecture-rules-test from PA-V2-CONFORMANCE-7.
- **iter 1 P1 — `actionService.proposeAction` `approverUserId` never wired from middleware.** Real but already fully tracked in `tasks/todo.md:131-142` with a complete cross-file remediation plan. Fix scope (MiddlewareContext + execution loop + middleware impl) exceeds dual-reviewer's surgical mandate. Workaround (reviewService gate via `isWrongApprover`) is in place.

---

**Verdict:** APPROVED (3 iterations, 5 fixes applied across 4 files; 2 P1 findings rejected with rationale routed to backlog)
