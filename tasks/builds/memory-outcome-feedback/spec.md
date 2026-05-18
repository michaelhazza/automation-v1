---
status: draft
spec_date: 2026-05-18
last_updated: 2026-05-18
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: claude/build-memory-outcome-feedback-3th7d
build_slug: memory-outcome-feedback
brief: tasks/builds/memory-outcome-feedback/brief.md
---

# Spec — Memory Outcome Feedback

Connects scorecard verdicts and approval decisions to the memory blocks that informed each run. Adds a fourth signal (`outcomeFeedback`) into `PromotionSignals` so memory confidence reflects outcome quality, not just access frequency.

This spec extends three already-shipped systems (`memory-tiered-consolidation`, `closed-loop-skill-improvement`, `memory-improvements`). It does not introduce new product surface; it closes the loop between systems that ship signal in isolation today.

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Memory & Knowledge, Audit & Governance |
| Capability owner | platform (placeholder — re-resolves at first review) |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, server/jobs, server/services (memory + approval), RLS migrations |
| Review cadence | quarterly, plus on-incident if outcome feedback ever crosses tenant boundary |

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | L | No external vendor sells "scorecard-anchored memory confidence loop"; integrators sell raw vector DBs without outcome-feedback semantics. Equivalent acquisition path doesn't exist. |
| Build | M | One new job, one new service, one new table + RLS, ~10 file edits, audit-script extension. Bounded scope; all hook sites grounded in code. Full inventory in §16. |
| Carry | S | Job is bounded (no LLM), zero new write hot paths, per-week cap prevents adversarial decay storms. Audit script picks up the new checks under the existing 4-pass gate. |
| decommission | S | Lower `outcomeFeedback` weight to 0 + bump config version. Drop new table when consolidation tier itself decommissions. No flag rollback needed. |

---

## Table of Contents

1. Goals
2. Non-Goals
3. Framing & Brief Departures
4. Architecture
5. Data Model
6. Contracts
7. Permissions / RLS
8. Execution Model
9. Phase Sequencing & Chunk Plan
10. Execution-Safety Contracts
11. Observability
12. Rollout & Rollback
13. Determinism & Replayability
14. Audit-Script Extension
15. Testing Posture
16. Files in Scope (Inventory Lock)
17. Success Criteria
18. Deferred Items
19. Provenance

---

## 1. Goals

1. Memory blocks injected into a scorecard-`fail` run receive a negative confidence delta on the next consolidation cycle, all other signals held constant.
2. Memory blocks injected into a scorecard-`pass` run with approved actions and no rollback receive a positive delta beyond the existing access bump.
3. `inconclusive` verdicts, cancelled runs, and runs with no injected memory produce zero signal — silent no-op, no events, no rows.
4. Per-block per-week delta magnitude is bounded — adversarial input cannot move a block's score faster than the configured cap.
5. Tenant isolation enforced at SQL: no outcome feedback ever crosses `(organisation_id, subaccount_id)`. RLS fuzz tests pass.
6. Reuses `MEMORY_CONSOLIDATION_TIER_ENABLED`. Zero new flags. Flag-off behaviour: dispatcher runs but applies zero delta, mutates no rows.
7. Replayability: same `MemoryConsolidationConfig` version + same outcome event stream produces same final scores.

## 2. Non-Goals

