---
status: draft
spec_date: 2026-05-18
last_updated: 2026-05-19
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: claude/build-memory-outcome-feedback-3th7d
build_slug: memory-outcome-feedback
brief: tasks/builds/memory-outcome-feedback/brief.md
intent: tasks/builds/memory-outcome-feedback/intent.md
---

# Spec — Memory Outcome Feedback

Connects scorecard verdicts and approval decisions to the memory blocks that informed each run. Adds a fourth signal (`outcomeFeedback`) into `PromotionSignals` so the promotion score in `evaluatePromotion` reflects outcome quality, not just access frequency. No separate `confidence` field is mutated — see §1 Goal 1 and §2 Non-Goals.

This spec extends three already-shipped systems (`memory-tiered-consolidation`, `closed-loop-skill-improvement`, `memory-improvements`). It does not introduce new HTTP routes, UI surfaces, or product affordances; the `memory.retrieved` log extension (§6.5) is observability-only. The build closes the loop between systems that ship signal in isolation today.

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
| Build | M | One new job, two service modules (pure + impure shell), one new table + RLS, four new test files, twelve modified files, one stubbed file, audit-script extension. Three hook sites have placeholders pending architect chunk-0 resolution: (a) migration number; (b) `memory.retrieved` emitter file; (c) rollback owner. Full inventory in §16. |
| Carry | S | Job is bounded (no LLM, no external HTTP). The verdict-write and approval-write paths gain one transactional enqueue each — not a synchronous per-memory-entry write on those hot paths. Per-week cap prevents adversarial decay storms. Audit script picks up the new checks under the existing 4-pass gate. |
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

