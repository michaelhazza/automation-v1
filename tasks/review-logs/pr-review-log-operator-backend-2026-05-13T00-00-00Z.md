# PR Review Log — operator-backend

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**Slug:** `operator-backend`
**Reviewer:** pr-reviewer (sub-agent)
**Timestamp:** 2026-05-13T00:00:00Z
**HEAD at review:** `85e07167`
**Verdict:** CHANGES_REQUESTED (4 blocking, 3 high, 2 medium, 2 low)

---

## Blocking Issues

### B1. `extend-budget` route mutates SUBACCOUNT-WIDE settings to fulfil a PER-TASK action (cross-task contamination)

**File:** `server/routes/operatorTasks.ts:189-200`

`POST /api/operator-tasks/:agentRunId/extend-budget` is documented (and audit-logged) as a per-task budget extension. The implementation instead calls `subaccountOperatorSettingsService.updateSettings({...per_task_budget_cap_minutes: currentSettings.per_task_budget_cap_minutes + extensionMinutes...})`, which writes the increased cap to `subaccount_operator_settings` — a SINGLE row per subaccount that the dispatcher reads at line 212 via `getEffectiveSettings(orgId, subaccountId)` for EVERY new chain link in that subaccount.

Consequence: User extends Task A by +1000 min → the entire subaccount's `per_task_budget_cap_minutes` grows by 1000. All other tasks in the same subaccount, including future bootstraps, capture the elevated cap in their next dispatch's `settings_snapshot`. The cap drifts upward permanently with every per-task extension.

Spec contradiction: §3.17.4 — `new_cap = old_cap + extension_minutes` is a per-task additive. The cap source of truth for enforcement is `operator_runs.settings_snapshot` (§3.16 — "Most caps are enforced from `operator_runs.settings_snapshot`").

**Recommended fix:** Add `agent_runs.per_task_budget_extension_minutes integer NOT NULL DEFAULT 0` column. Dispatcher composes `settings_snapshot.per_task_budget_cap_minutes = effectiveSettings.per_task_budget_cap_minutes + run.per_task_budget_extension_minutes` for new chain links. Route increments that column (not `subaccount_operator_settings`).

---

### B2. Dispatcher's reads of `operator_runs` are bare `db.select` outside any transaction → dual-GUC RLS fails closed

**File:** `server/services/executionBackends/operatorManagedBackend.ts:234-253`

The dispatch sequence reads operator_runs to derive `currentAttemptNumber` and `chainSeqNext`:

```
const latestAttemptRow = await db.select({...}).from(operatorRuns)... // L234
const existingLinks    = await db.select({...}).from(operatorRuns)... // L244
```

`operator_runs` carries `FORCE ROW LEVEL SECURITY` keyed on BOTH `app.organisation_id` AND `app.subaccount_id`. Bare `db.select(...)` outside any `db.transaction(...)` checks out a fresh pool connection on which neither GUC has been set → 0 rows returned.

Net effect: `currentAttemptNumber` defaults to `1` and `chainSeqNext` defaults to `1` on EVERY dispatch — including continuation dispatches. Every chain link is written with `chain_seq=1, attempt_number=1`. The `(agent_run_id, attempt_number, chain_seq)` UNIQUE index fails on the second link. Chain mechanism is non-functional.

**Recommended fix:** Wrap both reads in `db.transaction(async tx => { await setOrgAndSubaccountGUC(tx, organisationId, subaccountId); ... })` and read via `tx.select`.

---

### B3. Dispatcher's `db.update(agentRuns)` writes are bare and have no GUC → "race lost" path triggers on every dispatch

**File:** `server/services/executionBackends/operatorManagedBackend.ts:346-354, 433-446`

Two writes to the RLS-protected `agent_runs` table happen outside any transaction:

- L346-354: orphan path — sets `agent_runs.status='failed'` when no credential available.
- L433-446: dispatch success path — optimistic `paused_* → delegated` transition (the Rev 2 sole-writer site).

`agent_runs` requires `app.organisation_id` to be set; FORCE RLS rejects writes from a pool connection with no GUC. The bare `db.update(...)` returns `updated.length === 0` even when the row is in the correct predecessor state. The dispatch then interprets that 0-rows result as "race lost" and marks the operator_run row as orphaned every time.

