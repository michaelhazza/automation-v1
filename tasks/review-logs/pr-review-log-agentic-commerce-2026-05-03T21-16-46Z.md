# PR Review Log — agentic-commerce

**Branch:** `claude/agentic-commerce-spending`
**Slug:** `agentic-commerce`
**Reviewer:** pr-reviewer (Opus 4.7, 1M context)
**Timestamp:** 2026-05-04T00:00:00Z
**Verdict:** CHANGES_REQUESTED (5 blocking, 4 strong, 4 nice-to-have)

## Table of Contents
- Files reviewed
- Blocking issues (B1-B5)
- Strong recommendations (S1-S4)
- Nice-to-have (N1-N4)
- Cross-references
- Summary

## Files reviewed

~30 server files (chargeRouterService, chargeRouterServicePure, spendingBudgetService, spendSkillHandlers, agentSpendAggregateService, agentSpendCompletionHandler, agentSpendRequestHandler, stripeAgentWebhookService, stripeAgentWebhook route, approvalChannelService, spendingBudgets/spendingPolicies/agentCharges/approvalChannels routes, sptVaultService, policyEngineService, integrationConnectionService, actionService, spendingBudgetServicePure, canonicalJsonPure, agent_charges schema + migration 0271, cost_aggregates migration 0272, rlsProtectedTables, frontend ReviewQueuePage / PendingApprovalCard / OnboardingWizardPage). Cross-checked spec.md §4-§17 and DEVELOPMENT_GUIDELINES §1, §2, §3, §8.10, §8.11, §8.18, §8.19, §8.23.

## Blocking Issues

### B1 - chargeRouterService.runPolicyGate UPDATE violates DB trigger; ALL proposeCharge calls fail

**Files:** `server/services/chargeRouterService.ts:201-235` (INSERT), `server/services/chargeRouterService.ts:444-547` (gate UPDATEs), `migrations/0271_agentic_commerce_schema.sql:295-621` (trigger).

The proposeCharge flow inserts a `proposed` row with placeholder values (`policyVersion: 0`, `mode: 'live'`), then runPolicyGate UPDATEs with the resolved values. The DB trigger `agent_charges_validate_update` treats both `policy_version` and `mode` as immutable post-insert even on a status transition, raising on every gate UPDATE.

`policy_version` always changes (0 -> >=1) and `mode` changes whenever the resolved policy is `shadow`. Every proposeCharge raises and the entire charge router is unreachable in production. Pure tests cannot detect this; impure path has no integration test.

**Fix:** read policy + budget BEFORE the INSERT so the row is inserted with correct `policy_version` and `mode`, OR extend the trigger's mutable-on-transition allowlist to include both columns when transitioning out of `proposed`.

### B2 - agentSpendAggregateService has no DB context; webhook-driven aggregation silently fails

**Files:** `server/services/agentSpendAggregateService.ts:24,46-176`, called from `server/services/stripeAgentWebhookService.ts:481`.

The aggregate service imports the raw pool (`import { db } from '../db/index.js';`) and runs SELECT/UPDATE/upsert on RLS-protected tables (`agent_charges`, `cost_aggregates`) without setting `app.organisation_id` and without `withAdminConnection`. RLS fails closed when the GUC is NULL: `chargeRow` reads as undefined, writes fail RLS WITH CHECK.

The webhook handler fires-and-forgets. Dashboards (Chunk 14) will show `$0 settled` for every live charge.

**Fix:** wrap the aggregate path in `withAdminConnection` + `SET LOCAL ROLE admin_role` + `SET LOCAL app.organisation_id = '<charge.org_id>'`, or refactor to accept a `tx` parameter.

### B3 - agentSpendCompletionHandler set_provider_charge_id path is rejected by the DB trigger

**File:** `server/jobs/agentSpendCompletionHandler.ts:155-205`.

The merchant-success branch sets `provider_charge_id` AND `last_transition_by` on a still-`executed` row (no status change). The trigger's no-status-update branch (migration 0271:484-617) only permits `provider_charge_id` and `updated_at` to change. `last_transition_by` is in the disallowed list and triggers an exception. Spec §5.1 explicitly excludes `last_transition_by` from the worker-completion no-status path.

**Fix:** drop `lastTransitionBy: 'worker_completion'` from the SET clause (lines 166-170).

