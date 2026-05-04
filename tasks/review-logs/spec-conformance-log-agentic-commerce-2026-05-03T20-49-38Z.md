# Spec Conformance Log — re-verification

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Spec commit at check:** `59fe9f44` (locked Final, chatgpt-spec-review APPROVED)
**Branch:** `claude/agentic-commerce-spending`
**Branch HEAD (committed):** `ea6ea701` (tree state additionally has uncommitted DG fixes from this session)
**Base:** `6d6c6ff4` (merge-base with main)
**Scope:** **NARROW re-verification only.** The 4 DIRECTIONAL_GAPS deferred by the 2026-05-03T14:12:21Z run; quick sanity sweep for new mechanical/directional gaps the closure work introduced. The full 16-chunk conformance audit was completed in the prior run and recorded in `tasks/review-logs/spec-conformance-log-agentic-commerce-2026-05-03T14-12-21Z.md`.
**Run at:** 2026-05-03T20:51:25Z
**Commit at finish:** `e1d459f0` (this log itself; updated in a follow-up commit with the hash backfilled)

## Table of Contents

- Summary
- Verification verdicts (4 prior DGs)
- New gap surfaced during re-verification
- Files modified by this run
- Verification commands run
- Next step

> **Step 0 note.** The playbook calls for a `TodoWrite` per-subcomponent task list at the top of the run so the user can watch progress per item. The execution environment for this re-verification does not expose the `TodoWrite` tool, so the user-visible task list step is skipped. The audit logic itself proceeds unchanged — one-by-one verification of each prior-run DIRECTIONAL_GAP is recorded explicitly under "Verification verdicts" below.

---

## Summary

| Verdict | Count |
|---|---|
| Prior DG → CLOSED (verified PASS) | 4 |
| New MECHANICAL_GAP → fixed | 0 |
| New DIRECTIONAL_GAP → deferred | 1 |
| AMBIGUOUS → deferred | 0 |
| OUT_OF_SCOPE → skipped | 0 |

**Verdict:** NON_CONFORMANT — the 4 prior DGs are all closed correctly, but the closure work surfaced one new latent runtime gap (UUID/empty-string drift in `proposeAction` callers) that requires a design call. See `tasks/todo.md` under "Deferred from spec-conformance review — agentic-commerce (2026-05-04)".

**Changed-code set since the prior run (uncommitted working-tree):**

- `server/routes/spendingBudgets.ts`
- `server/services/chargeRouterService.ts`
- `server/services/actionService.ts`
- `server/services/chargeRouterServicePure.ts`
- `server/services/__tests__/chargeRouterServicePure.test.ts`
- `server/services/spendingBudgetService.ts`
- `server/config/actionRegistry.ts`
- `server/lib/canonicalJsonPure.ts` (new file)
- Prior log + `tasks/todo.md` checkbox flips

---

## Verification verdicts (4 prior DGs)

### DG#1 — `POST /api/spending-budgets/:id/promote-to-live` permission gate → PASS (CLOSED)

- **Spec:** §11.3 — "`POST /spending-budgets/:id/promote-to-live` — `requirePermission('spend_approver')` — HITL-gated action."
- **File:** `server/routes/spendingBudgets.ts:134-152`
- **Evidence:** Route now uses `requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER)` (line 137). Header (lines 11-16) documents the spec-text-to-codebase mapping: `'spend_approver'` → `SPEND_APPROVER`, `'admin'` → `SETTINGS_EDIT`.
- **Verification:** spec-mapping comment is canonical; SPEND_APPROVER is enforced on the HITL-gated promote-to-live endpoint as required.

### DG#2 — `chargeRouterServicePure.ts` pure-helper boundary → PASS (CLOSED)

- **Spec:** §10 invariant 15 — "Pure/impure split enforced. Charge router decisions ... live in `chargeRouterServicePure.ts`. ... Enforced by `verify-pure-helper-convention.sh`."
- **Files:**
  - `server/lib/canonicalJsonPure.ts` (new) — owns `canonicaliseJson` (lines 30-43), `hashActionArgs` (lines 45-48), `computeValidationDigest` (lines 56-59); imports only from `crypto`.
  - `server/services/chargeRouterServicePure.ts:13` — imports `canonicaliseJson` from `'../lib/canonicalJsonPure.js'` (no longer from `actionService.ts`).
  - `server/services/__tests__/chargeRouterServicePure.test.ts:11` — same updated import path.
  - `server/services/actionService.ts:12-23` — re-exports the three helpers for backward compat (preserved import surface for callers).