**Recommended fix:** Both writes must run inside `db.transaction(async tx => { await setOrgGUC(tx, organisationId); await tx.update(agentRuns)... })`. Same pattern already exists in `cancel()` at L940-952.

---

### B4. `finalise` parent UPDATE has no status predicate → late finaliser can overwrite a terminal parent

**File:** `server/services/executionBackends/operatorManagedBackend.ts:729-736`

```
await tx.update(agentRuns)
  .set({ status: sql`${parentTerminalStatus}`, ... })
  .where(eq(agentRuns.id, row.agentRunId));   // no status predicate
```

Dead branch at L636-642 attempts to guard this case but uses an unreachable condition: ANDs `parentRun.status ∈ terminal` with `terminalState.eventEmittedAt !== null`, yet L614 already short-circuits when `eventEmittedAt !== null`. The already-terminal early-return never fires.

Consequence: late finalise (after cancel or reconcile already finished it) overwrites the parent's terminal status. Cost-row writes and continuation enqueues fire post-commit with incoherent parent status.

**Recommended fix:**
1. Fix dead branch: drop `&& eventEmittedAt !== null` clause so early-return for already-terminal parents runs.
2. Add status predicate to parent UPDATE: `.where(and(eq(agentRuns.id, ...), notInArray(agentRuns.status, TERMINAL_STATUSES)))`.
3. If `.returning()` yields 0 rows, suppress post-commit cost write and continuation enqueue.

---

## High Severity

### H1. Cancel-path predicate too permissive (`!= 'cancelled'`) → can overwrite `completed` / `failed`

**File:** `server/services/executionBackends/operatorManagedBackend.ts:940-952`

Spec §3.10 step 3 mandates the closed predecessor set: `WHERE id = $1 AND status IN ('delegated','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded','paused_wall_clock_exceeded','pending')`.

Implementation uses `status != 'cancelled'`, permitting cancellation of a row in `completed`, `failed`, `timeout`, `budget_exceeded`, etc.

**Fix:** use exact predicate from spec §3.10 step 3; return 409 `OperatorBackendConflictError` when 0 rows affected.

---

### H2. Routes access `db` directly — architecture rule violation

**Files:** `server/routes/operatorTasks.ts:55, 108, 268`; `server/routes/operatorSessions.ts:40`

Architecture rule: "Routes call services only — never access `db` directly in a route." Operator routes import `db` and run `db.select`/`db.update` directly. SQL should move to services.

---

### H3. `_extractIsResumableNow` runs against an encrypted blob → always returns false

**File:** `server/services/executionBackends/operatorManagedBackend.ts:142-146, 683-687`

Column is encrypted at rest (`agentRunPayloadEncryptionService`). Non-null on-row shape: `{ _encrypted: true, v: "k1:iv:tag:ciphertext" }` — no top-level `is_resumable_now` key. Function returns `false` always for non-null payloads. V1 writes no checkpoint_payload yet so latent; will fail at ingestion pipeline launch.

**Fix:** decrypt before reading. Move check to `operatorChainResumeService` which has the decrypt helper.

---

## Medium Severity

### M1. Dead branch makes finalise race-guard non-functional (causal twin of B4)

Separate callout: the intent of the comment ("Already-terminal parent: check race-loser") is correct and worth restoring — drop `&& terminalState.eventEmittedAt !== null` clause.

### M2. `extend-budget` audit event misrepresents impact

`task.operator.budget_extended` emitted but actual mutation is subaccount-wide settings PATCH. No `subaccount.operator_settings.updated` audit event emitted. Downstream of B1 — resolves when B1 is fixed.

---

## Low Severity

### L1. `is_resumable_now` field has no pure test pinning the contract

**File:** `server/services/executionBackends/operatorManagedBackend.ts:21-23, 138-146`

Add placeholder pure tests for `{ is_resumable_now: true }` and `{ is_resumable_now: false }` plaintext payloads.

### L2. `extendBudgetBodySchema` does not enforce 60-minute step

**File:** `server/routes/operatorTasks.ts:142-144`

Spec §3.17.4: "60-min step per mockup". Server accepts any integer in [60, 60000]. Add `.refine(n => n % 60 === 0)`.

---

## Status

Fix-loop in progress. Blocking items B1, B2, B3, B4 and H1 to be addressed before re-review.