### B4 - spendingBudgetService.create default-grants spend_approver to ALL org users, not just admins

**File:** `server/services/spendingBudgetService.ts:138-153`.

Both branches (org-scope, subaccount-scope) enumerate `orgUserRoles` for the organisation without filtering by `permissionSetId` - every user with any role gets a row in `spending_budget_approvers`. Spec §11.1 requires only org-admin role holders. The cosmetic effect is muted by the route-layer `requireOrgPermission(SPEND_APPROVER)` gate, but the data leak on `spending_budget_approvers` is real.

**Fix:** join `orgUserRoles -> permissionSets` and filter by the Org Admin template.

### B5 - POST /api/approval-channels/:channelId/grants accepts body-supplied subaccountId without verifying tenant ownership

**Files:** `server/routes/approvalChannels.ts:216-232`, `server/services/approvalChannelService.ts:357-386`.

The route reads `subaccountId` from the body and passes it directly to `addGrant` without `resolveSubaccount`. The FK rejects non-existent ids but accepts any id that exists in any other org. Cross-entity ID verification gap (DEVELOPMENT_GUIDELINES §9 last bullet).

**Fix:** call `resolveSubaccount(subaccountId, req.orgId!)` in the route before `addGrant`.

## Strong Recommendations

### S1 - getChargeAggregates queries cost_aggregates without organisationId filter

`server/services/chargeRouterService.ts:986-1000`. RLS protects but DEVELOPMENT_GUIDELINES §1 mandates app-layer filtering. Add `eq(costAggregates.organisationId, opts.organisationId)`.

### S2 - spendSkillHandlers.intentId = randomUUID() defeats §16.1 retry-grouping

`server/services/spendSkillHandlers.ts:243`. Should be deterministic from `(skillRunId, toolCallId, intent)`. agentSpendRequestHandler does this correctly at line 247.

### S3 - resolveSpendingContext does not filter by currency or kill-switch

`server/services/spendSkillHandlers.ts:55-108`. Add `isNull(spendingBudgets.disabledAt)` and `eq(spendingBudgets.currency, parsed.currency)`.

### S4 - proposeCharge isNew heuristic is fragile

`server/services/chargeRouterService.ts:241`. Switch to `RETURNING *, (xmax = 0) AS is_new`, or accept with comment.

## Nice-to-Have

### N1 - schema index doesn't re-export new spend tables

Seven new tables imported directly. Add `export * from './<file>';` to `server/db/schema/index.ts`.

### N2 - runPolicyGate advisory-lock-tx semantics undocumented

Add comment explaining the function runs inside the caller's transaction.

### N3 - resolveExistingOutcome returns actionId: row.actionId ?? ''

`server/services/chargeRouterService.ts:907`. Same empty-string drift class as the spec-conformance pass flagged. Use `assert row.actionId !== null`.

### N4 - Empty-allowlist UX banner deferred to Chunk 14

Not actionable now.

## Cross-references

- **Spec drift**: B1's `policy_version`/`mode` immutability is a code-vs-trigger contradiction.
- **DEVELOPMENT_GUIDELINES violations**: §1 (org filter) - S1; §1 (resolveSubaccount) - B5; §2 (no direct db imports) - B2.
- **Spec-conformance closures verified**: the four prior directional gaps + the agentId nullability fix all pass syntactic verification.

## Summary

The branch is structurally sound and follows the spec at the contract level. B1 + B3 are DB-trigger/code mismatches that would surface immediately on first prod use. B2 is a silent failure mode. B4 over-grants. B5 is a tenant-isolation gap. Address all five blocking findings, then re-run pr-reviewer.

---

## Fixes applied 2026-05-04 (main session)

All 5 blocking + all 4 strong findings closed in-session. Static gates clean (typecheck 0 errors, lint 0 errors / 726 baseline warnings, build:server clean).

### B1 — Trigger immutability carve-out (proposed → X transition only)
- Edited `migrations/0271_agentic_commerce_schema.sql:419-470`: `spending_policy_id`, `policy_version`, and `mode` now permitted to change ONLY when `OLD.status = 'proposed'`. Rationale: these three columns are snapshot at gate-evaluation time (the row is inserted with placeholders before the policy is read inside the lock). Immutable after the proposed → X transition.
- Updated spec `tasks/builds/agentic-commerce/spec.md:305-307` to document the gate-time-snapshot semantic and remove `spending_policy_id` / `policy_version` / `mode` from the immutable-post-insert list.

