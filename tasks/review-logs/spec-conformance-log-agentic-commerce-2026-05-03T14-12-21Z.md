# Spec Conformance Log

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Spec commit at check:** `59fe9f44` (locked Final, chatgpt-spec-review APPROVED)
**Branch:** `claude/agentic-commerce-spending`
**Base:** `6d6c6ff48174b5913a1132c8cd41b93babb30c6d` (merge-base with main)
**Branch HEAD:** `48cd8b5c4f1310936692ed0c16675920d42bd9b9`
**Scope:** All 16 chunks (caller confirmed full-branch implementation)
**Changed-code set:** ~150 files (committed merges from main + ~90 net agentic-commerce additions)
**Run at:** 2026-05-03T14:12:21Z
**Commit at finish:** `ea6ea701f51a542ffbccbd2bd6839356ffa5f9bf`

## Table of Contents

- Summary
- Anchor checks (operator-named)
- Findings (full enumeration)
- Mechanical fixes applied
- Directional gaps routed to tasks/todo.md
- Files modified by this run
- Next step

---

## Summary

- Anchor checks verified:        15
- Anchor checks PASS:            13
- Anchor MECHANICAL_GAP fixed:   1 (route mounting)
- Anchor DIRECTIONAL_GAP:        1 (route permission guards do not match spec §11.3)
- Additional MECHANICAL_GAP fixed: 1 (missing down migration for 0274)
- Additional DIRECTIONAL_GAP:    3 (pure-helper boundary, GUC convention, proposeAction bypass)

| Verdict | Count |
|---|---|
| PASS | 13 |
| MECHANICAL_GAP → fixed | 2 |
| DIRECTIONAL_GAP → deferred | 4 |
| AMBIGUOUS → deferred | 0 |
| OUT_OF_SCOPE → skipped | 0 |

**Verdict:** CONFORMANT_AFTER_FIXES — mechanical gaps closed in-session; 4 directional gaps must be addressed by the main session before PR.

---

## Anchor checks (operator-named, verified one-by-one)

