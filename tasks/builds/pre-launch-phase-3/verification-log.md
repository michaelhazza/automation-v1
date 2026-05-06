# Pre-Launch Phase 3 — Verification Log

**Date:** 2026-05-05
**Purpose:** Spec-authoring checklist §0 evidence. Records the present-state verdict for every deferred item cited in the spec, before the spec is sent to `spec-reviewer`.

The point of this log is to refuse to re-litigate items already closed by surrounding work, and to give the spec-reviewer evidence rather than assertions.

---

## Items verified

### Verified open — included in spec scope

#### Webhook fail-open on missing `WEBHOOK_SECRET`

- **Source citation:** `tasks/todo.md:47` (Audit Summary item 22).
- **Evidence:** Read `server/services/webhookService.ts:77-88` on 2026-05-05. Current code:

  ```ts
  verifyCallbackToken(executionId: string, token?: string, engineHmacSecret?: string): boolean {
    const secret = engineHmacSecret ?? env.WEBHOOK_SECRET;
    if (!secret) {
      if (!webhookOpenModeWarned) {
        webhookOpenModeWarned = true;
        logger.warn('webhook.open_mode_active', { ... });
      }
      return true;
    }
    ...
  }
  ```

- **Verdict:** open. Spec scope item L1.

#### AR-2.2 — `requireSubaccountPermission` no security event emit

- **Source citation:** `tasks/todo.md:3069-3071`.
- **Evidence:** Read `server/middleware/auth.ts:355-400` on 2026-05-05. The 403 branch returns immediately with `res.status(403).json({ error: 'Forbidden' })` and no call to `recordSecurityEvent`. Compare with `requireOrgPermission` lines 322-335 which records the event.
- **Verdict:** open. Spec scope item L2.

#### AR-5.1 — Login rate-limit per-email bucket

- **Source citation:** `tasks/todo.md:3059-3061`.
- **Evidence:** Read `server/lib/rateLimitKeys.ts:21-28` on 2026-05-05. Current builders:

  ```ts
  authLogin: (ip, email) => `rl:v1:auth:login:short:${ip}:${email.toLowerCase()}`,
  authLoginLong: (ip, email) => `rl:v1:auth:login:long:${ip}:${email.toLowerCase()}`,
  ```

  Both key on `${ip}:${email}`. No standalone `email`-only bucket exists.
- **Verdict:** open. Spec scope item L3.

#### F2b — `measureInterventionOutcomeJob` idempotency invariant

- **Source citation:** `tasks/todo.md:1585`.
- **Evidence:** The deferral itself documents the gap: comment in place, no test asserting the invariant. No automated test was found at `server/jobs/__tests__/measureInterventionOutcomeJob*.test.ts`.
- **Verdict:** open. Spec scope item L4.

#### DG-6 — Optimiser cost-gate not measured

- **Source citation:** `tasks/todo.md:2407`.
- **Evidence:** Read `server/services/optimiser/__tests__/verificationMatrix.test.ts:836-840` on 2026-05-05. The describe block is `.skip`. `tasks/builds/stream-2-optimiser-finish/progress.md` records "Integration cost gate (<$0.02/subaccount/day) deferred to CI with live DB + LLM access." No CI workflow targets the measurement.
- **Verdict:** open. Spec scope item L5.

---

### Verified closed — dropped from scope, hygiene marker only

#### Hermes §6.8 — errorMessage gap on normal-path failed runs

- **Source citation:** `tasks/todo.md:68-81`.
- **Evidence:** Re-read on 2026-05-05 against the present working tree:
  - `server/services/agentExecutionService.ts:1836-1840` (HERMES-S1 inline comment) already threads `preFinalizeRow.errorMessage` into `extractionOutcome.errorMessage` when `derivedRunResultStatus === 'failed'`.
  - `server/services/workspaceMemoryService.ts:731-742` already consumes `outcome.errorMessage` via `hasStructuredError`, allowing extraction to proceed on short-summary failed runs when a structured error is present.
  - The original triage cited `agentExecutionService.ts:1350-1368`, which now contains session-linking logic. The line citation was stale; the implementation citation was wrong.