### B2 — agentSpendAggregateService DB context
- Refactored `server/services/agentSpendAggregateService.ts:46-176` to wrap the entire `upsertAgentSpend` call in `withAdminConnection` + `SET LOCAL ROLE admin_role`, then `SELECT set_config('app.organisation_id', <chargeOrgId>, true)` after the charge row is read. All subsequent UPDATEs/upserts run on the same admin tx so RLS WITH CHECK has a matching tenant anchor.
- Removed direct `import { db }` — replaced with the admin connection pattern. `applySubtractWithClamp` now takes an `OrgScopedTx` parameter.

### B3 — agentSpendCompletionHandler.set_provider_charge_id
- `server/jobs/agentSpendCompletionHandler.ts:165-175`: dropped `lastTransitionBy: 'worker_completion'` from the no-status-change UPDATE. The trigger's no-status branch only permits `provider_charge_id` and `updated_at`. Comment added documenting the trigger constraint.

### B4 — Default-grant filtered by SPEND_APPROVER permission key
- `server/services/spendingBudgetService.ts:138-160`: replaced the over-broad `orgUserRoles` enumeration with a `selectDistinct` joining `permissionSetItems ON permissionSetItems.permissionSetId = orgUserRoles.permissionSetId WHERE permissionKey = ORG_PERMISSIONS.SPEND_APPROVER`. Only users whose role grants the spend_approver permission key are now persisted as default approvers. Added `permissionSetItems` import.
- Subaccount branch unified with org branch since v1 doesn't model a subaccount-admin role; comment notes the future split point.

### B5 — Approval-channels grants route resolveSubaccount
- `server/routes/approvalChannels.ts:216-232`: route now calls `resolveSubaccount(subaccountId, req.orgId!)` before invoking `addGrant`. Body-supplied subaccount ids that don't belong to the caller's org are rejected at the resolution boundary.

### S1 — getChargeAggregates org filter
- `server/services/chargeRouterService.ts:986-994`: added `eq(costAggregates.organisationId, opts.organisationId)` as the first WHERE clause. Closes the sentinel-org leak path and matches DEVELOPMENT_GUIDELINES §1 ("filter even with RLS").

### S2 — Deterministic intentId
- `server/services/spendSkillHandlers.ts:215-226`: replaced `randomUUID()` with a SHA-256 hash of `(skillRunId, toolCallId, intent)` formatted as a UUID. Retries of the same logical operation now share an `intent_id`. Comment documents the spec §16.1 retry-grouping intent.

### S3 — resolveSpendingContext kill-switch + currency filter
- `server/services/spendSkillHandlers.ts:55-69`: added `currency` parameter; added `isNull(spendingBudgets.disabledAt)` and `eq(spendingBudgets.currency, currency)` to the WHERE clause. Surfaces `no_active_spending_budget` instead of misleading `kill_switch` / `currency_mismatch` errors. Caller updated at line 186-191 to pass `parsed.currency`.

### S4 — proposeCharge isNew heuristic
- `server/services/chargeRouterService.ts:241-251`: kept the heuristic but added a 6-line comment documenting the deduping safety nets (idempotency_key UNIQUE, advisory lock, optimistic UPDATE predicate). Decision: full `xmax = 0` refactor would require dropping Drizzle's typed insert and using raw SQL — the safety nets make the heuristic robust enough that the refactor isn't worth the surface change.

### Nice-to-haves (not done)

- N1 (schema index re-export of seven new tables) — left as a follow-up; not blocking.
- N2 (advisory-lock-tx semantics comment) — left; runPolicyGate's existing comment header sufficient for the next reader.
- N3 (`actionId ?? ''` in `resolveExistingOutcome`) — left; the broader empty-string drift class was closed by the spec-conformance re-verification's `agentId: string | null` widening, and the affected branch is only reachable when `actionId` is in fact non-null.
- N4 (Chunk 14 banner) — out of scope for this branch.

### Verification

- `npm run typecheck` — 0 errors
- `npm run lint` — 0 errors / 726 warnings (same baseline)
- `npm run build:server` — clean

Re-running pr-reviewer post-fixes is the next gate before opening the PR.