| # | Anchor | Verdict | Evidence |
|---|---|---|---|
| 1 | All 8 RLS table entries in `rlsProtectedTables.ts` | PASS | `server/config/rlsProtectedTables.ts:953-1001` — 7 spend tables under `policyMigration: '0271_agentic_commerce_schema.sql'` and `cost_aggregates` under `policyMigration: '0272_cost_aggregates_rls_and_spend_dims.sql'` |
| 2 | `agent_charges` triggers reject forbidden transitions; mirror `assertValidAgentChargeTransition` | PASS | `migrations/0271_agentic_commerce_schema.sql:295-621` (`agent_charges_validate_update`) ↔ `shared/stateMachineGuards.ts:265-346` (`assertValidAgentChargeTransition` + `isAllowedAgentChargeTransition`). Same (from→to) pairs, same `failed → succeeded` carve-out gated on caller identity |
| 3 | `chargeRouterServicePure.ts` exports the 7 named pure functions; no impure imports | PASS-WITH-CAVEAT | 7 exports: `evaluatePolicy`, `buildChargeIdempotencyKey`, `normaliseMerchantDescriptor`, `previewSpendForPlan`, `validateAmountForCurrency`, `classifyStripeError`, `deriveWindowKey`. **CAVEAT** — line 13 imports `canonicaliseJson` from impure `actionService.ts`. Routed as DIRECTIONAL_GAP #2 |
| 4 | Execute-time re-checks AFTER COMMIT, OUTSIDE advisory lock | PASS | `chargeRouterService.ts:541-766` — `executeApproved` runs entirely outside the policy-gate `db.transaction(...)`. Re-checks ordered: expires_at (569-580), kill switch (582-601), SPT (603-626), `validateAmountForCurrency` (628-639), then Stripe call |
| 5 | Stripe error classification routes through `classifyStripeError` exclusively | PASS | All references at lines 688, 692, 729 use the pure helper. No bespoke string-matching in chargeRouterService |
| 6 | Outbound Stripe metadata carries `agent_charge_id`, `mode`, `traceId` | PASS | `chargeRouterService.ts:662` — `const metadata = { agent_charge_id: chargeId, mode: 'live' as const, traceId };` |
| 7 | `agentSpendAggregateService` separate file; idempotency via `last_aggregated_state` | PASS | `agentSpendAggregateService.ts:1-254` — separate file, separation invariant in header. `last_aggregated_state` guard at lines 71-74 (early exit) and 130-147 (UPDATE-RETURNING with `IS DISTINCT FROM`) |
| 8 | `issue_refund` skill creates new `inbound_refund` row, never mutates parent | PASS | `spendSkillHandlers.ts:308-335` — `executeIssueRefund` calls `executeSpendSkill` with `chargeType: 'refund'` + `parentChargeId`. No `UPDATE ... status = 'refunded'` in the handler. Migration 0271 CHECK enforces `kind = 'inbound_refund' AND parent_charge_id IS NOT NULL` |
| 9 | Every spend skill in `ACTION_REGISTRY` has matching `SKILL_HANDLERS` entry | PASS | All 5 spend skills in both: `actionRegistry.ts:3063, 3105, 3148, 3191, 3234` (`spendsMoney: true`) + `skillExecutor.ts:2002, 2006, 2010, 2014, 2018` |
| 10 | Webhook route uses dedupe store with TTL ≥ 96h; multi-layer dedupe | PASS | `routes/webhooks/stripeAgentWebhook.ts:38` — `STRIPE_WEBHOOK_DEDUPE_TTL_MS = 96 * 60 * 60 * 1000`. Multi-layer documented in header (primary store, secondary `last_transition_event_id`, tertiary DB trigger). Dedupe runs BEFORE 200 ack (line 216) and BEFORE enqueue (line 236) |
| 11 | `MERCHANT_ALLOWLIST_MAX_ENTRIES = 250` enforced at every CRUD boundary | PASS | Constant at `server/config/spendConstants.ts:39`. Enforced via `validateMerchantAllowlist` in `spendingBudgetServicePure.ts:51`. Called from `spendingBudgetService.create()` line 123 and `updatePolicy()` line 367 |
| 12 | Closed Postgres ENUMs for `agent_charge_status` / `_mode` / `_kind` / `_transition_caller` | PASS | `migrations/0271_agentic_commerce_schema.sql:42-87` — all four ENUMs created idempotently. Mirrored at `shared/stateMachineGuards.ts:204-230` |
| 13 | `metadata_json.category: 'spend'` written at action creation when `spendsMoney: true` | PASS | `proposeAction.ts:295-296` — `definition?.spendsMoney === true ? { category: 'spend' } : undefined` passed to `actionService.proposeAction`. Also `chargeRouterService.ts:497` for charge-router-driven actions |
| 14 | `app.spend_caller` GUC documented in migration header AND `architecture.md` | PASS | Migration header at `0271_agentic_commerce_schema.sql:24-40`; architecture mention at `architecture.md:1588-1600` ("Trigger-only GUC: `app.spend_caller`" with NOT-an-RLS-variable warning) |
| 15 | Doc-sync: `architecture.md` updated for every reference doc that should be touched | PASS | architecture.md ships substantial agentic-commerce coverage: §"Spend-skill registration pattern" (line 785), §"Agentic Commerce" SPT vault (1610-1634), migration list (1845-1848), "Key files per domain" rows (3335-3340) covering charge router / spending budgets / agent charges / approval channels / spend aggregator / spend alert config. capabilities.md lists the spend skills (lines 830-838) |

---

## Findings (full enumeration)

### MECHANICAL_GAP #1 — Spend CRUD routes are not mounted in `server/index.ts` (FIXED)

- **Spec section:** §18.1 New Files / §11.3 Route Guards
- **Quote:** "Route files (`server/routes/`): `spendingBudgets.ts` — CRUD + `POST /:id/promote-to-live`; `spendingPolicies.ts` — `GET`/`PATCH /spending-budgets/:id/policy`; `agentCharges.ts` — read-only ledger queries; `approvalChannels.ts` — CRUD"
- **Gap:** Route files were authored but never imported or mounted in `server/index.ts`. Only the webhook route (`stripeAgentWebhook.ts`) was wired in. The entire admin UI surface (Chunk 14) would have been disconnected from the server in v1.
- **Fix applied:** Added 4 imports (`server/index.ts:180-183`) and 4 `app.use(...)` mount calls (`server/index.ts:398-401`), placed alongside `agentRecommendationsRouter` immediately before the catch-all `publicPageServingRouter`. Each route file already declares its full URL path at handler level (no path-prefix required at mount time, matching existing patterns).
- **Verification:** `npm run lint` and `npm run typecheck` both pass clean (0 errors). File modified: `server/index.ts`.