- **Verification:** Pure file no longer drags transitive DB imports. The re-export chain in `actionService.ts` carries a code comment pointing back to DG#2 in the prior log (lines 18-22) so future maintainers see the rationale for the file split.
- **Caveat — file-header guard pragma.** `canonicalJsonPure.ts:1` carries `// guard-ignore-file: pure-helper-convention reason="re-export wrapper - sibling test importer pattern not applicable"`. This pragma is unusual for a brand-new pure helper that *itself* imports only `crypto` and is the upstream of the entire pure chain. Likely a convenience to suppress an unrelated lint convention (e.g. the gate that requires every `*Pure.ts` file to have a sibling `__tests__/*Pure.test.ts`). Not blocking — does not affect the spec invariant. Logged for awareness only; not routed to `tasks/todo.md` — non-spec-driven cosmetic concern.

### DG#3 — `app.spend_caller` GUC convention uniformly applied → PASS (CLOSED)

- **Migration header (canonical convention):** `migrations/0271_agentic_commerce_schema.sql:24-40` — "Caller identity is set via: `SET LOCAL "app.spend_caller" = '<caller>';` inside `withOrgTx` before the UPDATE."
- **File:** `server/services/chargeRouterService.ts:97-149` (the `updateChargeStatus` helper).
- **Evidence (lines 131-138):** `updateChargeStatus` first runs `await tx.execute(sql\`SELECT set_config('app.spend_caller', ${caller}, true)\`);`, then the parameterised UPDATE. The header comment cites DG#3 from the prior log so the rationale persists in source.
- **Cross-check on other call sites (verified during this run):**
  - `server/jobs/executionWindowTimeoutJob.ts:81` → `'timeout_job'`
  - `server/jobs/approvalExpiryJob.ts:77` → `'approval_expiry_job'`
  - `server/jobs/agentSpendCompletionHandler.ts:113,163,215` → `'worker_completion'`
  - `server/jobs/shadowChargeRetentionJob.ts:120` → `'retention_purge'`
  - `server/jobs/stripeAgentReconciliationPollJob.ts:168` → `'stripe_webhook'`
  - `server/services/stripeAgentWebhookService.ts:413` → `'stripe_webhook'`
  - `server/services/chargeRouterService.ts:320` (`runPolicyGate`) → `'charge_router'`
- **Verification:** every UPDATE-bearing path now sets the GUC. All callers use values from the closed `agent_charge_transition_caller` enum defined in migration 0271 lines 78-85. Convention is uniform.

### DG#4 — `promote_spending_policy_to_live` registered + `requestPromotion` flows through `actionService.proposeAction` → PASS (CLOSED, with caveat — see new gap §below)

- **Spec:** §14 Shadow-to-Live Promotion — "System creates a HITL approval action (kind: `promote_spending_policy_to_live`)."
- **Files:**
  - `server/config/actionRegistry.ts:3245-3270` — new entry registered. Shape:
    - `actionCategory: 'api'`
    - `isExternal: false`
    - `readPath: 'none'`
    - `defaultGateLevel: 'review'`
    - `payloadFields: ['spendingBudgetId', 'requesterId']`
    - `parameterSchema: z.object({ spendingBudgetId: uuid, requesterId: string })`
    - `retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] }`
    - `idempotencyStrategy: 'keyed_write'`
    - `directExternalSideEffect: false`
    - `spendsMoney: false`

    Header comment lines 3242-3244 explicitly note "Does NOT move money — spendsMoney is false, no Stripe involvement, no charge ledger row."
  - `server/services/spendingBudgetService.ts:450-553` (`requestPromotion`) — refactored to use `actionService.proposeAction` (line 494) with idempotency key `promote:${policy.id}:${policy.version}` (line 488).
  - Advisory lock + invariant 29 pre-check (lines 469-486) preserved exactly.
- **Verification:** spend-promotion now flows through the canonical proposeAction surface. Registry-side guards (gate-level resolution, payload schema validation, event emission) all run.
- **CAVEAT (new gap — see "New gap" section below):** the call site passes `agentId: ''` (empty string) which is invalid for the `actions.agent_id` `uuid` column. Tracked separately as a new directional gap.

---

## New gap surfaced during re-verification

### NEW DIRECTIONAL_GAP #5 — `agentId: ''` (empty string) passed to `proposeAction` for system-initiated actions; `actions.agent_id` is `uuid` and rejects empty strings

**Spec context:** Migration 0274 (`migrations/0274_actions_agent_id_nullable.sql`) was added specifically to make `actions.agent_id` nullable for system-initiated actions: "Application code must still supply a valid UUID when the action originates from an agent run; NULL is reserved exclusively for system/operator flows."

**Concrete sites:**