- No auto-deletion of memory based on negative feedback. Decay only; deletion stays operator-driven.
- No operator-facing "recently penalised" UI in v1. Decay is silent; memory-inspector affordances are a follow-up.
- No per-block causal attribution within a run — v1 attributes coarsely to the full injected set.
- No outcome feedback for cancelled / blocked runs (those never produce a verdict).
- No cross-tenant outcome learning — explicitly out (matches closed-loop's same non-goal).
- No LLM in the job path. Verdict classification is a direct read off the scorecard row.
- No backfilling historical outcomes onto historical memory blocks. Forward-only from flag-on.
- No new feature flag. Reuses `MEMORY_CONSOLIDATION_TIER_ENABLED`.

## 3. Framing & Brief Departures

The brief was authored against a presumed code shape. The grounding pass against commit `6e48183` found six places where the spec must diverge from the brief. Each is listed below with its locked decision.

### 3.1 Verdict enum values

**Brief:** `PASS / FAIL / MIXED`.
**Code:** `pass | fail | inconclusive` (`server/db/schema/scorecardJudgements.ts:28`; `scorecardJudgeRunnerPure.computeVerdict`).
**Locked:** spec uses lowercase code values. "Mixed → no signal" maps to `inconclusive`.

### 3.2 Provenance column location

**Brief:** `agent_run_prompts.injected_entry_ids`.
**Code:** column lives on `agent_runs.injected_entry_ids` (jsonb, nullable; `server/db/schema/agentRuns.ts:129`). `agent_run_prompts` carries `layerAttributions` only.
**Locked:** spec reads from `agent_runs.injected_entry_ids`. `null` is treated as "unmeasured" → zero signal.

### 3.3 Signal-fusion plug-in site

**Brief:** "modify `decayPure.ts` (or the post-fusion boost layer)".
**Code:** `decayPure.ts` (21 lines) computes Ebbinghaus only. The three-signal fusion is in `memoryBlockSynthesisService.ts:310` (`evaluatePromotion(currentTier, signals, config)`).
**Locked:** `outcomeFeedback` is added as a fourth `PromotionSignals` field; `evaluatePromotion` extends its `totalScore` sum. `decayPure.ts` is untouched.

### 3.4 Approval-flow correlation

**Brief:** "dispatch on approval decision" — assumes a `run_id` correlation.
**Code:** `decideTaskApproval` correlates by `taskId` + `artefactId`. There is no `agent_run_id` field on the decision write.
**Locked:** dispatcher emits `{ taskId, artefactId, decision }`. The job handler resolves affected `agent_runs` rows via a `SELECT ... FROM agent_runs WHERE task_id = $1 AND created_at <= $approval_decided_at` lookup. If zero runs resolve, log structured `outcome_feedback.no_run_resolved` and exit cleanly (no signal). See §6.4 for the SQL contract.

### 3.5 Approval transaction surface

**Brief:** "subordinate dispatch inside the transaction (mirrors the `failure:post-mortem` dispatch pattern)".
**Code:** `decideTaskApproval` does NOT open a `db.transaction(tx)` today. It writes via `writeConversationMessage` against `getOrgScopedDb('taskApprovalService')`.
**Locked:** Chunk 7 of this build wraps the decision-write portion (the `writeConversationMessage` call) in an explicit `db.transaction(async (tx) => …)` so `sendWithTx(tx, 'memory:outcome-feedback', …)` rides the same tx. `proposeAction` and other side-effecting work stay OUTSIDE the tx (they may issue LLM calls). This is the minimum refactor that preserves at-least-once dispatch semantics.

### 3.6 Signed-delta storage

**Brief:** "modify `reinforcementBatch.ts` — accept signed deltas in addition to access bumps".
**Code:** `recordAccess` accumulates positive integer bumps into `Map<string, Map<string, number>>`, flushed as `access_count = access_count + N`. `access_count` is monotonic; it cannot hold a signed delta.
**Locked:** introduce a new RLS-protected table `memory_outcome_feedback_events` that stores every applied delta as an immutable row. `reinforcementBatch` gets a separate buffer for outcome-feedback events; same flusher infrastructure, distinct write target. The events table is the source of truth for `evaluatePromotion`'s outcome-feedback signal value AND for the per-block per-week cap. See §5.1 and §6.3.

### 3.7 Departure from "tier-flag-only" rollout

The brief says "reuse `MEMORY_CONSOLIDATION_TIER_ENABLED` — no new flag". Locked. The dispatcher reads `getMemoryConsolidationTierEnabled()` at dispatch time. When false: dispatcher early-returns; no job is enqueued; no rows are inserted. Behaviour is identical to pre-build.

## 4. Architecture

### 4.1 Outcome classification

The handler classifies a `(scorecardVerdict, approvalState, rollbackState)` tuple into one of three outcome signals:

- **positive** — verdict `pass` AND every approval for the task `approve` AND no rollback event for the run.
- **negative** — verdict `fail` AND at least one approval `reject` for the task, OR verdict `fail` AND rollback fired for the run.
- **none** — anything else (`inconclusive` verdict, mixed approvals against a `pass` verdict, no verdict yet, no approvals decided yet, run has no `injected_entry_ids`).

Classification is a pure function — same input → same output. Implemented in `memoryOutcomeFeedbackServicePure.ts`.

### 4.2 Delta computation

Given a `positive` or `negative` classification, the per-entry delta is:

```
delta = sign * baseDelta
```

- `sign` = +1 for positive, −1 for negative.
- `baseDelta` = `config.outcomeFeedbackBaseDelta` ∈ [0.05, 0.5]. Default v2 config value: 0.1.
- Applied uniformly to every entry in `agent_runs.injected_entry_ids` for the resolved run.

The delta is scaled by `signalWeights.outcomeFeedback` at promotion time inside `evaluatePromotion`, not at write time. Storing the raw delta keeps the event log replay-friendly across config version bumps.

### 4.3 Per-block per-week cap

For each candidate write, the handler queries:

```sql
SELECT COALESCE(SUM(ABS(delta)), 0) AS used_magnitude
FROM memory_outcome_feedback_events
WHERE entry_id = $1
  AND organisation_id = $2
  AND subaccount_id IS NOT DISTINCT FROM $3
  AND applied_at >= now() - interval '7 days';
```

If `used_magnitude + ABS(newDelta) > config.outcomeFeedbackWeeklyCap` (default 1.0), the write is **dropped** (not clamped) and the handler emits a structured `outcome_feedback.weekly_cap_saturated` log with `{ entry_id, used_magnitude, attempted_delta, config_version }`. Dropping (vs clamping) keeps the math deterministic — partial credit complicates replay.

### 4.4 Dispatch surfaces

Three dispatch surfaces, all inside the existing transaction that writes the originating event:

| Surface | File | Trigger | Payload |
|---|---|---|---|
| Verdict-write | `server/jobs/scorecardJudgeJob.ts` | Inside the verdict-insert `tx`, after the existing `failure:post-mortem` dispatch | `{ source: 'scorecard', runId, verdict, organisationId, subaccountId, scorecardJudgementId }` |
| Approval-decision | `server/services/taskApprovalService.ts` | Inside the new `db.transaction(tx)` wrapping the decision write | `{ source: 'approval', taskId, artefactId, decision, organisationId, subaccountId }` |
| Rollback-fire | `server/services/workspaceSnapshotService.ts` (stub) | Stubbed in v1 — wired when `task-preview-mode` ships | `{ source: 'rollback', runId, organisationId, subaccountId }` |

All three enqueue to the same job queue `memory:outcome-feedback`. The handler dispatches on `payload.source` to resolve the affected run(s).

### 4.5 Job handler

`server/jobs/memoryOutcomeFeedbackJob.ts` — single async handler.

Flow:
1. Acquire `withOrgTx({ organisationId, subaccountId })` context.
2. Resolve affected runs:
   - `source: 'scorecard'` → `runId` from payload.
   - `source: 'approval'` → SQL lookup (§3.4) returns 0..N runs.
   - `source: 'rollback'` → `runId` from payload.
3. For each resolved run, fetch `agent_runs.injected_entry_ids`. Null or empty → continue.
4. For each `(run, entry)`:
   - Compute classification by joining scorecard + approval + rollback state for the run.
   - If `none` → continue.
   - Idempotency check: `SELECT 1 FROM memory_outcome_feedback_events WHERE run_id = $r AND entry_id = $e AND source = $s LIMIT 1`. If row exists → continue (already applied for this source).
   - Per-week cap check (§4.3). If saturated → log and continue.
   - Enqueue write through `reinforcementBatch.recordOutcomeFeedback(entryId, orgId, subaccountId, runId, verdict, delta, source)`.
5. Emit terminal `memory.outcome_feedback.applied` structured log with counts.

The handler is bounded — no LLM calls, no external HTTP. Worst case: O(injected_entry_ids.length) DB writes per run, batched through the existing flusher.

### 4.6 Reinforcement-batch extension

`server/services/workspaceMemoryService/reinforcementBatch.ts` gains a parallel buffer:

```ts
type OutcomeFeedbackEvent = {
  entryId: string;
  organisationId: string;
  subaccountId: string | null;
  runId: string;
  verdict: 'pass' | 'fail';
  delta: number;
  source: 'scorecard' | 'approval' | 'rollback';
  configVersion: number;
};

function recordOutcomeFeedback(event: OutcomeFeedbackEvent): void;
```

Buffered alongside access bumps. Flushed by the existing flusher (60s / 500 events). Flush target: `INSERT INTO memory_outcome_feedback_events ...` (no upsert — events are immutable). Same flag-gate as `recordAccess` — flag off ⇒ early-return.

### 4.7 Signal fusion in `evaluatePromotion`

`shared/types/memoryConsolidation.ts` extends `PromotionSignals`:

```ts
type PromotionSignals = {
  reinforcementCount: number;
  crossSessionRecurrence: number;
  recency: number;
  outcomeFeedback: number;  // NEW — net signed sum of applied deltas in window
};
```

`SignalWeights` gains a matching `outcomeFeedback: number` field.

`memoryBlockSynthesisService.ts:310` (`evaluatePromotion`) extends `totalScore`:

```
totalScore = signals.reinforcementCount     * signalWeights.reinforcementCount
           + signals.crossSessionRecurrence * signalWeights.crossSessionRecurrence
           + signals.recency                * signalWeights.recency
           + signals.outcomeFeedback        * signalWeights.outcomeFeedback;
```

`signals.outcomeFeedback` is computed by the same call-site that populates `signals.reinforcementCount` today — a query against `memory_outcome_feedback_events`:

```sql
SELECT COALESCE(SUM(delta), 0) AS outcome_feedback
FROM memory_outcome_feedback_events
WHERE entry_id = $1
  AND organisation_id = $2
  AND subaccount_id IS NOT DISTINCT FROM $3
  AND applied_at >= now() - $4::interval;
```

The window matches the existing reinforcement-count window so the four signals compose against consistent timeframes.

## 5. Data Model

### 5.1 New table: `memory_outcome_feedback_events`

Migration: `migrations/0XXX_memory_outcome_feedback_events.sql` (architect locks the number at chunk-0).

```sql
CREATE TABLE memory_outcome_feedback_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id   uuid REFERENCES subaccounts(id) ON DELETE CASCADE,
  entry_id        uuid NOT NULL REFERENCES workspace_memory_entries(id) ON DELETE CASCADE,
  run_id          uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('scorecard', 'approval', 'rollback')),
  verdict         text NOT NULL CHECK (verdict IN ('pass', 'fail')),
  delta           real NOT NULL CHECK (delta >= -1.0 AND delta <= 1.0),
  config_version  integer NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_outcome_feedback_events_idempotent UNIQUE (run_id, entry_id, source)
);

CREATE INDEX idx_memory_outcome_feedback_lookup
  ON memory_outcome_feedback_events (entry_id, organisation_id, applied_at DESC);

ALTER TABLE memory_outcome_feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_outcome_feedback_events_isolation
  ON memory_outcome_feedback_events
  USING (organisation_id = current_setting('app.organisation_id')::uuid);
```

The unique constraint `(run_id, entry_id, source)` is the idempotency guarantee — same source firing twice for the same run/entry is a `23505` no-op.

### 5.2 Config: `MemoryConsolidationConfig` v2

`server/config/memoryConsolidationConfig.ts` — append new history entry:

```ts
{
  version: 2,
  decayConfig: { /* unchanged from v1 */ },
  signalWeights: {
    reinforcementCount: 0.4,      // rebalanced from 0.5
    crossSessionRecurrence: 0.25, // rebalanced from 0.3
    recency: 0.15,                // rebalanced from 0.2
    outcomeFeedback: 0.2,         // NEW
  },
  outcomeFeedbackBaseDelta: 0.1,
  outcomeFeedbackWeeklyCap: 1.0,
}
```

`ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` bumps to `2`. Weights still sum sensibly (0.4 + 0.25 + 0.15 + 0.2 = 1.0). Rationale captured in §13.

### 5.3 No changes to existing tables

`workspace_memory_entries`, `agent_runs`, `scorecard_judgements`, `conversation_messages` are unchanged. No migration touches them.

## 6. Contracts

### 6.1 Job payload — `memory:outcome-feedback`

**Type:** TypeScript discriminated union; serialised as JSONB into `pgboss.job.data`.

```ts
type MemoryOutcomeFeedbackPayload =
  | { source: 'scorecard';
      runId: string;
      verdict: 'pass' | 'fail' | 'inconclusive';
      organisationId: string;
      subaccountId: string | null;
      scorecardJudgementId: string; }
  | { source: 'approval';
      taskId: string;
      artefactId: string;
      decision: 'approve' | 'reject';
      organisationId: string;
      subaccountId: string | null; }
  | { source: 'rollback';
      runId: string;
      organisationId: string;
      subaccountId: string | null; };
```

**Producer:** dispatchers in §4.4.
**Consumer:** `memoryOutcomeFeedbackJobHandler`.
**Nullability:** `subaccountId` may be null (system-tier runs). `organisationId` is non-null always.
**Example instance:**
```json
{ "source": "scorecard", "runId": "8c1c1d3a-…", "verdict": "fail",
  "organisationId": "org-1", "subaccountId": "sub-9",
  "scorecardJudgementId": "judg-42" }
```

### 6.2 Outcome classification — pure function contract

`classifyOutcome(input): 'positive' | 'negative' | 'none'`

```ts
type ClassifyInput = {
  verdict: 'pass' | 'fail' | 'inconclusive' | null;
  approvalsForTask: Array<{ decision: 'approve' | 'reject' }>;
  rollbackFiredForRun: boolean;
};
```

Rules (exhaustive):
- `verdict === 'pass'` AND every `approvalsForTask[i].decision === 'approve'` AND `!rollbackFiredForRun` → `positive`.
- `verdict === 'fail'` AND at least one `approvalsForTask[i].decision === 'reject'` → `negative`.
- `verdict === 'fail'` AND `rollbackFiredForRun` → `negative` (rollback amplifies fail).
- Anything else → `none`.

Source-of-truth precedence: the **scorecard verdict row** is the canonical pass/fail signal. Approval decisions modify intensity. Rollback is a secondary amplifier. If verdict is null (not yet judged), result is always `none`.

### 6.3 Signed-delta record — events table

Contract pinned in §5.1. Source-of-truth precedence: the events table is canonical; `evaluatePromotion`'s `signals.outcomeFeedback` is a derived aggregate, not a stored value. If the events table and any cached aggregate disagree, the events table wins.

### 6.4 Approval → run resolution SQL contract

```sql
SELECT id
FROM agent_runs
WHERE task_id = $1
  AND organisation_id = $2
  AND (subaccount_id IS NOT DISTINCT FROM $3)
  AND created_at <= $4  -- approval_decided_at
  AND injected_entry_ids IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;  -- safety cap; in practice 0-3 runs per task at decision time
```

Returns 0..50 runs. The `LIMIT 50` is a defensive ceiling — a single approval cannot fan out to more than 50 runs of outcome feedback in one job invocation. Tasks with more runs than that are pathological; log and continue.

### 6.5 Structured log events

New event types:

- `memory.outcome_feedback.applied` — `{ run_id, entry_count, source, organisation_id, subaccount_id, total_delta_magnitude, config_version, status }` — terminal event per job.
- `memory.outcome_feedback.no_run_resolved` — `{ task_id, artefact_id, source, organisation_id, subaccount_id }` — fired when §6.4 returns 0 rows.
- `memory.outcome_feedback.weekly_cap_saturated` — `{ entry_id, used_magnitude, attempted_delta, source, organisation_id, subaccount_id, config_version }` — fired on drop.
- `memory.outcome_feedback.idempotent_skip` — `{ run_id, entry_id, source }` — fired when the unique constraint catches a duplicate.

Existing `memory.retrieved` event payload gains two fields: `lastOutcomeFeedbackAt: timestamptz | null` and `lastOutcomeFeedbackVerdict: 'pass' | 'fail' | null`.

## 7. Permissions / RLS

RLS posture: **RLS enforces the organisation boundary; subaccount filtering is service-layer.**

`memory_outcome_feedback_events` is the only new table. Four requirements:

1. **RLS policy** — created in the same migration that creates the table (§5.1). `USING (organisation_id = current_setting('app.organisation_id')::uuid)`. No subaccount-scoped policy — `subaccount_id IS NOT DISTINCT FROM $sub` filtering applied at the service layer.
2. **`server/config/rlsProtectedTables.ts` entry** — append `memory_outcome_feedback_events` with `policyMigration: '0XXX_memory_outcome_feedback_events.sql'` (architect locks the number).
3. **Route-level guard** — N/A. Table is job-only; no HTTP route reads or writes it in v1.
4. **Principal-scoped context** — every read and write happens inside `withOrgTx({ organisationId, subaccountId })`, established by the job handler at step 1 of its flow (§4.5).

`scorecard_judgements` and `workspace_memory_entries` (`server/config/rlsProtectedTables.ts:868` and `:1118`) are already protected. No new RLS work on the existing surfaces.

No new permission keys. The job is dispatched by services that already hold tenant-scoped auth context.

## 8. Execution Model

**Asynchronous, queued (pg-boss).** The job is decoupled from the originating event (verdict write, approval decision, rollback). Three reasons:

1. Verdict and approval write paths must stay fast — no synchronous fan-out across N memory entries.
2. The job needs to query joint state (verdict + approvals + rollback) — that's a multi-row read that does not belong in the originating transaction.
3. Retry semantics — if the job fails, pg-boss retries with the existing DLQ pattern.

**Cached / partitioned:** N/A. No LLM prompts. No cache decisions.

**Inline / synchronous:** N/A. No caller blocks on outcome-feedback application.

Consistency pass:
- Job idempotency entry: `'memory:outcome-feedback'` is added to `server/config/jobConfig.ts` with `idempotencyStrategy: 'payload-key'` and a singleton key per `(source, runId | artefactId)`.
- Prose describes the operation as "the handler does X" — handler is in `memoryOutcomeFeedbackJob.ts`. Matches the queued model.
- Non-functional goals: none stated (no latency budget, no cache efficiency claim).

## 9. Phase Sequencing & Chunk Plan

The architect locks per-chunk detail in `plan.md`. Spec-level chunk order:

**Chunk 1 — Schema & RLS.** Migration `0XXX_memory_outcome_feedback_events.sql` (creates table, RLS policy, index, unique constraint). Append entry to `rlsProtectedTables.ts`. No code consumers yet — table can sit empty.

**Chunk 2 — Config & types.** Extend `PromotionSignals` and `SignalWeights` in `shared/types/memoryConsolidation.ts`. Append v2 entry to `MEMORY_CONSOLIDATION_CONFIG_HISTORY`. Bump `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` to 2. `evaluatePromotion` gains the fourth term — initial `signals.outcomeFeedback` value computed from the (still-empty) events table.

Dependency: Chunk 1 must merge before Chunk 2's queries can return data; both can ship in the same PR since an empty table returns zero, which is the correct flag-off behaviour.

**Chunk 3 — Pure classification + service.** New files `server/services/memoryOutcomeFeedbackServicePure.ts` (`classifyOutcome`, `computeDelta`, `shouldDropForWeeklyCap`) and `server/services/memoryOutcomeFeedbackService.ts` (the impure shell — DB queries, audit-log emission). Vitest covers pure functions only.

**Chunk 4 — Reinforcement-batch extension.** Add `recordOutcomeFeedback` to `reinforcementBatch.ts`. New buffer; same flusher. Flag-gated identically to `recordAccess`. Vitest covers buffer accumulation and flush semantics.

**Chunk 5 — Job handler + registration.** New file `server/jobs/memoryOutcomeFeedbackJob.ts`. Add `'memory:outcome-feedback'` to `server/config/jobConfig.ts`. Register the worker in `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` (mirror the `failure:post-mortem` registration block).

**Chunk 6 — Dispatch wiring (scorecard).** Add subordinate `sendWithTx(tx, 'memory:outcome-feedback', …)` inside the existing verdict-write tx in `server/jobs/scorecardJudgeJob.ts`, after the `failure:post-mortem` dispatch.

**Chunk 7 — Dispatch wiring (approval).** Refactor `decideTaskApproval` to wrap the `writeConversationMessage` call in `db.transaction(async (tx) => …)`. Inside the tx, after the write, call `sendWithTx(tx, 'memory:outcome-feedback', …)`. `proposeAction` and other side-effecting calls stay outside the tx.

**Chunk 8 — Audit-script extension.** Add three new checks to `scripts/audit/audit-memory-consolidation.ts` (§14). Wire into the existing 4-pass gate.

**Chunk 9 — Rollback dispatch stub.** Add a stubbed dispatch site in `server/services/workspaceSnapshotService.ts` (or whichever service owns rollback — architect verifies at chunk-0) with a `// TODO(task-preview-mode)` marker. The path is wired but inactive until `task-preview-mode` ships. This keeps the rollback signal in the contract without requiring a downstream dependency to merge.

Dependency graph: 1 → 2 → 3 → 4 → 5 → {6, 7} parallel → 8 → 9. No backward references. Chunks 6 and 7 can ship in either order.

## 10. Execution-Safety Contracts

### 10.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `INSERT INTO memory_outcome_feedback_events` | **key-based** | UNIQUE `(run_id, entry_id, source)` (§5.1). Duplicate fire → `23505` caught and logged as `idempotent_skip`. |
| Job enqueue from `scorecardJudgeJob` | **key-based** | pg-boss `singletonKey: memory-outcome-feedback:scorecard:${runId}` |
| Job enqueue from `decideTaskApproval` | **key-based** | pg-boss `singletonKey: memory-outcome-feedback:approval:${artefactId}` |
| Job enqueue from rollback (stub) | **key-based** | pg-boss `singletonKey: memory-outcome-feedback:rollback:${runId}` |
| Job handler resolution + write | **key-based** | Per `(run_id, entry_id, source)` — handler queries the events table before writing. |

### 10.2 Retry classification

- `INSERT` into events table: **guarded** — unique constraint makes retry safe; `23505` is no-op.
- Job enqueue via `sendWithTx`: **guarded** — pg-boss singletonKey blocks duplicates.
- Job execution: **guarded** — handler re-checks idempotency before every write.

No `unsafe` operations in the new code path. The existing verdict-write and approval-write paths retain their current classification — this build does not change those.

### 10.3 Concurrency guard for racing writes

Two scenarios:

**(a) Two `scorecardJudgeJob` retries for the same run.** Guarded by the existing `onConflictDoNothing()` on verdict insert — only the first commits; the second's `sendWithTx` sees `insertedJudgementId === undefined` and skips dispatch (matches the existing `failure:post-mortem` guard).

**(b) Two outcome-feedback jobs for the same run from different sources** (e.g., scorecard fires, then approval fires). Both can land; the handler resolves to different `source` rows in the events table — UNIQUE `(run_id, entry_id, source)` permits this. Compositionally, this is the desired behaviour — the same run can accumulate signal from multiple sources, capped at `weeklyCap`.

**(c) Same job retried by pg-boss after handler partial failure.** Per-entry idempotency check inside the handler (§4.5 step 4) means a retried handler skips already-written entries and resumes from where it stopped.

### 10.4 Terminal event guarantee

Per job invocation, exactly one terminal event:

- `memory.outcome_feedback.applied` with `status: 'success'` — all resolvable entries written or skipped-as-idempotent, no drops.
- `memory.outcome_feedback.applied` with `status: 'partial'` — some entries dropped by weekly cap, but no DB errors.
- `memory.outcome_feedback.applied` with `status: 'failed'` — DB error before completion; pg-boss handles retry.

Post-terminal prohibition: once the terminal event fires for `(source, runId)`, no further structured events with the same correlation key are emitted from that handler invocation.

### 10.5 No-silent-partial-success

`status: 'partial'` fires when:
- Any entry is dropped by the weekly cap (§4.3).
- Any entry is dropped because `agent_runs.injected_entry_ids` is null or empty for one of multiple resolved runs (some succeeded, some had nothing to write).
- The §6.4 lookup returned fewer runs than expected (heuristic — applies only if `expected > 0` based on the dispatcher's signal).

`status: 'success'` requires every resolved entry written without drops.

### 10.6 Unique-constraint → HTTP mapping

`memory_outcome_feedback_events` is job-only — no HTTP route. The unique constraint never produces an HTTP status. Catch `23505` inside the handler and log as `idempotent_skip`. The handler's outer pg-boss surface never returns the error.

### 10.7 State machine closure

No new state machine. Outcome-feedback events are immutable point-in-time records — no transitions, no status field beyond `verdict` (which is closed: `pass | fail`, fixed at write time).

The `PromotionSignals` extension does not introduce new states either — it adds an additional input to an existing scoring function.

## 11. Observability

Four new structured log event types (§6.5). One existing event extended (`memory.retrieved`).

One new counter, surfaced via structured logs:
- `outcome_feedback_deltas_applied{org, subaccount, verdict, source}` — incremented on each successful write.

Three new audit-script checks (§14):
- Outcome-feedback firing rate per tenant per day.
- Per-tier delta-magnitude distribution.
- Saturated-block count per tenant per day.

No new dashboards in v1. Observability surface is structured-log-and-audit-script only.

## 12. Rollout & Rollback

**Flag:** reuses `MEMORY_CONSOLIDATION_TIER_ENABLED`. No new flag.

**Flag-off behaviour:**
- Dispatchers in `scorecardJudgeJob`, `taskApprovalService`, and the rollback stub all check `getMemoryConsolidationTierEnabled()` at enqueue time. False → no `sendWithTx` call, no job enqueued.
- Even if a job is somehow enqueued (legacy queue contents post-flag-flip), the handler's first action is the same flag check. False → no-op return.
- `reinforcementBatch.recordOutcomeFeedback` early-returns when flag is false.
- Net behaviour: identical to pre-build. Zero rows written, zero events emitted.

**Rollback:**
- Soft: set `signalWeights.outcomeFeedback = 0` in the active config and bump version to 3. Existing event-table rows stay (replay-friendly) but contribute zero to promotion. Same shape as the tier-consolidation team's planned rollback for any individual signal.
- Hard: flip `MEMORY_CONSOLIDATION_TIER_ENABLED` to false. Disables outcome feedback AND the existing tier-consolidation behaviour together — same-flag coupling is the trade-off documented in the brief.

The audit-script's existing 4-consecutive-pass gate on staging must absorb the new checks. Outcome feedback ships together with tier consolidation behaviour or not at all (same flag).

## 13. Determinism & Replayability

Three determinism contracts:

1. **Classification is pure.** `classifyOutcome(verdict, approvals, rollback)` is a pure function. Same input → same output across all runs.
2. **Delta is config-versioned.** Every event row stores `config_version`. Replaying the event stream against the same config version produces identical promotion scores.
3. **Cap check is deterministic.** Per-week cap uses `applied_at >= now() - interval '7 days'` — replayable if `now()` is pinned. For replay scenarios (audit script, dev fixtures), the cap check accepts a pluggable `now()`.

Weight rebalancing (v1 → v2) is intentional. The v1 weights (0.5 / 0.3 / 0.2) summed to 1.0; v2 keeps the sum at 1.0 by carving 0.2 out of the existing three signals proportionally — the relative ordering of the original three signals is preserved (reinforcement > recurrence > recency). Historical retrievals that ran against config v1 are not retroactively reweighted.

## 14. Audit-Script Extension

Three new checks appended to `scripts/audit/audit-memory-consolidation.ts`. Each returns `AuditCheckResult` (`{ checkName, status, findings, evidence }`) per the existing convention.

**Check 8 — Outcome-feedback firing rate per tenant per day.**
- Pass: every tenant with non-zero scorecard verdicts in the last 7 days has at least one `memory_outcome_feedback_events` row.
- Warn: a tenant has scorecard verdicts but zero outcome-feedback events (signal pipeline not connected for them).
- Fail: any cross-tenant row leak — `entry_id` referenced from `organisation_id` A while the entry belongs to `organisation_id` B.

**Check 9 — Per-tier delta-magnitude distribution.**
- Pass: median `|delta|` per tier is within `[0.05, 0.5]` (matches `outcomeFeedbackBaseDelta` ± config-bounded clamp).
- Warn: median outside that range — likely a config-version-drift signal.
- Fail: any delta with `ABS(delta) > 1.0` (out-of-CHECK-constraint impossibility — DB integrity bug).

**Check 10 — Saturated-block count per tenant per day.**
- Pass: < 1% of blocks saturate the weekly cap.
- Warn: 1-5% of blocks saturate.
- Fail: > 5% of blocks saturate (signals adversarial input or cap misconfiguration).

All three checks are pluggable into the existing 4-consecutive-pass-on-staging flag-flip gate.

## 15. Testing Posture

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`.

Vitest coverage limited to:

- `memoryOutcomeFeedbackServicePure.ts` — `classifyOutcome` (10+ truth-table cases), `computeDelta` (sign + scaling), `shouldDropForWeeklyCap` (boundary cases).
- `reinforcementBatch.ts` — new `recordOutcomeFeedback` buffer-accumulation tests; flush-target SQL shape (mocked).
- `evaluatePromotion` — new fourth-term composition tests (existing tests must not regress).
- Audit-script Check 8/9/10 verdict helpers — pure functions over fixture data.

No frontend, no API contract, no E2E. RLS coverage piggybacks on existing `verify-rls-coverage.sh` CI gate (the new `memory_outcome_feedback_events` manifest entry triggers automatic coverage check). Cross-tenant RLS fuzz tests are part of the existing memory-tier suite — new table inherits coverage via the manifest.

## 16. Files in Scope (Inventory Lock)

**New files (5):**
- `migrations/0XXX_memory_outcome_feedback_events.sql` — Chunk 1 (architect locks number)
- `server/services/memoryOutcomeFeedbackServicePure.ts` — Chunk 3
- `server/services/memoryOutcomeFeedbackService.ts` — Chunk 3
- `server/jobs/memoryOutcomeFeedbackJob.ts` — Chunk 5
- Vitest test files under `server/services/__tests__/` and `server/jobs/__tests__/` — co-located with the new modules

**Modified files (10):**
- `shared/types/memoryConsolidation.ts` — extend `PromotionSignals`, `SignalWeights`, `MemoryConsolidationConfig` types — Chunk 2
- `server/config/memoryConsolidationConfig.ts` — append v2 history entry, bump active version — Chunk 2
- `server/services/memoryBlockSynthesisService.ts` — extend `evaluatePromotion` totalScore; add signal-population query — Chunk 2
- `server/services/workspaceMemoryService/reinforcementBatch.ts` — add `recordOutcomeFeedback` buffer + flush path — Chunk 4
- `server/config/jobConfig.ts` — add `'memory:outcome-feedback'` entry — Chunk 5
- `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` — register worker — Chunk 5
- `server/jobs/scorecardJudgeJob.ts` — add subordinate dispatch inside verdict-write tx — Chunk 6
- `server/services/taskApprovalService.ts` — wrap decision-write in tx, add subordinate dispatch — Chunk 7
- `server/config/rlsProtectedTables.ts` — append `memory_outcome_feedback_events` entry — Chunk 1
- `scripts/audit/audit-memory-consolidation.ts` — append Check 8, 9, 10 — Chunk 8

**Stub-only modification (1):**
- `server/services/workspaceSnapshotService.ts` (or equivalent rollback owner — architect verifies at chunk-0) — add stubbed dispatch with TODO marker — Chunk 9

**Numeric count reconciliation:** 5 new files + 10 modified files + 1 stubbed = 16 files. 1 new migration. 1 new job type. 1 new table. 1 new field on `PromotionSignals` and 1 new field on `SignalWeights`. 0 new HTTP routes. 0 new flags. 0 new permission keys. Reconciled against §5 (data model) and §9 (chunk plan).

## 17. Success Criteria

1. A memory block injected into a scorecard-`fail` run with rejected approval has its `evaluatePromotion` `totalScore` reduced on the next consolidation cycle relative to its prior score, all other signals held constant. **Verifiable:** before/after `totalScore` comparison in a Vitest fixture.
2. A memory block injected into a scorecard-`pass` run with approved actions and no rollback has its `totalScore` raised beyond the prior signal weights' contribution. **Verifiable:** same fixture, opposite sign.
3. Per-block per-week cap holds under fuzz testing. **Verifiable:** Vitest property test — generate N adversarial events, assert `SUM(|delta|) <= weeklyCap + epsilon`.
4. Tenant isolation invariants hold. **Verifiable:** RLS fuzz tests in the existing memory-tier suite, plus audit-script Check 8 pass.
5. Audit-script Check 8, 9, 10 pass against a seeded fixture set. **Verifiable:** dedicated fixture under `scripts/audit/fixtures/`.
6. Replayability: same config version + same event stream produces same final scores. **Verifiable:** Vitest snapshot test — apply event list twice, assert `totalScore` identical.
7. Flag-off behaviour: dispatcher runs but applies zero delta, mutates no rows. **Verifiable:** Vitest test with mock `getMemoryConsolidationTierEnabled` returning false; assert zero DB writes.

## 18. Deferred Items

- **Per-block causal attribution within a run.** v1 attributes coarsely to the full set of blocks in `agent_runs.injected_entry_ids`. Per-block attribution (which specific block within a run contributed to the outcome) requires either an instrumented prompt-construction trace or an LLM-judged attribution pass. Deferred to v2 once the volume of `inconclusive` verdicts (a proxy for "we should have been more precise") justifies the cost.
- **Operator-facing "recently penalised" UI.** Memory inspector that surfaces `lastOutcomeFeedbackAt` + `lastOutcomeFeedbackVerdict`. Deferred to a follow-up build; not gated by this spec.
- **Rollback wiring.** `workspaceSnapshotService` dispatch site is stubbed in Chunk 9. Activated when `task-preview-mode` ships and rollback events become real.
- **Backfill of historical runs.** Forward-only at flag-on. Backfill would require iterating every `agent_runs` row with `injected_entry_ids IS NOT NULL` and applying the joint-state classifier — operationally expensive, semantically dubious (config drift since the run executed). Deferred indefinitely.
- **Cross-tenant outcome learning.** Explicitly out-of-scope — matches closed-loop's same non-goal. Not deferred; rejected.
- **LLM-based outcome interpretation.** Verdicts are read directly from the scorecard row. LLM-interpreted nuance (e.g., "this was a partial fail with a specific root cause") is out of scope; the scorecard system owns nuance.

## 19. Provenance

LinkedIn trend analysis 2026-05-18 (operator-anchored deep dive on the persistent-memory / overnight-agent post). The OP's claim that "failures decay confidence" and "learn only from resolved outcomes" was identified as one of three remaining gaps after `closed-loop-skill-improvement` (PR #353) and `memory-tiered-consolidation` (PR #351) closed the prior two.

External pattern provenance: confidence-decay-on-failure pattern from `localmem` (https://github.com/jordanaftermidnight/localmem) — effective-score formula `effective = base * (1 + α·access) * exp(-decay·age)`, extended here with outcome signal as a fourth additive term in the signal-weight sum (this spec uses additive in `evaluatePromotion`, not multiplicative on the final score). dreamgraph's `validates` / `invalidates` lifecycle reinforces the contract (positive vs negative signal as first-class). No external code adoption; pattern lift only.

Brief: `tasks/builds/memory-outcome-feedback/brief.md` (2026-05-18, operator-captured).
Hook-site grounding: commit `6e48183` (2026-05-19), full report in this session's grounding pass.

---

**End of spec.** Author hands off to `spec-reviewer` for adjudication, then to `architect` for plan.md decomposition.