### MECHANICAL_GAP #2 — Migration 0274 missing down migration (FIXED)

- **Spec section:** §18.3 Migrations
- **Quote:** "Down migrations required for each (`<NNNN>_<name>.down.sql`)."
- **Gap:** `migrations/0274_actions_agent_id_nullable.sql` shipped without the corresponding `0274_actions_agent_id_nullable.down.sql`.
- **Fix applied:** Created `migrations/0274_actions_agent_id_nullable.down.sql` with `ALTER TABLE actions ALTER COLUMN agent_id SET NOT NULL;` and a header noting that the rollback will fail if any system-initiated rows (`agent_id IS NULL`) exist; operators must clean those before reverting. Strict-rollback posture matches other system-table migrations in this codebase.

### DIRECTIONAL_GAP #1 — Spend route permission guards do not match spec §11.3

- **Spec quote:** "`GET /spending-budgets` — `requirePermission('spend_approver')` or `requirePermission('admin')`. `POST /spending-budgets` — `requirePermission('admin')`. `POST /spending-budgets/:id/promote-to-live` — `requirePermission('spend_approver')`. `GET /spending-budgets/:id/policy` — `requirePermission('spend_approver')`. `GET /agent-charges` — `requirePermission('spend_approver')`."
- **Gap:** All spend routes use `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)` or `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT)` — neither matches the spec's named guards. The `SPEND_APPROVER` permission key IS registered in `server/lib/permissions.ts:88` but is not enforced on any route. The default-grant logic in `spendingBudgetService.create()` grants `spend_approver` to admins atomically, but the routes still check `SETTINGS_VIEW`/`SETTINGS_EDIT` instead — defeating the purpose of the per-budget grant.
- **Why directional:** Replacing the route guards requires deciding (a) whether to mint a new `ADMIN` permission key (the spec's `'admin'` is not an existing constant) or treat `SETTINGS_EDIT` as the de-facto admin gate, and (b) whether to introduce a `requireAnyPermission([SPEND_APPROVER, ADMIN])` middleware. Wider design decision than spend conformance.
- **Suggested approach:** Decide the canonical "admin" check for the codebase, then replace route guards with `requireOrgPermission(SPEND_APPROVER)` (read paths) and the chosen admin gate (write paths). Cross-tier — touches `permissions.ts`, all 4 route files, and possibly `permissionSeedService.ts`.

### DIRECTIONAL_GAP #2 — `chargeRouterServicePure.ts` imports from impure `actionService.ts`

- **Spec quote:** "Pure/impure split enforced. Charge router decisions ... live in `chargeRouterServicePure.ts`. ... Enforced by `verify-pure-helper-convention.sh`." (§10 Invariant 15)
- **Gap:** `chargeRouterServicePure.ts:13` imports `canonicaliseJson` from `'./actionService.js'`. `actionService.ts` is the impure side — it imports `db` (line 3) and DB schemas (line 4). This drags transitive DB imports into a `*Pure.ts` file, which the pure-helper-convention gate is designed to block.
- **Why directional:** The mechanical fix is to extract `canonicaliseJson` (plus siblings `hashActionArgs`, `computeValidationDigest`) into a new `shared/canonicalJson.ts` and have `actionService.ts` re-export for backward compatibility. That extraction touches every caller across the codebase (skill handlers, validation digests). Choosing the new file location and the re-export shape is design-shaped.
- **Suggested approach:** Extract `canonicaliseJson` + `hashActionArgs` + `computeValidationDigest` to `shared/canonicalJson.ts` (pure, depends only on `crypto`), have `actionService.ts` re-export them, update `chargeRouterServicePure.ts` to import from the new shared location. Re-run `verify-pure-helper-convention.sh` to confirm.

### DIRECTIONAL_GAP #3 — `app.spend_caller` GUC convention is unevenly applied

- **Migration header quote:** "Caller identity is set via: `SET LOCAL "app.spend_caller" = '<caller>';` inside `withOrgTx` before the UPDATE."
- **Gap:** `chargeRouterService.runPolicyGate` correctly sets `SET LOCAL app.spend_caller = 'charge_router'` inside its `db.transaction(...)` (line 310), but `chargeRouterService.executeApproved` runs OUTSIDE that transaction (per invariant 35 — Stripe call must be outside the lock). The UPDATE calls inside `executeApproved` (lines 593, 643, 757) use their own implicit transactions and do NOT set `app.spend_caller` first. The trigger reads `current_setting('app.spend_caller', true)` and gets NULL/empty for those updates. Functionally this works because the trigger only requires caller identity for the `failed → succeeded` carve-out and non-status updates on `executed` rows — `approved → blocked/executed/failed` transitions don't need it. But the convention documented in the migration header is not being followed for executeApproved updates.
- **Why directional:** Whether the convention is "every UPDATE must set caller" or "only gated UPDATEs need caller" is a design call. The trigger lets executeApproved updates through without it; either tighten the trigger or relax the convention text — both are valid resolutions.
- **Suggested approach:** Add `SET LOCAL app.spend_caller = 'charge_router'` to `updateChargeStatus` (or wrap each UPDATE in a small tx that sets the GUC first). Trivial code change; design decision is whether to require the GUC for all UPDATEs.

### DIRECTIONAL_GAP #4 — `actionService.proposeAction` is bypassed for `promote_spending_policy_to_live`

- **Spec quote:** "System creates a HITL approval action (kind: `promote_spending_policy_to_live`)." (§14 Shadow-to-Live Promotion)
- **Gap:** `spendingBudgetService.requestPromotion` (lines 484-516) inserts an `actions` row directly via Drizzle, bypassing `actionService.proposeAction`. This sidesteps the registry validation (`getActionDefinition` would throw "Unknown action type" since `promote_spending_policy_to_live` is NOT in `ACTION_REGISTRY`). Works today because the fields the registry validation produces are hand-built into the INSERT, but it makes spend-promotion the only HITL action in the system not flowing through the canonical proposeAction surface.
- **Why directional:** Two valid resolutions — (a) register `promote_spending_policy_to_live` in `ACTION_REGISTRY` (requires designing its parameter schema, gateLevel, idempotencyStrategy), or (b) document the deliberate bypass with a header comment + add a regression test asserting no other actions ever bypass `proposeAction`. Choice between them is design-shaped.
- **Suggested approach:** Add the entry to `ACTION_REGISTRY` (`actionCategory: 'api'`, `defaultGateLevel: 'review'`, `directExternalSideEffect: false`, minimal Zod payload schema). Refactor `requestPromotion` to call `actionService.proposeAction`. Cross-tier — touches actionRegistry, actionService, spendingBudgetService.

---

## Mechanical fixes applied

```
[FIXED] Mount spend CRUD routes (Spec §18.1 / §11.3)
  File: server/index.ts
  Lines: 179-183 (imports), 397-401 (app.use)
  Spec quote: "Route files (server/routes/): spendingBudgets.ts ... spendingPolicies.ts ... agentCharges.ts ... approvalChannels.ts"
  Change: Added 4 imports + 4 app.use mounts so the spend routes are reachable.

[FIXED] Down migration for 0274 (Spec §18.3)
  File: migrations/0274_actions_agent_id_nullable.down.sql (new)
  Spec quote: "Down migrations required for each (<NNNN>_<name>.down.sql)."
  Change: Created the strict down migration with header noting rollback failure on system-initiated NULL rows.
```

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- DIRECTIONAL_GAP #1 — Spend route permission guards mismatch spec §11.3 (`SETTINGS_VIEW`/`SETTINGS_EDIT` instead of `SPEND_APPROVER`/`admin`)
- DIRECTIONAL_GAP #2 — `chargeRouterServicePure.ts` imports `canonicaliseJson` from impure `actionService.ts` (transitive DB-import leak)
- DIRECTIONAL_GAP #3 — `app.spend_caller` GUC convention enforcement boundary unclear
- DIRECTIONAL_GAP #4 — `promote_spending_policy_to_live` HITL action bypasses `actionService.proposeAction`

---

## Files modified by this run

- `server/index.ts` — mounted 4 spend routers
- `migrations/0274_actions_agent_id_nullable.down.sql` — new file
- `tasks/todo.md` — appended deferred-from-conformance section
- `tasks/review-logs/spec-conformance-log-agentic-commerce-2026-05-03T14-12-21Z.md` — this log

---

## Next step

CONFORMANT_AFTER_FIXES — mechanical gaps closed in-session. Re-run `pr-reviewer` on the expanded changed-code set so it sees the route mounting and the new down migration. The 4 directional gaps must be addressed by the main session before the PR opens — see `tasks/todo.md` under "Deferred from spec-conformance review".