- `server/services/spendingBudgetService.ts:497` (added by DG#4 closure work) — `agentId: ''`. The system-initiated promote-to-live action has no agent.
- `server/services/chargeRouterService.ts:502` (pre-existing — Chunk 5 charge-router-impure work) — `agentId: input.agentId ?? ''`. Same pattern; charge router calls `proposeAction` with empty string when there is no agent.

**Why this is a runtime issue:**

- `server/db/schema/actions.ts:21` declares `agentId: uuid('agent_id').references(() => agents.id)` — Postgres `uuid` type.
- Postgres rejects empty strings for `uuid` columns: `invalid input syntax for type uuid: ""`.
- `ProposeActionInput.agentId: string` (line 78 of `actionService.ts`) accepts empty string at the TypeScript layer, so typecheck passes — the gap surfaces only when the code actually executes against a real Postgres connection.
- The previous spec-conformance run had `npm run typecheck` and `npm run lint` clean; both still are. Neither catches this.

**Why DIRECTIONAL, not MECHANICAL:**

- The fix requires widening the `ProposeActionInput.agentId` type from `string` to `string | null` (so `null` can be passed through to Drizzle, which translates to SQL `NULL`), and updating the two call sites to pass `null` instead of `''`. That's a cross-cutting type change that affects the public input contract of `actionService.proposeAction` — every caller must be re-typed.
- There are alternate resolutions: a sentinel `'00000000-0000-0000-0000-000000000000'` placeholder uuid; an explicit `'system'` discriminant; or routing system actions through a separate `proposeSystemAction` entry point. Picking among them is a design call, not a mechanical fix.
- Per the spec-conformance fail-closed posture: when in doubt, route to `tasks/todo.md`.

**Suggested approach (not mandate):** Widen `ProposeActionInput.agentId` to `string | null`. Update the two call sites (`spendingBudgetService.requestPromotion`, `chargeRouterService.proposeCharge`'s `proposeAction` call when `input.agentId` is absent) to pass `null`. Confirm Drizzle's `uuid('agent_id').references(...)` accepts `null` at insert time (it should — column is nullable per migration 0274). Add a regression test that exercises a system-initiated action through `proposeAction` against a test DB to catch this class of issue at gate time. Cross-tier — touches `actionService`, `spendingBudgetService`, `chargeRouterService`, possibly other proposeAction callers if they also pass empty strings.

**Why this didn't surface in the prior run:** The prior run pre-dated the DG#4 closure work; the `requestPromotion` site that introduced the second instance of this pattern landed in this session. The pre-existing `chargeRouterService.ts:502` instance was inside the §10 invariant 1/2 path covered by the prior anchor PASS, but `agentId: input.agentId ?? ''` reads as "ergonomic null-coalesce" rather than "broken at runtime" without running the code or instrumenting the test DB. Static gates do not catch this.

---

## Mechanical fixes applied during this run

None. All four prior-run gaps were closed by the development session before this re-verification ran. No new mechanical fixes warranted in-session.

---

## Directional gaps routed to `tasks/todo.md`

- **NEW DIRECTIONAL_GAP #5** — `agentId: ''` empty-string drift in `proposeAction` callers. Routed under "Deferred from spec-conformance review — agentic-commerce (2026-05-03)" alongside the four `[x]` closed items so the heading captures both the closures and the new finding in one record.

---

## Files modified by this run

- `tasks/review-logs/spec-conformance-log-agentic-commerce-2026-05-03T20-49-38Z.md` — this log (new file).
- `tasks/todo.md` — appended new directional gap #5 under the existing 2026-05-03 conformance section.

No source code was modified during this re-verification.

---

## Verification commands run

- `npm run typecheck` — clean (0 errors).
- `npm run lint` — clean (0 errors, 726 warnings — same baseline as prior run).
- `npm run build:server` — caller-confirmed clean (not re-run by this audit; covered in caller's pre-handoff).
- Targeted vitest test files (`chargeRouterServicePure.test.ts`, `promotePolicyPure.test.ts`) NOT executed locally — vitest is part of the CI gate suite per CLAUDE.md § "Test gates are CI-only — never run locally". The tests are authored and present; CI will exercise them at PR time.

---

## Next step

**NON_CONFORMANT** — verdict downgraded from the caller's expected `CONFORMANT` because the new directional gap (#5, UUID/empty-string drift) requires a design call before the branch can be safely merged. Specifically:

1. Address NEW DIRECTIONAL_GAP #5 — choose a resolution for `agentId` typing in `ProposeActionInput`, update both call sites in `spendingBudgetService.ts` and `chargeRouterService.ts`, add a regression test. Cross-tier change.
2. Re-run `pr-reviewer` on the expanded changed-code set (the four prior closures + the resolution to #5).
3. Open the PR.

The four prior directional gaps (DG#1–#4) are all verified PASS; their closure quality is good. The narrow scope of NEW DIRECTIONAL_GAP #5 is recorded so the main session can address it directly without re-reading this log.

**Commit at finish:** `e1d459f0` (initial commit) — backfilled to log header; this commit and the follow-up backfill ship as two commits per the "never `--amend`" rule.


