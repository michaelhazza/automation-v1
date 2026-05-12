# chatgpt-pr-review — operator-backend — 2026-05-12T21:39:23Z

## Session Info

- **Branch:** `claude/sandbox-execution-provider-DLfjn`
- **PR:** [#288](https://github.com/michaelhazza/automation-v1/pull/288)
- **Build slug:** `operator-backend`
- **Mode:** manual
- **Spec:** [`docs/superpowers/specs/2026-05-12-operator-backend-spec.md`](../../docs/superpowers/specs/2026-05-12-operator-backend-spec.md)
- **Phase 2 handoff:** [`tasks/builds/operator-backend/handoff.md`](../builds/operator-backend/handoff.md)
- **spec_deviations from handoff:** none recorded
- **Started:** 2026-05-12T21:39:23Z

## Round 1 — Setup

- Code-only diff: `.chatgpt-diffs/pr288-round1-code-diff.diff` — 880K, 158 files
- Full diff: `.chatgpt-diffs/pr288-round1-diff.diff` — 4.6M, 185 files (27 files of specs/plans/logs excluded from code-only)
- Awaiting operator paste of ChatGPT response.

## Round 1 — Findings

| ID | Severity | Triage | Recommendation | User Decision |
|----|----------|--------|----------------|---------------|
| F1 | blocker | technical | implement | auto (implement) |
| F2 | blocker | technical | implement | auto (implement) |
| F3 | high | technical | reject (verified doc-residue only — live code at `operatorManagedBackend.ts:467` correctly excludes `'delegated'`) | auto (reject) |
| F4 | medium | technical | implement | auto (implement) |
| F5 | medium | technical | implement | auto (implement) |

### F1 — refresh-credential route emits with blank connectionId + fire-and-forget audit (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:376` — `emitUsabilityRestored({ connectionId: '', agentRunId })`; line 378 — `void auditService.log(...)`.

**Root cause:** the route was stubbed to emit the lifecycle event with no connectionId source and to fire the audit log without awaiting durability. Since `task.operator.credential_refreshed` audit events are a stickiness-clearing signal (spec §3.7 item 5), a non-durable audit can leave a chain-link believing fallback should still be sticky.

**Fix:** in the route, resolve the active operator_session integration_connection for the run's subaccount; pass its id as `connectionId`; await `auditService.log`; write the audit row BEFORE emitting the lifecycle event so the durable signal is in place when downstream consumers see the event.

**Files changed:** `server/routes/operatorTasks.ts`.

### F2 — adoptOrStart contradicts the unique sandbox_start_key model (BLOCKER)

**Evidence:** `server/services/sandboxExecutionServicePure.ts:258-279` returned `fresh_start` for terminal rows. Migration 0332 carries a unique partial index `(sandbox_start_key) WHERE sandbox_start_key IS NOT NULL`, so a fresh INSERT after a terminal row with the same key would violate the index.

**Root cause:** the pure decision was written before the unique index landed. The index binds a start_key to one row for the row's full lifecycle, but `decideAdoptOrStart` only treated live statuses as adoptable — terminal rows fell through to `fresh_start`, which tries to INSERT.

**Fix (ChatGPT option 1, preferred):** `decideAdoptOrStart` returns `adopt` whenever any row exists with a matching id (terminal or live); `conflict` whenever any row exists with a mismatched id; `fresh_start` only when no row exists. `runTask`'s Case 3 already handles terminal idempotent re-read.

**Files changed:** `server/services/sandboxExecutionServicePure.ts`, `server/services/sandboxExecutionService.ts` (comment), `server/services/__tests__/sandboxExecutionServiceAdoptOrStart.test.ts` (8 terminal tests now assert `adopt`; 1 mismatched-id terminal test now asserts `conflict`).

### F3 — dispatcher success predicate (HIGH) — REJECTED (verified clean)

**Investigation:**
- `grep -rn "status IN ('pending','delegated'" --include="*.ts" server/` → no matches.
- `server/services/executionBackends/operatorManagedBackend.ts:467` — the live dispatcher predicate is `status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. `'delegated'` is correctly excluded.

ChatGPT's concern was based on a stale snippet in uploaded review materials. The live code is correct. No fix required.

### F4 — progress endpoint doc drift (MEDIUM)

**Evidence:** `architecture.md:3983` listed the progress route as `server/routes/operatorTaskProgress.ts — GET /api/operator-tasks/:agentRunId/progress`. The actual implementation is in `server/routes/operatorSessions.ts:31` at `GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress`, matching the route the spec (§7.3 R2-F1 lock) and the client helper (`client/src/api/operatorBackendApi.ts:39`) both use.

**Fix:** updated architecture.md row to the correct file path and route.

**Files changed:** `architecture.md`.

### F5 — retry route reset of operator_chain_failure_count lacks predicates (MEDIUM)

**Evidence:** `server/routes/operatorTasks.ts:107-110` — `db.update(agentRuns).set({ operatorChainFailureCount: 0 }).where(eq(agentRuns.id, agentRunId))`. No org filter, no status predicate. Raceable: another path could transition the task between the read at line 87 and the reset at line 107.

**Fix:** added `eq(agentRuns.organisationId, orgId)` and `eq(agentRuns.status, 'paused_chain_failure')` to the WHERE clause; capture `.returning({ id })`; treat 0-rows-affected as a `TASK_ALREADY_TERMINAL` conflict.

**Files changed:** `server/routes/operatorTasks.ts`.

### G3 (lint + typecheck) post-fix

- `npm run lint` → 0 errors, 904 warnings (all pre-existing).
- `npm run typecheck` → clean.
- `npx vitest run server/services/__tests__/sandboxExecutionServiceAdoptOrStart.test.ts` → 16/16 passing.

### Round 1 commit + diff regeneration

Commit `3e482410`. Round 2 diff regenerated at `.chatgpt-diffs/pr288-round2-code-diff.diff`.

## Round 2 — Findings

ChatGPT verdict line: "Round 2 is close, but I'd still hold merge."

| ID | Severity | Triage | Recommendation | User Decision |
|----|----------|--------|----------------|---------------|
| F1 | blocker | technical | implement | auto (implement) |
| F2 | blocker | technical | implement | auto (implement) |
| F3 | medium | technical | reject (duplicate of Round 1 F3) | auto (reject — duplicate of R1 F3) |
| F4 | medium | technical | implement | auto (implement) |

Prior-finding status from ChatGPT: F1/F2/F4 Round 1 confirmed fixed; F5 Round 1 fixed for retry-chain-failure but extend-budget was unsafe — that surfaced as Round 2 F1.

### F1 — extend-budget still lacks optimistic predicate + row-count check (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:190-198` (Round 1) — `tx.update(agentRuns).set({...}).where(eq(agentRuns.id, agentRunId))`. No `organisationId` filter, no `status='paused_budget_exceeded'` predicate, no row-count check.

**Root cause:** the Round 1 F5 fix landed on retry-chain-failure but extend-budget was missed. Same shape, same race window.

**Fix:** mirror the retry-chain-failure pattern — UPDATE inside the `withOrgGUC` transaction filtered by `id + organisationId + status='paused_budget_exceeded'`; capture `.returning({ id })`; treat 0-rows-affected as `TASK_ALREADY_TERMINAL`; only enqueue the dispatch job after the UPDATE succeeds.

**Files changed:** `server/routes/operatorTasks.ts`.

### F2 — fresh-profile-restart reads earliest chain link, not latest (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:300` — `.orderBy(operatorRuns.chainSeq)` (ascending) — returns the earliest chain link in the current attempt. Combined with `latestChainLinkFailureClass: null`, the predicate's failure_reason source was always the wrong chain link's reason — almost always `null` or a transient failure, never the `'OPERATOR_PROFILE_UNRECOVERABLE'` set on the most recent link.

**Root cause:** copy-paste from an earlier query that didn't care about ordering, missed during Phase 2 review.

**Fix:** changed orderBy to `desc(operatorRuns.chainSeq)`. `isNull(supersededByAttempt)` already pins the current attempt; within that, highest chain_seq is the latest link. Added `desc` import.

**V1 failure_class clarification:** the spec's `failure_class='profile_corruption'` branch references a column that does not exist on `operator_runs` in V1. The predicate is wired through `decideFreshProfileRestartAllowed` (which checks both `failureClass` and `failureReason`) for forward compatibility but the route always passes `null` for `failureClass` today. Comment updated to make this explicit so future readers don't re-investigate. Spec §3.15 item 7 already covers this in the deferred-items list.

**Files changed:** `server/routes/operatorTasks.ts`.

### F3 — stale spec/doc `delegated` predicate (MEDIUM) — REJECTED (duplicate of Round 1 F3)

**Investigation:**
- `grep -rn "'pending','delegated'\|'delegated','paused"` — all three matches are the CANCEL UPDATE predicate, which CORRECTLY includes `'delegated'` because cancelling a delegated task is a valid transition (spec §3.10).
- The DISPATCH success predicate at `operatorManagedBackend.ts:467` and spec line 1224 both EXCLUDE `'delegated'`, as required.

The Round 1 F3 finding and the Round 2 F3 finding describe the same concern. Round 1 rejected after verifying live code + spec are correct; Round 2 is a substantive duplicate. Per the chatgpt-pr-review duplicate-detection rule (KNOWLEDGE.md 2026-05-01), auto-apply the prior round's decision (reject) without re-triage.

No code change.

### F4 — fire-and-forget audit writes for state-changing routes (MEDIUM)

**Evidence:** `void auditService.log(...)` in:
- `retry-chain-failure` route (line ~112 Round 1) — state-changing, queues dispatch
- `extend-budget` route — state-changing, queues dispatch
- `fresh-profile-restart` route — state-changing, mutates operator_runs
- `extend-debug-retention` route — state-changing, mutates operator_task_profiles

**Root cause:** the audit log was treated as observability rather than as part of the state-change contract. For state-changing operator actions the audit row IS the operator-visible explanation; if the route returns 202 before the audit is durable, an observer can see the dispatch fire / state change with no recorded cause.

**Fix:** changed all four audit writes from `void auditService.log(...)` to `await auditService.log(...)`. For retry-chain-failure and extend-budget the await sits between the UPDATE and the `boss.send` call so the audit lands before the dispatch job is enqueued. (refresh-credential was already awaited as part of Round 1 F1.)

**Files changed:** `server/routes/operatorTasks.ts`.

### G3 (lint + typecheck) post-fix

- `npm run lint` → 0 errors, 904 warnings (all pre-existing).
- `npm run typecheck` → clean.

### Round 2 commit + diff regeneration

Pending — see next session entry.