1. Memory blocks injected into a scorecard-`fail` run receive a negative promotion-score delta on the next consolidation cycle, all other signals held constant. (No separate "confidence" field is mutated — the signal flows through `evaluatePromotion`'s `totalScore`. See §4.7.)
2. Memory blocks injected into a scorecard-`pass` run with at least one approve decision and no rollback receive a positive delta beyond the existing access bump.
3. `inconclusive` verdicts, cancelled runs, runs with no injected memory, and `pass` verdicts that classify as `none` produce zero rows in `memory_outcome_feedback_events`. A single low-cardinality terminal info log per job invocation may still be emitted (see §10.4); no entry-level rows or per-entry events are produced.
4. Per-block per-week delta magnitude is bounded — adversarial input cannot move a block's score faster than the configured cap.
5. Tenant isolation is enforced at SQL via RLS on the organisation boundary; subaccount filtering is service-layer (matches the existing repo posture). No outcome feedback ever crosses `organisation_id` at the SQL layer; subaccount crossing is blocked at the service layer. RLS fuzz tests pass.
6. Reuses `MEMORY_CONSOLIDATION_TIER_ENABLED`. Zero new flags. Flag-off behaviour: dispatchers early-return at enqueue time; no job is enqueued, no rows are inserted, no events are emitted. Handler and `recordOutcomeFeedback` also early-return as defensive in-depth (for legacy queue contents post-flag-flip).
7. Replayability: same `MemoryConsolidationConfig` version + same outcome event stream + same `asOf` time produces same final scores.

## 2. Non-Goals

- No auto-deletion of memory based on negative feedback. The signal lowers `evaluatePromotion`'s `totalScore`; promotion/demotion thresholds in the existing tier-consolidation logic do the rest. Deletion stays operator-driven.
- No update to a separate `confidence` field on `workspace_memory_entries` — the signal flows only through the promotion-score additive term in `evaluatePromotion`. The intro paragraph's "memory confidence reflects outcome quality" is shorthand for "the promotion score reflects outcome quality"; no field named `confidence` is read or written by this build.
- No operator-facing "recently penalised" UI in v1. The `memory.retrieved` event extension is observability-only (§6.5); memory-inspector affordances are a follow-up build.
- No per-block causal attribution within a run — v1 attributes coarsely to the full `injected_entry_ids` set.
- No per-artefact attribution within a task on the approval path — v1 attributes coarsely to all eligible runs for the task at or before `decidedAt` (§3.4). No `agent_runs.artefact_id` column is added in this build.
- No outcome feedback for cancelled / blocked runs (those never produce a verdict; classification returns `none` for `verdict === null`).
- No cross-tenant outcome learning — explicitly out (matches closed-loop's same non-goal).
- No LLM in the job path. Verdict classification is a direct read off the scorecard row.
- No backfilling historical outcomes onto historical memory blocks. Forward-only from flag-on.
- No new feature flag. Reuses `MEMORY_CONSOLIDATION_TIER_ENABLED`.

## 3. Framing & Brief Departures

The brief was authored against a presumed code shape. The grounding pass against commit `6e48183` found seven places where the spec must lock a decision against the brief. Six are divergences (3.1–3.6); §3.7 confirms the brief's flag-reuse intent against the grounded surface. Each is listed below with its locked decision.

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
**Code:** `decideTaskApproval` correlates by `taskId` + `artefactId`. There is no `agent_run_id` field on the decision write. No `artefact → run_id` foreign key exists today.
**Locked:** dispatcher emits `{ taskId, artefactId, decisionId, decision, decidedAt }`. `decisionId` is a stable, monotonically-allocated identifier for the decision row (added in Chunk 7's `decideTaskApproval` refactor) — same value across retries of the same logical decision. The job handler resolves affected `agent_runs` rows via a `SELECT ... FROM agent_runs WHERE task_id = $1 AND created_at <= $decidedAt` lookup (see §6.4). `artefactId` is logged but not used for run filtering — no `agent_runs.artefact_id` column exists.

**Coarse attribution acknowledged.** Without a run↔artefact link, this v1 attributes the approval outcome to all eligible runs for the task at or before `decidedAt`, capped at 50. This is the same coarse v1 attribution `closed-loop-skill-improvement` adopted; per-artefact attribution is on the v2 deferred list (§18). The non-goal in §2 already excludes per-block causal attribution within a run; we extend it to also exclude per-artefact attribution within a task.

If zero runs resolve, log structured `memory.outcome_feedback.no_run_resolved` and exit cleanly (no signal).

### 3.5 Approval transaction surface

**Brief:** "subordinate dispatch inside the transaction (mirrors the `failure:post-mortem` dispatch pattern)".
**Code:** `decideTaskApproval` does NOT open a `db.transaction(tx)` today. It writes via `writeConversationMessage` against `getOrgScopedDb('taskApprovalService')`. `sendWithTx` is the existing helper used by `scorecardJudgeJob` for at-least-once dispatch (`server/services/queueService/sendWithTx.ts`).
**Locked:** Chunk 7 of this build:
1. Adds a `decisionId` allocation (UUID generated before the write, or returned by the write — implementation choice in Chunk 7).
2. Wraps the decision-write portion in `db.transaction(async (tx) => …)`. Inside the tx:
   - `writeConversationMessage(tx, …)` — gains a `tx` parameter (refactor scoped within Chunk 7); other callers continue to pass implicit `getOrgScopedDb('taskApprovalService')`.
   - `sendWithTx(tx, 'memory:outcome-feedback', { source: 'approval', taskId, artefactId, decisionId, decision, decidedAt, organisationId, subaccountId })`.
3. Keeps `proposeAction` and any LLM-issuing side-effects OUTSIDE the tx — they remain after the tx commits, ordered after the existing behaviour.

**Before/after side-effect ordering (decideTaskApproval).**

| Step | Before (current) | After (Chunk 7) |
|---|---|---|
| 1 | (entry to function) | Allocate `decisionId`, `decidedAt` |
| 2 | `writeConversationMessage(getOrgScopedDb(...))` | `db.transaction(tx => { writeConversationMessage(tx, ...); sendWithTx(tx, 'memory:outcome-feedback', ...) })` |
| 3 | `proposeAction(...)` (if applicable) | `proposeAction(...)` (unchanged; runs after tx commits) |

`writeConversationMessage`'s signature changes are scoped: the function gains an optional `tx?` parameter that defaults to `getOrgScopedDb('taskApprovalService')` when omitted, preserving every existing call-site without modification. Verify at chunk-0 that no other tx-bound caller of `writeConversationMessage` exists. This is the minimum refactor that preserves at-least-once dispatch semantics.

### 3.6 Signed-delta storage

**Brief:** "modify `reinforcementBatch.ts` — accept signed deltas in addition to access bumps".
**Code:** `recordAccess` accumulates positive integer bumps into `Map<string, Map<string, number>>`, flushed as `access_count = access_count + N`. `access_count` is monotonic; it cannot hold a signed delta.
**Locked:** introduce a new RLS-protected table `memory_outcome_feedback_events` that stores every applied delta as an immutable row. `reinforcementBatch` gets a separate buffer for outcome-feedback events; same flusher infrastructure, distinct write target. The events table is the source of truth for `evaluatePromotion`'s outcome-feedback signal value AND for the per-block per-week cap. See §5.1 and §6.3.

### 3.7 Departure from "tier-flag-only" rollout

The brief says "reuse `MEMORY_CONSOLIDATION_TIER_ENABLED` — no new flag". Locked. The dispatcher reads `getMemoryConsolidationTierEnabled()` at dispatch time. When false: **dispatcher early-returns; no `sendWithTx` call; no job is enqueued; no rows are inserted; no events are emitted from the dispatch surface.** Two further layers (handler defensive flag-check at step 1, and `recordOutcomeFeedback` defensive flag-check at buffer time) catch legacy queue contents in defence-in-depth — see §12 "Flag-off behaviour" for the full three-layer model.

## 4. Architecture

### 4.1 Outcome classification

The handler classifies a `(scorecardVerdict, approvalsForTask, rollbackFiredForRun)` tuple into one of three outcome signals:

- **positive** — verdict is `pass` AND `approvalsForTask.length > 0` AND every `approvalsForTask[i].decision === 'approve'` AND `!rollbackFiredForRun`.
- **negative** — verdict is `fail` AND (`approvalsForTask` contains at least one `reject` OR `rollbackFiredForRun === true`).
- **none** — anything else: `inconclusive` verdict, null verdict (not yet judged), `pass` with zero approvals, `pass` with mixed/reject approvals, `fail` with neither reject nor rollback, run has no `injected_entry_ids`.

Note on `positive`: the rule requires at least one explicit approve. A `pass` verdict with zero approvals classifies as `none`. This closes the `every([]) === true` JavaScript pitfall and matches Goal 2 ("approved actions").

In v1, `rollbackFiredForRun` is always `false` — the rollback dispatch path (§9 Chunk 9) is stubbed and no source-of-truth for rollback state exists yet. Classification accepts the field for forward-compatibility; the handler hard-wires `rollbackFiredForRun = false` until the `task-preview-mode` build ships. See §6.2 for the source contract.

Cancelled runs are excluded by construction: cancelled runs never receive a scorecard verdict (verdict is null), so classification returns `none` without a separate cancellation check. The handler does not query `agent_runs.status`.

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

For each candidate write, the handler issues, **inside the handler's outer transaction**, a Postgres advisory lock plus a sum query:

```sql
-- Serialise cap check + write per (organisation_id, entry_id) within this tx.
SELECT pg_advisory_xact_lock(
  hashtextextended($organisationId::text || ':' || $entryId::text, 0)
);

SELECT COALESCE(SUM(ABS(delta)), 0) AS used_magnitude
FROM memory_outcome_feedback_events
WHERE entry_id = $1
  AND organisation_id = $2
  AND subaccount_id IS NOT DISTINCT FROM $3
  AND applied_at >= $4 - interval '7 days';  -- $4 = asOf (pluggable for replay)
```

`pg_advisory_xact_lock` is held until the transaction commits/rolls back, serialising the cap check + write for the same `(organisationId, entryId)` across concurrent handler instances. The lock key is a 64-bit hash of `org_id || ':' || entry_id`; collisions are rare and would only cause harmless extra serialisation.

If `used_magnitude + ABS(newDelta) > config.outcomeFeedbackWeeklyCap` (default 1.0), the write is **dropped** (not clamped) and the handler emits a structured `memory.outcome_feedback.weekly_cap_saturated` log with `{ entry_id, used_magnitude, attempted_delta, config_version }`. Dropping (vs clamping) keeps the math deterministic — partial credit complicates replay.

**Replayability note.** The window uses `$asOf - interval '7 days'` rather than `now() - interval '7 days'`. The handler passes `now()` in normal operation; the audit-script and replay harness pass a pinned `asOf` for deterministic replay (§13).

**Saturated count for Check 10.** Because saturated writes are dropped (not stored), Check 10 (§14) cannot derive the saturated-block count from the events table alone. It reads structured `memory.outcome_feedback.weekly_cap_saturated` log events; the audit-script accepts a log-source path as input.

### 4.4 Dispatch surfaces

Three dispatch surfaces, all inside the existing transaction that writes the originating event:

| Surface | File | Trigger | Payload |
|---|---|---|---|
| Verdict-write | `server/jobs/scorecardJudgeJob.ts` | Inside the verdict-insert `tx`, after the existing `failure:post-mortem` dispatch | `{ source: 'scorecard', runId, verdict, organisationId, subaccountId, scorecardJudgementId }` |
| Approval-decision | `server/services/taskApprovalService.ts` | Inside the new `db.transaction(tx)` wrapping the decision write | `{ source: 'approval', taskId, artefactId, decisionId, decision, decidedAt, organisationId, subaccountId }` |
| Rollback-fire | `server/services/workspaceSnapshotService.ts` (stub) | Stubbed in v1 — wired when `task-preview-mode` ships | `{ source: 'rollback', runId, organisationId, subaccountId }` |

All three enqueue to the same job queue `memory:outcome-feedback`. The handler dispatches on `payload.source` to resolve the affected run(s).

### 4.5 Job handler

`server/jobs/memoryOutcomeFeedbackJob.ts` — single async handler.

Flow:
1. **Flag check (defence in depth).** Read `getMemoryConsolidationTierEnabled()`. False → return `{ status: 'noop', reason: 'flag_off' }` without touching the DB. Dispatchers already gate enqueue (§4.4 / §12); this is a second line of defence for legacy queue contents.
2. **Acquire tenant context.** Open `withOrgTx({ organisationId, subaccountId })`. This is the existing repo primitive (see `docs/spec-context.md § accepted_primitives` — `withOrgTx / getOrgScopedDb / withAdminConnection`). All subsequent reads and writes ride this transaction.
3. **Resolve affected runs:**
   - `source: 'scorecard'` → `runId` from payload.
   - `source: 'approval'` → SQL lookup (§6.4) returns 0..51 runs (§6.4 defines the 51-row truncation behaviour).
   - `source: 'rollback'` → in v1, this branch is unreachable (the dispatch site is stubbed); when wired, `runId` from payload.
4. **Per-run loop.** For each resolved run, fetch `agent_runs.injected_entry_ids`. Apply `injected_entry_ids` validation (§4.5.1): parse the JSONB; reject if not an array of UUID strings; de-duplicate.
5. **Per-entry loop.** For each unique `(run, entry)`:
   - Compute classification by reading canonical scorecard + approval state for the run. `rollbackFiredForRun` is hard-wired to `false` in v1 (see §4.1).
   - If classification is `none` → increment `classifiedNone` counter; continue.
   - Idempotency pre-check: `SELECT 1 FROM memory_outcome_feedback_events WHERE run_id = $r AND entry_id = $e AND source = $s LIMIT 1`. If row exists → increment `idempotent` counter; continue.
   - Per-week cap check under advisory lock (§4.3). If saturated → increment `capped` counter; emit `memory.outcome_feedback.weekly_cap_saturated`; continue.
   - Buffer the write through `reinforcementBatch.recordOutcomeFeedback({ entryId, organisationId, subaccountId, runId, classification, scorecardVerdict, sourceRef, delta, source, configVersion })`. Increment `written` counter (counted at buffer time; flush errors degrade to `errors` per §4.6).
6. **Flush and terminal event.** After the loop, the handler awaits the flusher (or registers a synchronous-on-job-completion flush — see §4.6 below). Emit exactly one terminal `memory.outcome_feedback.applied` event with `{ status, counts: { written, idempotent, capped, classifiedNone, noMemory, errors } }`. `status` is computed per §10.4–§10.5.

The handler is bounded — no LLM calls, no external HTTP. Worst case is O(injected_entry_ids.length) writes per resolved run, capped by §4.5.1 below.

### 4.5.1 `injected_entry_ids` validation and limits

The handler validates each `agent_runs.injected_entry_ids` payload before iterating:

- Must be a JSON array. Non-array → log `memory.outcome_feedback.invalid_injected_ids` with `{ run_id, shape }`, count toward `errors`, continue with the next run.
- Each element must parse as a UUID string. Non-UUID elements are skipped and counted toward `errors`.
- Within a single run, duplicate UUIDs are de-duplicated (idempotency would catch them anyway; pre-dedup avoids 23505 churn).
- Hard cap: max 200 entries per run. Pathological runs exceeding 200 entries are truncated; the handler emits `memory.outcome_feedback.injected_ids_truncated` with `{ run_id, total, processed: 200 }` and sets terminal status to `partial`.

### 4.5.2 Source-data lookup (canonical state)

The handler does NOT trust `payload.verdict` for classification:

- `scorecard verdict` is read from `scorecard_judgements` by `scorecardJudgementId` (scorecard source) or by `runId` (approval / rollback source — most-recent judgement, if any).
- `approvalsForTask` is read by `taskId` against the approval-decision store.
- `rollbackFiredForRun` is `false` in v1 (§4.1).

### 4.6 Reinforcement-batch extension

`server/services/workspaceMemoryService/reinforcementBatch.ts` gains a parallel buffer:

```ts
type OutcomeFeedbackEvent = {
  entryId: string;
  organisationId: string;
  subaccountId: string | null;
  runId: string;
  classification: 'positive' | 'negative';
  scorecardVerdict: 'pass' | 'fail' | null;
  sourceRef: Record<string, unknown>;       // diagnostic JSONB (see §5.1)
  delta: number;                            // signed numeric value within [-1.0, 1.0]
  source: 'scorecard' | 'approval' | 'rollback';
  configVersion: number;
};

function recordOutcomeFeedback(event: OutcomeFeedbackEvent): void;
```

Buffered alongside access bumps. Same flusher infrastructure but distinct flush target:
- Access bumps flush via `UPDATE workspace_memory_entries SET access_count = access_count + N`.
- Outcome-feedback events flush via `INSERT INTO memory_outcome_feedback_events (...) VALUES (...)` (no upsert — events are immutable).

**Per-row error handling.** The outcome-feedback flush iterates rows; each `INSERT` is wrapped so that `23505 unique_violation` increments the job's `idempotent` counter (aggregated, not per-row logged) and other errors increment `errors`. A single failing row does not abort the batch — the flusher commits successful rows and reports per-row outcomes back via a flush-result struct.

**Flush ordering vs terminal event.** To preserve §10.4's terminal-event guarantee, the job handler triggers a **synchronous outcome-feedback flush** before emitting the terminal `memory.outcome_feedback.applied` event. This is a deviation from the access-bump pattern (which flushes on a 60s / 500-event cadence): outcome-feedback writes must be durable before the terminal event reports `status: success`. The job-handler's `Promise<void>` does not resolve until the flush completes.

**Flag-gating.** `recordOutcomeFeedback` reads `getMemoryConsolidationTierEnabled()` at buffer time. False → early-return without queueing. Matches `recordAccess`'s flag-gate.

**Why extend the existing primitive rather than introduce a new service.** `reinforcementBatch.ts` already owns the "buffer per-org → periodic flush under tenant context" pattern that outcome feedback needs. The two write targets (access bump vs event insert) are different SQL but the buffering, flushing, and tenant-context machinery are identical. Introducing a separate `outcomeFeedbackWriter.ts` would duplicate the buffering machinery; see `docs/spec-context.md § prefer_existing_primitives_over_new_ones: yes`.

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

`signals.outcomeFeedback` is computed by the same call-site that populates `signals.reinforcementCount` today (`memoryBlockSynthesisService.populatePromotionSignals` — to be added in Chunk 2; the existing function builds a per-candidate signal struct and is the natural extension point). The query is **batched across all candidate entries in a single synthesis pass** to avoid N+1:

```sql
SELECT entry_id, COALESCE(SUM(delta), 0) AS outcome_feedback
FROM memory_outcome_feedback_events
WHERE entry_id = ANY($1::uuid[])
  AND organisation_id = $2
  AND subaccount_id IS NOT DISTINCT FROM $3
  AND applied_at >= $4 - $5::interval     -- $4 = asOf (default now()), $5 = window
GROUP BY entry_id;
```

The window matches `config.reinforcementWindow` (the existing config field used by `reinforcementCount`'s query) so the four signals compose against consistent timeframes. If no row is returned for an entry (no outcome events in the window), `signals.outcomeFeedback` defaults to `0`.

**Score range.** `totalScore` is now a signed real value. Existing thresholds (promotion / demotion) were designed against non-negative inputs; with `outcomeFeedback` allowing negative deltas, `totalScore` can be negative. `evaluatePromotion`:
- Does NOT clamp the score to `≥ 0`; the signed score is the input to threshold comparisons.
- The existing promotion threshold continues to apply as `totalScore >= promotionThreshold`; a negative score will fail this naturally.
- A new optional `demotionThreshold` field is NOT added in this build (would change the state machine — directional). The signal lowers promotion probability but does not, in v1, trigger demotion.
- Vitest covers: negative score does not erroneously promote; positive score above threshold promotes; signal of zero is a no-op for existing test cases.

**Historical config replay.** v1 config entries lack `signalWeights.outcomeFeedback`. The signal-weights consumer applies a normalisation layer: any missing weight defaults to `0`, missing `outcomeFeedbackBaseDelta` defaults to `0`, missing `outcomeFeedbackWeeklyCap` defaults to `0`. Replaying v1 against the new four-signal scoring function therefore produces v1 behaviour (the new term contributes zero). Normalisation lives next to `MEMORY_CONSOLIDATION_CONFIG_HISTORY` in `server/config/memoryConsolidationConfig.ts`.

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
  classification  text NOT NULL CHECK (classification IN ('positive', 'negative')),
  scorecard_verdict text CHECK (scorecard_verdict IS NULL OR scorecard_verdict IN ('pass', 'fail')),
  source_ref      jsonb,                                -- diagnostic provenance (e.g. { judgementId } | { decisionId, artefactId, taskId })
  delta           numeric(6,3) NOT NULL CHECK (delta >= -1.0 AND delta <= 1.0),
  config_version  integer NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_outcome_feedback_events_idempotent UNIQUE (run_id, entry_id, source)
);

CREATE INDEX idx_memory_outcome_feedback_lookup
  ON memory_outcome_feedback_events (entry_id, organisation_id, subaccount_id, applied_at DESC);

ALTER TABLE memory_outcome_feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_outcome_feedback_events_isolation
  ON memory_outcome_feedback_events
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

Column rationale:
- `classification` (`'positive' | 'negative'`) captures the applied signal direction — it covers approval-only and rollback-only sources, which don't have a meaningful `scorecard_verdict`.
- `scorecard_verdict` is nullable; populated for `source='scorecard'` rows and copied through for `source='approval' | 'rollback'` rows when known. `source='approval'` with no verdict yet → `null`.
- `source_ref` (jsonb) carries diagnostic provenance: for scorecard `{ scorecardJudgementId }`; for approval `{ decisionId, artefactId, taskId }`; for rollback `{ runId }`. No application logic reads `source_ref`; it exists for replay / audit / debugging only.
- `delta` is `numeric(6,3)` — chosen for deterministic replay; `real` (32-bit float) introduces precision variance across hardware. `numeric` arithmetic is exact within the column's scale.
- RLS policy uses `current_setting('app.organisation_id', true)` (the two-argument form) and adds `WITH CHECK` so INSERT and UPDATE both enforce the same predicate — matches the repo convention from migration 0192 (see `architecture.md § Row-Level Security`).

The unique constraint `(run_id, entry_id, source)` is the idempotency guarantee — same source firing twice for the same run/entry is a `23505` no-op. Multiple sources for the same `(run_id, entry_id)` are permitted by design (a run can accumulate signal from both scorecard and approval); double-counting is bounded by the weekly cap (§4.3).

**Tenant-consistency invariant (service-layer enforced).** RLS guarantees only that `organisation_id` matches the request principal. The events table does not guarantee at the SQL layer that `entry_id` and `run_id` belong to the same `(organisation_id, subaccount_id)` as the event row. The job handler enforces this by reading the referenced rows under `withOrgTx({ organisationId, subaccountId })` — if the FK row is invisible under RLS, the lookup returns zero rows and the event is dropped. Audit-script Check 8 (§14) provides a defence-in-depth scan for any historical leak. Composite FKs are not introduced — that's a directional architecture change deferred to v2 if Check 8 ever fails.

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
      verdict: 'pass' | 'fail' | 'inconclusive';   // advisory; canonical state re-read from scorecard_judgements row
      organisationId: string;
      subaccountId: string | null;
      scorecardJudgementId: string; }
  | { source: 'approval';
      taskId: string;
      artefactId: string;
      decisionId: string;
      decision: 'approve' | 'reject';
      decidedAt: string;                             // ISO-8601 timestamp; used as upper bound in §6.4 lookup
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
**Payload-vs-canonical-state:** for `source: 'scorecard'`, the embedded `verdict` is advisory (used for logging and singleton-key composition). The handler always re-reads the canonical row by `scorecardJudgementId` before classification — if payload and DB disagree (e.g. stale retry), the DB row wins.
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

Rules (exhaustive; equivalent to §4.1, rewritten with explicit parentheses):
- `verdict === 'pass'` AND `approvalsForTask.length > 0` AND `approvalsForTask.every(a => a.decision === 'approve')` AND `!rollbackFiredForRun` → `positive`.
- `verdict === 'fail'` AND (`approvalsForTask.some(a => a.decision === 'reject')` OR `rollbackFiredForRun`) → `negative`.
- Anything else → `none`. This includes: `verdict === null`, `verdict === 'inconclusive'`, `verdict === 'pass'` with `approvalsForTask.length === 0`, `verdict === 'pass'` with any reject, `verdict === 'fail'` with no reject and no rollback.

Source-of-truth precedence: the **scorecard verdict row** is the canonical pass/fail signal. Approval decisions modify intensity. Rollback is a secondary amplifier. If verdict is null (not yet judged), result is always `none`.

`rollbackFiredForRun` source in v1: always `false`. The handler does not query any rollback state in v1; the field is in the contract for forward-compatibility with `task-preview-mode`. When that build ships, the handler will resolve the field from a named rollback-state source (defined in that spec, not this one).

**Example instances** (one per output branch):

```ts
// → 'positive'
classifyOutcome({
  verdict: 'pass',
  approvalsForTask: [{ decision: 'approve' }, { decision: 'approve' }],
  rollbackFiredForRun: false,
}) === 'positive';

// → 'negative' (verdict + reject)
classifyOutcome({
  verdict: 'fail',
  approvalsForTask: [{ decision: 'reject' }],
  rollbackFiredForRun: false,
}) === 'negative';

// → 'negative' (verdict + rollback amplifier)
classifyOutcome({
  verdict: 'fail',
  approvalsForTask: [],
  rollbackFiredForRun: true,
}) === 'negative';

// → 'none' (inconclusive verdict)
classifyOutcome({
  verdict: 'inconclusive',
  approvalsForTask: [{ decision: 'approve' }],
  rollbackFiredForRun: false,
}) === 'none';

// → 'none' (verdict null — not yet judged)
classifyOutcome({
  verdict: null,
  approvalsForTask: [],
  rollbackFiredForRun: false,
}) === 'none';

// → 'none' (pass verdict, zero approvals — closes the every([]) === true pitfall)
classifyOutcome({
  verdict: 'pass',
  approvalsForTask: [],
  rollbackFiredForRun: false,
}) === 'none';

// → 'none' (fail verdict, neither reject nor rollback — e.g. fail with all-approve)
classifyOutcome({
  verdict: 'fail',
  approvalsForTask: [{ decision: 'approve' }],
  rollbackFiredForRun: false,
}) === 'none';
```

### 6.3 Signed-delta record — events table

Contract pinned in §5.1. Source-of-truth precedence: the events table is canonical; `evaluatePromotion`'s `signals.outcomeFeedback` is a derived aggregate, not a stored value. If the events table and any cached aggregate disagree, the events table wins.

### 6.4 Approval → run resolution SQL contract

```sql
SELECT id
FROM agent_runs
WHERE task_id = $1
  AND organisation_id = $2
  AND (subaccount_id IS NOT DISTINCT FROM $3)
  AND created_at <= $4  -- payload.decidedAt
  AND injected_entry_ids IS NOT NULL
ORDER BY created_at DESC
LIMIT 51;  -- safety cap + truncation detector
```

Returns 0..51 runs. The handler:
- 0 rows → log `memory.outcome_feedback.no_run_resolved` and exit cleanly.
- 1..50 rows → process all returned rows normally.
- 51 rows → process the first 50, emit `memory.outcome_feedback.fanout_cap_truncated` with `{ task_id, returned_count: 51 }`, set the job's terminal status to `partial`.

Tasks with more than 50 runs at a single decision time are pathological; the truncation log captures the case for follow-up without failing the job.

### 6.5 Structured log events

All event names use the `memory.outcome_feedback.*` namespace. References elsewhere in the spec must use the full prefixed name — bare `outcome_feedback.*` references are stale.

New event types:

- `memory.outcome_feedback.applied` — terminal event per job invocation. Shape:
  ```
  { run_id | task_id, source, organisation_id, subaccount_id,
    config_version, status: 'success' | 'partial' | 'failed' | 'noop',
    counts: { written, idempotent, capped, classifiedNone, noMemory, errors },
    total_delta_magnitude }
  ```
- `memory.outcome_feedback.no_run_resolved` — `{ task_id, artefact_id, decision_id, source, organisation_id, subaccount_id }`. Fired when §6.4 returns 0 rows.
- `memory.outcome_feedback.weekly_cap_saturated` — `{ entry_id, used_magnitude, attempted_delta, source, organisation_id, subaccount_id, config_version }`. Fired per dropped write.
- `memory.outcome_feedback.fanout_cap_truncated` — `{ task_id, returned_count, processed: 50, source, organisation_id, subaccount_id }`. Fired when §6.4 returns 51 rows (the +1 truncation detector).
- `memory.outcome_feedback.invalid_injected_ids` — `{ run_id, shape, source, organisation_id, subaccount_id }`. Fired when `agent_runs.injected_entry_ids` is not a JSON array of UUIDs.
- `memory.outcome_feedback.injected_ids_truncated` — `{ run_id, total, processed: 200, source, organisation_id, subaccount_id }`. Fired when a run exceeds the 200-entry cap (§4.5.1).

**Aggregated `idempotent_skip`.** Duplicate-row catches inside the flusher are NOT logged per row. Instead the per-job terminal event's `counts.idempotent` carries the total count. This avoids high-cardinality logs on a retry storm.

**Example instances** (one per event type):

```json
// memory.outcome_feedback.applied — terminal success
{ "event": "memory.outcome_feedback.applied",
  "run_id": "8c1c1d3a-7e8a-4d28-9b2f-2a4d5e6f7a8b",
  "source": "scorecard",
  "organisation_id": "org-1", "subaccount_id": "sub-9",
  "config_version": 2, "status": "success",
  "counts": { "written": 3, "idempotent": 0, "capped": 0,
              "classifiedNone": 0, "noMemory": 0, "errors": 0 },
  "total_delta_magnitude": 0.3 }

// memory.outcome_feedback.applied — noop (flag off)
{ "event": "memory.outcome_feedback.applied",
  "source": "approval", "task_id": "task-42",
  "organisation_id": "org-1", "subaccount_id": null,
  "config_version": 2, "status": "noop",
  "counts": { "written": 0, "idempotent": 0, "capped": 0,
              "classifiedNone": 0, "noMemory": 0, "errors": 0 },
  "total_delta_magnitude": 0 }

// memory.outcome_feedback.no_run_resolved
{ "event": "memory.outcome_feedback.no_run_resolved",
  "task_id": "task-42", "artefact_id": "art-17", "decision_id": "dec-501",
  "source": "approval",
  "organisation_id": "org-1", "subaccount_id": null }

// memory.outcome_feedback.weekly_cap_saturated
{ "event": "memory.outcome_feedback.weekly_cap_saturated",
  "entry_id": "entry-77", "used_magnitude": 0.95, "attempted_delta": -0.1,
  "source": "scorecard", "organisation_id": "org-1", "subaccount_id": "sub-9",
  "config_version": 2 }

// memory.outcome_feedback.fanout_cap_truncated
{ "event": "memory.outcome_feedback.fanout_cap_truncated",
  "task_id": "task-42", "returned_count": 51, "processed": 50,
  "source": "approval", "organisation_id": "org-1", "subaccount_id": null }
```

**Observability metric.** `outcome_feedback_deltas_applied{org, subaccount, classification, source}` is **derived from the `memory.outcome_feedback.applied` terminal event's counts** via the existing structured-log → metrics pipeline; this build does not add a new metrics emitter. §11 was updated to reflect this.

**`memory.retrieved` extension (observability-only).** The existing `memory.retrieved` event payload gains two fields:
- `lastOutcomeFeedbackAt: timestamptz | null`
- `lastOutcomeFeedbackClassification: 'positive' | 'negative' | null`

These are observability fields only — they do not appear in any HTTP response, UI surface, or new product surface. The fields are populated from the same per-entry query that drives `signals.outcomeFeedback`; cost is amortised through the batched query in §4.7. The richer fields suggested by Codex (net signal, source breakdown) are deferred to v2 (see §18 — "Operator-facing 'recently penalised' UI"). Source files for `memory.retrieved` emission — `server/services/workspaceMemoryService/*.ts` — are listed in §16 inventory.

## 7. Permissions / RLS

RLS posture: **RLS enforces the organisation boundary; subaccount filtering is service-layer.**

`memory_outcome_feedback_events` is the only new table. Four requirements:

1. **RLS policy** — created in the same migration that creates the table (§5.1). `USING (organisation_id = current_setting('app.organisation_id', true)::uuid) WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid)`. The two-argument `current_setting(..., true)` form returns NULL when the GUC is absent rather than throwing; the comparison then evaluates to NULL (i.e. denies) under default-deny posture (matches migration 0192 convention). No subaccount-scoped policy — `subaccount_id IS NOT DISTINCT FROM $sub` filtering applied at the service layer.
2. **`server/config/rlsProtectedTables.ts` entry** — append `memory_outcome_feedback_events` with `policyMigration: '0XXX_memory_outcome_feedback_events.sql'` (architect locks the number at chunk-0; the manifest entry and the migration file name must be updated together in the same commit).
3. **Route-level guard** — N/A. Table is job-only; no HTTP route reads or writes it in v1.
4. **Principal-scoped context** — every read and write happens inside `withOrgTx({ organisationId, subaccountId })`, established by the job handler at step 2 of its flow (§4.5). `withOrgTx` is the existing primitive listed in `docs/spec-context.md § accepted_primitives` (alongside `getOrgScopedDb` and `withAdminConnection`); this build does not introduce a new transactional helper.

`scorecard_judgements` and `workspace_memory_entries` (`server/config/rlsProtectedTables.ts:868` and `:1118`) are already protected. No new RLS work on the existing surfaces.

No new permission keys. The job is dispatched by services that already hold tenant-scoped auth context.

**FK delete-cascade decision.** `ON DELETE CASCADE` on `entry_id` and `run_id` deletes outcome-feedback history when the referenced row is deleted. This matches the existing repo posture for derived/audit tables and avoids orphan rows. Outcome-feedback events are NOT a primary audit-of-record source — the canonical audit trail for scorecard verdicts and approval decisions lives on their own tables and is preserved. If audit retention of outcome events ever becomes a compliance requirement, switching to `ON DELETE SET NULL` with copied org/source fields is a clean future migration; explicitly deferred (see §18).

## 8. Execution Model

**Asynchronous, queued (pg-boss).** The job is decoupled from the originating event (verdict write, approval decision, rollback). Three reasons:

1. Verdict and approval write paths must stay fast — no synchronous fan-out across N memory entries.
2. The job needs to query joint state (verdict + approvals + rollback) — that's a multi-row read that does not belong in the originating transaction.
3. Retry semantics — if the job fails, pg-boss retries with the existing DLQ pattern.

**Cached / partitioned:** N/A. No LLM prompts. No cache decisions.

**Inline / synchronous:** N/A. No caller blocks on outcome-feedback application.

Consistency pass:
- Job idempotency entry: `'memory:outcome-feedback'` is added to `server/config/jobConfig.ts` with `idempotencyStrategy: 'payload-key'` and a singleton key per source (see §10.1 for the exact key composition by source).
- Retry / backoff / DLQ: the job adopts the existing `jobConfig.ts` defaults used by `failure:post-mortem` (the closest sibling — same job category, same shape, same retry envelope). The handler is guarded (§10.2), so unconditional retry is safe. After retries exhaust, the job lands in the existing pg-boss DLQ; no new DLQ surface is introduced.
- Prose describes the operation as "the handler does X" — handler is in `memoryOutcomeFeedbackJob.ts`. Matches the queued model.
- Non-functional goals: none stated (no latency budget, no cache efficiency claim).

## 9. Phase Sequencing & Chunk Plan

The architect locks per-chunk detail in `plan.md`. Spec-level chunk order:

**Chunk 0 (pre-implementation, architect).** Lock the migration number and the two file-name placeholders ((b) `memory.retrieved` emitter, (c) rollback owner) before any chunk ships. Output: an addendum to plan.md updating the file inventory in §16 with the resolved names. No code changes.

**Chunk 1 — Schema & RLS.** Migration `0XXX_memory_outcome_feedback_events.sql` (creates table, RLS policy, index, unique constraint per §5.1). Append entry to `rlsProtectedTables.ts` with the exact migration filename. No code consumers yet — table can sit empty.

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
| `INSERT INTO memory_outcome_feedback_events` | **key-based** | UNIQUE `(run_id, entry_id, source)` (§5.1). Duplicate fire → `23505` caught and logged as aggregated `idempotent_skip` (one log per job, not per row). |
| Job enqueue from `scorecardJudgeJob` | **key-based** | pg-boss `singletonKey: memory-outcome-feedback:scorecard:${scorecardJudgementId}` — keyed by the immutable judgement ID so a later judgement for the same run is not suppressed. |
| Job enqueue from `decideTaskApproval` | **key-based** | pg-boss `singletonKey: memory-outcome-feedback:approval:${decisionId}` — keyed by the decision ID, not `artefactId`, so multiple decisions for the same artefact do not collapse. |
| Job enqueue from rollback (stub) | **key-based** | pg-boss `singletonKey: memory-outcome-feedback:rollback:${runId}` — rollback fires at most once per run. |
| Job handler resolution + write | **key-based** | Per `(run_id, entry_id, source)` — handler queries the events table before writing, and the flusher catches `23505` per-row on insert (see §4.6 / §10.6). |

### 10.2 Retry classification

- `INSERT` into events table: **guarded** — unique constraint makes retry safe; `23505` is no-op.
- Job enqueue via `sendWithTx`: **guarded** — pg-boss singletonKey blocks duplicates.
- Job execution: **guarded** — handler re-checks idempotency before every write.

No `unsafe` operations in the new code path. The existing verdict-write and approval-write paths retain their current classification — this build does not change those.

### 10.3 Concurrency guard for racing writes

Four scenarios:

**(a) Two `scorecardJudgeJob` retries for the same run.** Guarded by the existing `onConflictDoNothing()` on verdict insert — only the first commits; the second's `sendWithTx` sees `insertedJudgementId === undefined` and skips dispatch (matches the existing `failure:post-mortem` guard).

**(b) Two outcome-feedback jobs for the same run from different sources** (e.g., scorecard fires, then approval fires). Both can land; the handler resolves to different `source` rows in the events table — UNIQUE `(run_id, entry_id, source)` permits this. The intended semantics: the same run can accumulate signal from multiple independent sources (scorecard verdict + approval decision + future rollback), with double-counting bounded by the weekly cap (§4.3). The unique key is intentionally `(run_id, entry_id, source)` rather than `(run_id, entry_id)` to keep each source's contribution traceable in the audit trail.

**(c) Two concurrent handlers racing the cap check.** Guarded by `pg_advisory_xact_lock(hash(orgId || ':' || entryId))` (§4.3). Held until handler tx commits; the second handler serialises behind the first and computes its cap against the first handler's just-committed rows.

**(d) Same job retried by pg-boss after handler partial failure.** Per-entry idempotency check inside the handler (§4.5 step 5) means a retried handler skips already-written entries via the pre-check, and the flusher catches any remaining `23505` per-row. The retried handler resumes the counts accurately.

### 10.4 Terminal event guarantee

Per job invocation, exactly one terminal `memory.outcome_feedback.applied` event with `status` ∈ `{ success, partial, noop, failed }`:

- `success` — at least one entry was `written`, and `capped + errors + (fanout truncation count) + (injected-ids truncation count) === 0`. Pure `idempotent` and `classifiedNone` counts are compatible with `success` (no new signal, no failure).
- `partial` — at least one entry was `written` AND any of: `capped > 0`, `errors > 0`, fanout truncation fired (§6.4 returned 51), injected-ids truncation fired (§4.5.1 200-cap), or a mid-job DB error caused a subset of rows to fail at flush.
- `noop` — `written === 0` AND no error fired (e.g. flag off; classification was `none` for every entry; no eligible runs resolved; `injected_entry_ids` was null/empty for every run). Replaces the old "silent no-op" wording in Goal 3 — exactly one terminal info log is allowed per job invocation; no entry-level rows or events fire.
- `failed` — an unrecoverable error before flush completion. pg-boss handles retry per §10.2.

Status precedence (when multiple conditions apply): `failed > partial > success > noop`.

**Post-terminal prohibition (scoped).** Once the handler emits its terminal event for `(source, scorecardJudgementId | decisionId | runId)`, the handler does NOT emit further entry-level or run-level events with that correlation key. Subsequent flush activity is per-row and is folded into the terminal counts BEFORE the terminal event fires — see §4.6's "Flush ordering vs terminal event" note. The flusher's downstream operational logs (DB error, retry) are at the flusher's correlation key, not the handler's, and do not violate this rule.

### 10.5 No-silent-partial-success

`status: 'partial'` fires when:
- Any entry is dropped by the weekly cap (§4.3).
- Any entry returns a `23505` from flush (§4.6 per-row error handling) — counted as `idempotent` but combined with another failure mode the overall status is `partial`.
- Any entry surfaces a non-23505 flush error (§4.6) — counted as `errors`.
- §6.4 returned 51 rows (fanout truncated; see §6.4).
- A run exceeded the 200-entry cap (§4.5.1 injected-ids truncated).

`status: 'success'` requires every resolved entry written without truncation / drop / error AND at least one row written.

### 10.6 Unique-constraint → HTTP mapping

`memory_outcome_feedback_events` is job-only — no HTTP route. The unique constraint never produces an HTTP status. The handler catches `23505` per-row inside the flusher and counts it under `idempotent`. The handler's outer pg-boss surface never returns the error.

### 10.7 State machine closure

No new state machine. Outcome-feedback events are immutable point-in-time records — no transitions, no status field beyond `verdict` (which is closed: `pass | fail`, fixed at write time).

The `PromotionSignals` extension does not introduce new states either — it adds an additional input to an existing scoring function.

## 11. Observability

Six new structured log event types and the existing `memory.retrieved` extension (§6.5).

One new derived counter (NOT a separately emitted metric — derived by the existing structured-log → metrics pipeline from the `memory.outcome_feedback.applied` terminal events):
- `outcome_feedback_deltas_applied{org, subaccount, classification, source}` — derived from `counts.written` per terminal event.

Three new audit-script checks (§14):
- Outcome-feedback firing rate per eligible tenant per day.
- Per-tier delta-magnitude distribution.
- Saturated-block count per tenant per day.

No new dashboards in v1. Observability surface is structured-log-and-audit-script only.

## 12. Rollout & Rollback

**Flag:** reuses `MEMORY_CONSOLIDATION_TIER_ENABLED`. No new flag.

**Flag-off behaviour (three layers of defence):**
- Dispatchers in `scorecardJudgeJob`, `taskApprovalService`, and the rollback stub all check `getMemoryConsolidationTierEnabled()` at enqueue time. False → no `sendWithTx` call, no job enqueued, no rows. This is the primary gate.
- The handler (`memoryOutcomeFeedbackJob.ts`) re-checks the flag as step 1 of its flow (§4.5). False → emit a single `memory.outcome_feedback.applied` event with `status: 'noop', reason: 'flag_off'` and return without touching the DB. Defence against legacy queue contents post-flag-flip.
- `reinforcementBatch.recordOutcomeFeedback` early-returns when flag is false at buffer time. Defence against any path that bypasses the handler check.
- Net behaviour: with flag off from the start, behaviour is identical to pre-build. Zero rows written. Zero entry-level events. At most one terminal `noop` event per defensively-handled stale job.

**Rollback paths:**
- **Soft (config-deploy).** Set `signalWeights.outcomeFeedback = 0` in the active config and bump version to 3. Existing event-table rows stay (replay-friendly) but contribute zero to promotion. `MemoryConsolidationConfig` is loaded at startup (not runtime-mutable in this codebase as of 2026-05-19); soft rollback therefore requires a code deploy. Same shape as the tier-consolidation team's planned rollback for any individual signal.
- **Hard (flag flip).** Flip `MEMORY_CONSOLIDATION_TIER_ENABLED` to false. Disables outcome feedback AND the existing tier-consolidation behaviour together — same-flag coupling is the trade-off documented in the brief. Hard rollback does not require a deploy if the flag is environment-controlled; otherwise it is also deploy-coupled.

**Coupled-flag rollout note.** Reusing `MEMORY_CONSOLIDATION_TIER_ENABLED` means outcome feedback cannot be enabled independently of tier consolidation, and vice versa. This is the deliberate design (no new flag — see §3.7); the soft-rollback path above is the lever for partially disabling outcome feedback while keeping tier consolidation on.

The audit-script's existing 4-consecutive-pass gate on staging must absorb the new checks. Outcome feedback ships together with tier consolidation behaviour or not at all (same flag).

## 13. Determinism & Replayability

Four determinism contracts:

1. **Classification is pure.** `classifyOutcome(verdict, approvals, rollback)` is a pure function. Same input → same output across all runs.
2. **Delta is config-versioned at write time.** Every event row stores `config_version`. The recorded delta is the unweighted signed magnitude as configured at write time.
3. **Aggregation is config-active.** `evaluatePromotion` aggregates raw deltas over the active window and applies the **active** `signalWeights.outcomeFeedback`, not historical weights. Replay-by-historical-version requires selecting both the same `config_version` rows and applying the same historical weights — that's a one-line helper (`replayWithConfigVersion(events, configVersion)`) for the audit script; not in production code path.
4. **Cap check is deterministic.** Per-week cap and signal aggregation queries both use `$asOf - interval` rather than `now() - interval`. The handler passes `now()` in normal operation; the audit-script and dev fixtures pass pinned `asOf` for deterministic replay.

**Config-history compatibility.** v1 config entries (in `MEMORY_CONSOLIDATION_CONFIG_HISTORY`) lack `signalWeights.outcomeFeedback`, `outcomeFeedbackBaseDelta`, and `outcomeFeedbackWeeklyCap`. The signal-weights consumer applies a normalisation layer that defaults missing fields to `0`. Replaying v1 against the new four-signal evaluator produces v1 behaviour exactly (the new term contributes zero).

Weight rebalancing (v1 → v2) is intentional. The v1 weights (0.5 / 0.3 / 0.2) summed to 1.0; v2 keeps the sum at 1.0 by carving 0.2 out of the existing three signals proportionally — the relative ordering of the original three signals is preserved (reinforcement > recurrence > recency). Historical retrievals that ran against config v1 are not retroactively reweighted.

**Expected effect size.** With v2 defaults, one applied event contributes `delta × weight = 0.1 × 0.2 = 0.02` to `totalScore`. A saturating week's worth of negative events contributes up to `−1.0 × 0.2 = −0.2`. The v1 promotion threshold (unchanged in v2) is calibrated against signals that historically summed to ~1.0; a `−0.2` delta is a non-trivial but bounded influence. Worked example for one block over a single consolidation cycle:
- Prior `totalScore`: `0.5 × 0.4 + 0.3 × 0.25 + 0.2 × 0.15 = 0.305`.
- After one negative event: `0.5 × 0.4 + 0.3 × 0.25 + 0.2 × 0.15 + (−0.1) × 0.2 = 0.285`.
- After cap-saturating five negative events: `0.305 − 5 × 0.02 = 0.205`.

These magnitudes match the spec's goal: outcome feedback meaningfully influences promotion ordering without dominating it. The spec does NOT claim a specific threshold-crossing guarantee — Goal 1's "reduced relative to prior" is the criterion.

## 14. Audit-Script Extension

Three new checks appended to `scripts/audit/audit-memory-consolidation.ts`. Each returns `AuditCheckResult` (`{ checkName, status, findings, evidence }`) per the existing convention.

**Check 8 — Outcome-feedback firing rate per eligible tenant per day.**

The denominator is **eligible runs**, not all scorecard verdicts. A run is "eligible" if and only if all of the following hold:
- `agent_runs.injected_entry_ids IS NOT NULL AND jsonb_array_length(injected_entry_ids) > 0`
- A `scorecard_judgements` row exists with `verdict IN ('pass', 'fail')` (excludes `inconclusive`).
- The handler's flag (`MEMORY_CONSOLIDATION_TIER_ENABLED`) was on at the time of the verdict write (the audit script reads the flag-snapshot table; if unavailable, the check warns rather than fails).
- Classification per §4.1 would have been `positive` or `negative` (not `none`). The audit script reapplies §6.2's pure classifier against the row.

Verdicts:
- Pass: every tenant with ≥1 eligible run in the last 7 days has ≥1 `memory_outcome_feedback_events` row in the same window.
- Warn: a tenant has eligible runs but zero events (signal pipeline not connected; investigate dispatcher).
- Fail: any cross-tenant row leak — `entry_id` references a `workspace_memory_entries` row whose `organisation_id` does not match the event's `organisation_id`. (This is the defence-in-depth scan referenced from §5.1's tenant-consistency invariant.)

**Check 9 — Per-tier delta-magnitude distribution.**

Joins events to `workspace_memory_entries` to read tier:

```sql
SELECT e.tier_at_apply, percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(ev.delta)) AS median_delta
FROM memory_outcome_feedback_events ev
JOIN workspace_memory_entries e ON e.id = ev.entry_id
WHERE ev.applied_at >= now() - interval '7 days'
GROUP BY e.tier_at_apply;
```

Tier read: `workspace_memory_entries.tier` (current tier). Historical tier-at-apply is NOT stored in v1; if/when tier becomes audit-critical, add `tier_at_apply` to `memory_outcome_feedback_events` (deferred — see §18).

Verdicts:
- Pass: median `|delta|` per tier matches the configured base delta of the **most-recent config version observed in the window** (default 0.1 for v2; range `[0.05, 0.5]` is the v2 config bound).
- Warn: median outside the configured-base-delta range — likely a config-version-drift signal or an unexpected source mix.
- Fail: any delta with `ABS(delta) > 1.0` (impossible given the CHECK constraint; would indicate DB integrity bug).

Wording note: deltas are dropped (not clamped) at write time per §4.3. Stored magnitudes never exceed the configured base delta; Check 9's verdict tests the central tendency of *applied* magnitudes, not the cap.

**Check 10 — Saturated-block count per tenant per day.**

Saturated writes are dropped and therefore do NOT appear in `memory_outcome_feedback_events`. Check 10 reads the structured `memory.outcome_feedback.weekly_cap_saturated` log events (via the existing log-export path used by other audit checks; the audit script accepts a log-source path).

Verdicts:
- Pass: <1% of distinct entries-per-tenant-per-day saturate.
- Warn: 1–5% saturate.
- Fail: >5% saturate (signals adversarial input or cap misconfiguration).

**Check log-source caveat.** If the audit script's log-source path is unavailable in a given environment (e.g. a dev fixture without log export), Check 10 returns `skipped` rather than failing. The 4-consecutive-pass-on-staging gate (§12) reads `skipped` as neutral.

All three checks are pluggable into the existing 4-consecutive-pass-on-staging flag-flip gate.

## 15. Testing Posture

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`.

Vitest coverage limited to:

- `memoryOutcomeFeedbackServicePure.ts` — `classifyOutcome` truth-table (≥12 cases: every input combination from §6.2's exhaustive rule set, including the zero-approval `pass`-classifies-as-`none` case and the `every([]) === true` defence case), `computeDelta` (sign + scaling + boundary), `shouldDropForWeeklyCap` (boundary cases at `used + |delta| === cap`).
- `reinforcementBatch.ts` — new `recordOutcomeFeedback` buffer-accumulation tests; flusher per-row 23505 handling with mocked DB driver; flush-target SQL shape; flag-off early-return.
- `evaluatePromotion` — new fourth-term composition tests (existing tests must not regress); negative-totalScore threshold tests; missing-weight normalisation for v1-config-replay.
- Audit-script Check 8/9/10 verdict helpers — pure functions over fixture data, including the cross-tenant-leak fixture for Check 8 Fail.

No frontend, no API contract, no E2E.

**RLS coverage.** The new `memory_outcome_feedback_events` entry in `rlsProtectedTables.ts` triggers the existing `verify-rls-coverage.sh` CI gate, which scans the manifest and asserts every entry has a corresponding `*_isolation` policy. The cross-tenant RLS fuzz suite (`server/services/__tests__/rls.context-propagation.test.ts`) iterates the manifest at runtime; the new entry is automatically picked up. No new test file is needed — coverage is by inheritance, with the existing harness producing default-deny + cross-tenant probe coverage for the new table. If `verify-rls-coverage.sh` flags a gap on the new entry, that is a build blocker (closed by the harness, not by a new test file).

**Concurrency / cap-race / advisory-lock testing.** Per the framing assumption (`runtime_tests: pure_function_only`), end-to-end concurrency verification for the advisory lock + cap behaviour is NOT added in v1. The shape of the cap behaviour is covered by the `shouldDropForWeeklyCap` pure test against deterministic input; the SQL advisory-lock semantics are exercised by Postgres itself. Cap-race coverage at the DB-integration tier is in the "testing posture would shift if production traffic ever exercises this path" follow-up bucket — listed in §18.

## 16. Files in Scope (Inventory Lock)

**New source files (4):**
- `migrations/0XXX_memory_outcome_feedback_events.sql` — Chunk 1 (architect locks number at chunk-0)
- `server/services/memoryOutcomeFeedbackServicePure.ts` — Chunk 3
- `server/services/memoryOutcomeFeedbackService.ts` — Chunk 3
- `server/jobs/memoryOutcomeFeedbackJob.ts` — Chunk 5

**New test files (4):**
- `server/services/__tests__/memoryOutcomeFeedbackServicePure.test.ts` — Chunk 3
- `server/services/workspaceMemoryService/__tests__/reinforcementBatch.outcomeFeedback.test.ts` — Chunk 4
- `server/services/__tests__/evaluatePromotion.outcomeFeedback.test.ts` — Chunk 2 (extends existing test or new file; architect locks at chunk-0)
- `scripts/audit/__tests__/audit-memory-consolidation.outcomeFeedback.test.ts` — Chunk 8 (audit-check verdict-helper tests)

**Audit fixtures (new):**
- `scripts/audit/fixtures/memory-outcome-feedback/*.json` — fixture set referenced by Success Criterion 5 (Chunk 8)

**Modified files (12):**
- `shared/types/memoryConsolidation.ts` — extend `PromotionSignals`, `SignalWeights`, `MemoryConsolidationConfig` types; add normalisation helper — Chunk 2
- `server/config/memoryConsolidationConfig.ts` — append v2 history entry, bump active version, add `outcomeFeedbackBaseDelta`, `outcomeFeedbackWeeklyCap` defaults — Chunk 2
- `server/services/memoryBlockSynthesisService.ts` — extend `evaluatePromotion` totalScore; add batched signal-population query (`populatePromotionSignals`) — Chunk 2
- `server/services/workspaceMemoryService/reinforcementBatch.ts` — add `recordOutcomeFeedback` buffer, per-row 23505 handling, distinct flush target, synchronous-flush hook — Chunk 4
- `server/services/workspaceMemoryService/index.ts` (or wherever `memory.retrieved` is emitted today — architect verifies at chunk-0) — extend payload with `lastOutcomeFeedbackAt`, `lastOutcomeFeedbackClassification` — Chunk 4
- `server/config/jobConfig.ts` — add `'memory:outcome-feedback'` entry; declare retry / backoff / DLQ defaults from existing job-config defaults (§10 retry classification table) — Chunk 5
- `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` — register worker — Chunk 5
- `server/services/queueService/sendWithTx.ts` (if a new payload type needs to be allowed) — Chunk 5
- `server/jobs/scorecardJudgeJob.ts` — add subordinate dispatch inside verdict-write tx; cite singleton key (§10.1) — Chunk 6
- `server/services/taskApprovalService.ts` — wrap decision-write in tx, add subordinate dispatch, allocate `decisionId` (§3.5) — Chunk 7
- `server/config/rlsProtectedTables.ts` — append `memory_outcome_feedback_events` entry with `policyMigration: '0XXX_memory_outcome_feedback_events.sql'` (number locked at chunk-0) — Chunk 1
- `scripts/audit/audit-memory-consolidation.ts` — append Check 8, 9, 10 verdict helpers; thread log-source path — Chunk 8

**Stub-only modification (1):**
- `server/services/workspaceSnapshotService.ts` (or equivalent rollback owner — architect verifies at chunk-0) — add stubbed dispatch with `// TODO(task-preview-mode)` marker — Chunk 9

**Numeric count reconciliation:** 4 new source files + 4 new test files + 12 modified files + 1 stubbed + 1 audit-fixture directory = **21 file touches** plus 1 new migration. 1 new job type. 1 new table. 1 new field on `PromotionSignals` and 1 new field on `SignalWeights`. 0 new HTTP routes. 0 new flags. 0 new permission keys. Reconciled against §5 (data model) and §9 (chunk plan). The chunk-0 step (architect plan.md) locks: (a) the migration number; (b) the exact file that emits `memory.retrieved` today; (c) the exact rollback-owner file for Chunk 9.

## 17. Success Criteria

1. A memory block injected into a scorecard-`fail` run with at least one rejected approval has its `evaluatePromotion` `totalScore` reduced on the next consolidation cycle relative to its prior score, all other signals held constant. **Verifiable:** before/after `totalScore` comparison in a Vitest fixture.
2. A memory block injected into a scorecard-`pass` run with all-approve approvals (≥1) and no rollback has its `totalScore` raised beyond the prior signal weights' contribution. **Verifiable:** same fixture, opposite sign.
3. Per-block per-week cap holds against pure-classifier fuzz. **Verifiable:** Vitest property test — generate N events against the pure `shouldDropForWeeklyCap` helper using a synthetic `usedMagnitude` accumulator, assert `SUM(|written|) <= weeklyCap`. (End-to-end DB concurrency under racing handlers is enforced by the advisory lock in §4.3, not a runtime test — see §15.)
4. Tenant isolation invariants hold. **Verifiable:** the existing `verify-rls-coverage.sh` gate passes against the new `rlsProtectedTables.ts` entry; `rls.context-propagation.test.ts` default-deny / cross-tenant probe coverage extends to the new table by manifest inheritance; audit-script Check 8 Fail branch (cross-tenant leak detector) passes the seeded fixture.
5. Audit-script Check 8, 9, 10 pass against a seeded fixture set. **Verifiable:** dedicated fixture under `scripts/audit/fixtures/` covering eligible-vs-ineligible runs, multi-version events, and a log-source fixture for Check 10.
6. Replayability: same config version + same event stream + same `asOf` produces same final scores. **Verifiable:** Vitest snapshot test — apply event list twice against the pure aggregator with a pinned `asOf`, assert `totalScore` identical.
7. Flag-off behaviour: dispatchers do not enqueue, handler defensively early-returns, `recordOutcomeFeedback` defensively early-returns, no rows are mutated. **Verifiable:** Vitest test trio with mock `getMemoryConsolidationTierEnabled` returning false at each layer (dispatcher, handler, reinforcement-batch); assert zero DB writes and zero terminal events from the dispatch layer (the handler layer, if reached defensively, emits a `noop` terminal event per §10.4).
8. Negative `totalScore` does not erroneously promote. **Verifiable:** Vitest fixture seeded with negative `outcomeFeedback` summing below the promotion threshold; assert no promotion.

## 18. Deferred Items

- **Per-block causal attribution within a run.** v1 attributes coarsely to the full set of blocks in `agent_runs.injected_entry_ids`. Per-block attribution (which specific block within a run contributed to the outcome) requires either an instrumented prompt-construction trace or an LLM-judged attribution pass. Deferred to v2 once the volume of `inconclusive` verdicts (a proxy for "we should have been more precise") justifies the cost.
- **Per-artefact attribution within a task on the approval path.** v1 attributes coarsely to all eligible runs for the task; v2 would add an `agent_runs.artefact_id` column (or equivalent join) so approval decisions can target the specific run that produced the artefact.
- **Operator-facing "recently penalised" UI.** Memory inspector that surfaces `lastOutcomeFeedbackAt` + `lastOutcomeFeedbackClassification`, ideally enriched with `netOutcomeFeedback`, `lastDelta`, and `lastSource`. Deferred to a follow-up build; not gated by this spec.
- **Rollback wiring.** `workspaceSnapshotService` (or equivalent rollback owner) dispatch site is stubbed in Chunk 9. Activated when `task-preview-mode` ships and rollback events become real; that spec will define the rollback-state source-of-truth that `rollbackFiredForRun` reads from.
- **`tier_at_apply` column on events table.** v1 uses current tier from `workspace_memory_entries` for Check 9's per-tier distribution. If historical accuracy matters, add a `tier_at_apply` column that snapshots the entry's tier at write time. Deferred — current tier is sufficient for the audit's intended use.
- **DB-integration tests for advisory-lock cap behaviour and per-row 23505 handling.** Out of scope per `runtime_tests: pure_function_only` (`docs/spec-context.md`). If/when the framing assumption changes (live users / production load), these tests become first-class additions.
- **Composite-FK tenant-consistency enforcement.** v1 relies on RLS + service-layer enforcement + Check 8 defence-in-depth. Composite foreign keys (`(entry_id, organisation_id, subaccount_id)`) would close the SQL-layer gap but require schema changes on `workspace_memory_entries` and `agent_runs`. Deferred — out of scope for a v1 signal build.
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