- **Verdict:** closed by HERMES-S1 prior commit.
- **Action:** spec scope item H3 — flip the `tasks/todo.md` marker. No code change.

#### `ghlOAuthStateStore` process-local Map

- **Original triage citation:** "tasks/todo.md:2576" (referenced as `server/lib/ghlOAuthStateStore.ts`).
- **Evidence:** `server/lib/ghlOAuthStateStore.ts` does not exist. The actual file at `server/services/ghlOAuthStateStore.ts` is DB-backed: it inserts/deletes against `oauth_state_nonces` (migration 0277). Source — `server/services/ghlOAuthStateStore.ts:7-35` shows `db.insert(oauthStateNonces)...` and `db.delete(oauthStateNonces)...returning(...)`. The triage memory was stale; the durable store landed in PR #261 (S-P0-1).
- **Verdict:** closed by migration 0277 + S-P0-1 wiring.
- **Action:** none. No `tasks/todo.md` marker existed for this triage memory; no hygiene action needed.

#### AC-ADV-10 — `agent_charges.spending_budget_id` missing FK

- **Original triage citation:** `tasks/todo.md:2701`.
- **Evidence:** Read `migrations/0271_agentic_commerce_schema.sql` line 200 on 2026-05-05:

  ```sql
  spending_budget_id UUID NOT NULL REFERENCES spending_budgets(id),
  ```

  Drizzle declaration confirms at `server/db/schema/agentCharges.ts:60-61`: `.references(() => spendingBudgets.id)`.
- **Verdict:** closed by migration 0271 itself.
- **Action:** none required by this spec — the deferred-item entry can be removed in a future cleanup pass; not blocking for launch.

#### D15 — `verify-workspace-actor-coverage.ts` not wired to CI

- **Original triage citation:** `tasks/todo.md:1723`.
- **Evidence:** `.github/workflows/workspace-actor-coverage.yml` exists and runs `npx tsx scripts/verify-workspace-actor-coverage.ts` on every `pull_request` and every `push` to `main`. Workflow has Postgres service container with migrations applied before the verify script runs.
- **Verdict:** closed by the workflow file.
- **Action:** none required by this spec.

#### Audit Summary item 21 — In-memory rate limiting

- **Original citation:** `tasks/todo.md:46` carries `[OPEN — pre-prod-boundary-and-brief-api Phase 2]`.
- **Evidence:** `server/lib/inboundRateLimiter.ts` is the canonical DB-backed sliding-window primitive. `rate_limit_buckets` table exists. The marker is bookkeeping debt from pre-prod-boundary Phase 2 closing.
- **Verdict:** closed.
- **Action:** spec scope item H1 — update the marker.

#### Audit Summary item 24 — Multer 500MB OOM

- **Original citation:** `tasks/todo.md:49` carries `[OPEN — pre-prod-boundary-and-brief-api Phase 1]`.
- **Evidence:** `server/middleware/validate.ts:21` declares the 25MB cap (S-P0-8 from PR #261). The marker is bookkeeping debt.
- **Verdict:** closed.
- **Action:** spec scope item H1 — update the marker.

#### REQ 14b-extra — `workflow_drafts` subaccount scope

- **Original citation:** `tasks/todo.md:2844`.
- **Evidence:** `server/routes/workflowDrafts.ts:38-51` performs the `resolveSubaccount` scope check. The marker is bookkeeping debt from workflows-v1-phase-2 closing.
- **Verdict:** closed.
- **Action:** spec scope item H2 — update the marker.

---

## Summary

- 5 items verified open → in spec scope (L1–L5).
- 3 items verified closed by surrounding work → dropped from scope, no marker action needed.
- 4 items verified closed but with stale markers in `tasks/todo.md` → spec scope items H1 / H2 / H3 (marker fixes). Hermes §6.8 moved here on second-pass review when the original triage citation (`agentExecutionService.ts:1350-1368`) was found to be stale and the actual fix was already in place at `:1836-1840` plus `workspaceMemoryService.ts:731-742`.
- 1 forward-looking documentation action (H4) — operator runbook for conditional triggers.

This log is the input to `spec-reviewer`. Any finding that re-litigates an item marked `verified closed` here should be classified as a directional finding pending HITL.
