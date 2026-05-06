# Agentic Commerce — brief addendum (v3)

**Status:** Stakeholder-resolved decisions, ready for spec-coordinator
**Companion to:** `docs/agentic-commerce-brief.md` (v2)
**Companion to:** `docs/agentic-commerce-exploration-report.md`
**Date:** 2026-05-03

This addendum consolidates all stakeholder decisions made after the codebase exploration report. It supersedes any conflicting language in v2 and resolves the open questions raised in both v2 and the exploration report. Spec-coordinator should treat this addendum, the v2 brief, and the exploration report as a single combined input package.

---

## A. Foundational design tenet

**Synthetos subaccounts are first-class tenants.** They function standalone by default. Agency-level configuration adds capabilities and oversight, never strips them. Where the agency and subaccount diverge, the subaccount's own configuration wins unless the agency has been explicitly granted override authority by product design or by org-level admin action.

This tenet propagates beyond approval channels. It applies to Spending Budgets, Compute Budgets, snapshot opt-outs, kill switches, ledger visibility, and any future feature that touches the org-subaccount boundary. The spec author and architect should refer back to this principle whenever a default behaviour is in question.

---

## B. Vocabulary lock

The codebase currently uses `Budget` to mean "LLM cost ceiling." This collides with the new spending capability. Both concepts are budgets in the natural English sense; the qualifier disambiguates them.

### B.1 Compute Budget (existing system, renamed)

The LLM and compute cost ceiling system, formerly `Budget`.

- **Compute Budget** — umbrella concept. A ceiling on compute cost (LLM tokens, embeddings, classification calls, IEE compute time).
- **Compute Reservation** — pre-flight reservation row created before an LLM call.
- **Compute Limit** — single cap inside a budget (monthly, daily, hourly, per-minute).
- **Compute Window** — time period a limit applies to.
- **Compute Context** — resolution context (org, subaccount, agent, run).
- **Compute Budget Exceeded Error** — typed error.
- **Compute Budget Lock** — advisory lock taken during reservation.

### B.2 Spending Budget (new system)

The real-money agent spending system. Operator-facing concept.

- **Spending Budget** — umbrella concept. The total operator-facing notion of "money allocated for this agent or subaccount to spend."
- **Spending Policy** — rules object inside a Spending Budget. Limits, allowlists, approval thresholds, mode flag. Foreign-keyed from `spending_budgets`.
- **Spending Limit** — single cap inside a policy (max per transaction, max per day, max per month).
- **Spending Mode** — `shadow` or `live`.
- **Spend** — verb. Agents spend money against their Spending Budget.
- **Charge** — unit row in the ledger. Each money movement, attempted or executed.
- **Charge Status** — `pending`, `succeeded`, `failed`, `refunded`, `disputed`, `shadow_settled`.
- **Charge Intent** — what the spend was for, in human-readable form.
- **Charge Type** — `purchase`, `subscription`, `top_up`, `invoice_payment`, `refund`.
- **Spend Ledger** — table of all charges. Public name and code name match.
- **Merchant Allowlist** — approved vendors per policy.
- **Approval Threshold** — amount above which HITL fires.
- **Kill Switch** — three-level revocation (per-policy, per-subaccount, per-org).
- **Shared Payment Token (SPT)** — Stripe terminology, kept verbatim. Stored as `accessToken` on a `stripe_agent` `integrationConnection`.
- **Charge Router** — service that applies the policy and routes the charge.

### B.3 UI disambiguation

Two distinct dashboard tabs. Both legitimately use "budget" because both are budgets, with the qualifier disambiguating.

- **Compute tab.** "You have used 73% of this month's Compute Budget. $342 of $500 used on LLM calls."
- **Spend tab.** "Your Onboarding Agent has spent $1,247 of its $5,000 monthly Spending Budget. 23 charges this month."

### B.4 Schema-level rename inventory

This is a structural rename, not a feature change. It must ship as the **first chunk of the build**, fully reviewed, before any new spending code touches the codebase. The data does not move. Only names change. Existing rows in `budget_reservations` become rows in `compute_reservations` via `ALTER TABLE ... RENAME TO`. No data migration, no double-write, no compatibility shim.

**Tables to rename.**
- `budget_reservations` → `compute_reservations`
- `org_budgets` → `org_compute_budgets`

**New tables (added in subsequent chunks).**
- `spending_budgets` — umbrella row tying a policy to an agent or subaccount.
- `spending_policies` — rules. Foreign-keyed from `spending_budgets`.
- `agent_charges` — spend ledger.
- `subaccount_approval_channels` — per-subaccount channel config.
- `org_approval_channels` — per-org channel config.
- `org_subaccount_channel_grants` — bridge table for org→subaccount channel sharing.

**Columns to rename (existing compute side).**
- `monthly_cost_limit_cents` → `monthly_compute_limit_cents`
- `daily_cost_limit_cents` → `daily_compute_limit_cents`
- Other per-period cost-cap columns: same `_compute_` qualifier added.
- Confirm exhaustive list before migration. Half a renaming is worse than none.

**Service files to rename.**
- `budgetService.ts` → `computeBudgetService.ts`
- `budgetServicePure.ts` → `computeBudgetServicePure.ts`

**New service files.**
- `spendingBudgetService.ts` + `spendingBudgetServicePure.ts`
- `chargeRouterService.ts` + `chargeRouterServicePure.ts`
- `agentSpendAggregateService.ts`
- `sptVaultService.ts`
- `stripeAgentWebhookService.ts`
- `approvalChannelService.ts` + `approvalChannelServicePure.ts`

**Schema files to rename.**
- `budgetReservations.ts` → `computeReservations.ts`

**New schema files.**
- `spendingBudgets.ts`, `spendingPolicies.ts`, `agentCharges.ts`
- `subaccountApprovalChannels.ts`, `orgApprovalChannels.ts`, `orgSubaccountChannelGrants.ts`

**Type names to rename.**
- `BudgetContext` → `ComputeContext`
- `BudgetExceededError` → `ComputeBudgetExceededError`
- `BudgetReservation` → `ComputeReservation`

**New type names.**
- `SpendingBudget`, `SpendingPolicy`, `Charge`, `ChargeStatus`, `ChargeIntent`, `ChargeType`, `ApprovalChannel`, `ApprovalChannelGrant`

**Functions and methods to rename.**
- `acquireOrgBudgetLock` → `acquireOrgComputeBudgetLock`
- `checkAndReserveBudget` → `checkAndReserveCompute`
- `releaseBudget` → `releaseCompute`
- `commitBudget` → `commitCompute`

**Event names to rename.**
- `budget.reserved` → `compute.reserved`
- `budget.exceeded` → `compute.exceeded`
- `budget.committed` → `compute.committed`
- `budget.released` → `compute.released`

**New event names.**
- `spend.proposed`, `spend.approved`, `spend.executed`, `spend.failed`, `spend.refunded`, `spend.shadow_settled`
- `approval.channel_notified`, `approval.received`, `approval.timed_out`, `approval.superseded`

**User-facing strings.** All UI labels that currently say "budget" in the LLM-cost context become "Compute Budget." All error messages, dashboard labels, settings page labels updated in the same chunk.

---

## C. Approval channels

Subaccounts are first-class tenants per Section A. The subaccount owns its own approval channel configuration. The org cannot push approvals into a subaccount's channels. The org can configure agency-level oversight by adding org-owned channels to a subaccount's fan-out, but the subaccount's own channels remain the default.

### C.1 Three-table model

**`subaccount_approval_channels`** — owned by the subaccount, CRUD by subaccount admins. Holds channel adapter type, configuration (e.g., Slack workspace and channel ID, email address, Telegram chat ID), enabled flag. Always present for every subaccount.

**`org_approval_channels`** — owned by the org, CRUD by org admins only. Holds the org's own channels for approvals on org-level agents and for any granted subaccount fan-out.

**`org_subaccount_channel_grants`** — bridge table owned by the org, CRUD by org admins only. Each row says "for approvals fired from this subaccount, also fan out to this org-owned channel." Subaccount cannot see, edit, or delete these rows. Granting and revoking writes to the audit log on both sides.

### C.2 Default and grant behaviour

**Default state.** Every subaccount has its own channel config. Subaccount admin sets up channels (in-app in v1, more channels in follow-up builds). Approvals from agents in this subaccount fire only through this subaccount's configured channels.

**Org grant, opt-in.** Org admin can add agency-owned channels to a subaccount's fan-out. The grant is per-subaccount, per-channel. When an approval fires from that subaccount, it fans out to both the subaccount's own channels and the granted org channels.

**Fan-out semantics.** All configured channels (subaccount's own plus any org grants) receive the notification simultaneously. First response wins. Other channels receive a "this approval has been resolved by Y via Z at T" follow-up.

**Revocation.** Org can revoke any grant at any time. Subaccount immediately reverts to firing only through its own channels. Grant rows are deactivated, not deleted, so re-granting restores prior state.

**Org-exclusive mode (deferred to future).** Schema supports a future "org replaces subaccount channels" mode for stronger agency control. Not exposed in v1 UI. Not built in v1. Schema should not preclude it.

### C.3 ApprovalChannel interface

Every channel implements the same shape. Send notification. Receive response. Acknowledge to other channels when one wins. Channel-specific quirks (Slack signature verification, Telegram inline keyboards, email magic links) live inside the adapter, never in the core HITL service.

The core HITL service owns the approval state machine. Channels are dumb pipes that translate the channel-agnostic approval payload into native formats.

**v1 ships:** the interface, plus one implementation (`InAppApprovalChannel`).
**Follow-up builds:** Slack, email, Telegram, SMS adapters as separate chunks. Each adds one file. None requires changes to the core HITL system.

### C.4 UI implications

**Subaccount admin panel.** Always shows the subaccount's own approval channel configuration. Full CRUD by subaccount admin. Subaccount admin never sees grants flowing in from the org.

**Org admin panel, "Subaccounts" page.** Per subaccount, an "Approval channel sharing" section. Lists which org-owned channels are receiving approvals from this subaccount. Add or revoke per channel. The org admin does not see the subaccount's own channel configuration.

**Org admin panel, "Approval channels" page.** Lists the org's own channels. Used for approvals on org-level agents. Referenced in subaccount grants.

---

## D. Worker round-trip mechanism

**Locked: pg-boss request-reply with correlation IDs.**

Worker writes a job to `agent-spend-request` queue with a correlation ID, payload `{ ieeRunId, agentRunId, organisationId, subaccountId, agentId, intent, amountMinor, merchant, idempotencyKey }`.

Main app processes the job, runs `chargeRouterService` → `actionService.proposeAction`, writes the response to `agent-spend-response` queue with the same correlation ID, payload `{ correlationId, decision: 'approved' | 'denied' | 'pending_approval', chargeToken?, ledgerRowId, errorReason? }`.

Worker subscribes to the response queue and picks up the response when it appears.

**Deadline.** 30 seconds. If no response arrives, worker treats as denial and writes a `failed` charge row reason `'roundtrip_timeout'`.

**Worker→app boundary.** RLS context (org, subaccount) is established at the main-app boundary via `actionService.proposeAction`'s tenant args, not via DB GUCs that the worker does not set. Worker carries org and subaccount IDs in the queue payload.

**`shared/iee/actionSchema.ts` extension.** Add `spend_request` action to the worker's loop vocabulary so the audit trail in `iee_steps` is uniform.

---

## E. Spend Ledger retention

**Executed charges (status: `succeeded`, `failed`, `refunded`, `disputed`).** Indefinite retention. Financial records are not subject to the same lifecycle as debug events. Although Synthetos is not subject to formal accounting standards today, regulatory expectations for financial records are typically seven years and Synthetos may grow into customer segments where this matters.

**Shadow charges (status: `shadow_settled`).** Default 90-day retention, configurable per organisation. Shadow charges exist for trust-building during the shadow-to-live runway. Once an operator has flipped to live and accumulated real ledger history, the shadow records are no longer load-bearing. 90 days is the default because that is roughly three monthly review cycles, enough time to validate and forget.

**Implementation.** Append-only ledger at the DB level (trigger-based `RAISE EXCEPTION ON UPDATE/DELETE` for executed rows; shadow rows are deletable by a scheduled retention job). Migration sets up both the trigger and the retention job. Per-org retention override stored on the `organisations` table or a related config row.

---

## F. Approval routing destinations within a channel

**Role-based, with sensible defaults.**

A new permission, `spend_approver`, is grantable to org admins or subaccount admins.

**Default grant.** When a new Spending Budget is created, the `spend_approver` permission is granted automatically to: (a) the org admin if the budget is org-scoped; (b) the subaccount admin if the budget is subaccount-scoped. Operators can add additional approvers later.

**Approval fires to.** All users with the `spend_approver` permission relevant to the budget's scope, via the configured channels.

**Multiple approvers.** Same fan-out semantics as channels. First approval wins. Other approvers see the resolution.

**Implementation.** Add `spend_approver` to the existing permission system. Add a `spending_budget_approvers` join table for cases where the operator wants to grant approval rights to specific users beyond the role-based defaults.

---

## G. Currency support in v1

**Single currency per Spending Budget.**

A `currency` column on `spending_budgets` (ISO 4217 code, e.g. `USD`, `GBP`, `AUD`, `EUR`). Default `USD`. Set at budget creation, immutable thereafter. All charges against the budget are in that currency.

**A subaccount or org can have multiple Spending Budgets in different currencies.** A UK agency operating an AU client subaccount might have an AUD budget for client-side spending and a GBP budget for agency-side spending. Distinct budgets, distinct currencies.

**Stripe charges in the budget's declared currency.** No FX conversion in v1.

**Out of scope for v1.** Multi-currency-within-a-single-policy. Automatic FX. Settlement-currency translation in reporting (the spend dashboard shows each budget in its own currency; an aggregated cross-currency view is a follow-up).

---

## H. Refund accounting

**Refunds live in the same `agent_charges` ledger.**

A `charge_type` column on `agent_charges` with values: `purchase`, `subscription`, `top_up`, `invoice_payment`, `refund`.

A `parent_charge_id` column on `agent_charges` (nullable, foreign key to `agent_charges.id`). For refunds, this points to the original charge being refunded. For non-refunds, this is null.

A `direction` column on `agent_charges` with values: `outbound` (money leaves), `inbound_refund` (money returns).

**`amount_minor` is always positive.** The `direction` field signals the balance impact, not the sign of the amount. This avoids the bug-prone "sometimes negative, sometimes positive" pattern.

**Dashboard impact.** Refunds show as separate ledger rows linked to their parent. Net spend calculations subtract refund amounts. Per-budget spent-this-month figures factor in refunds.

**Refund as a skill.** A new skill `issue_refund` (or extend `chase_overdue`'s sibling pattern) joins the four spending primitives. `actionRegistry.ts` entry, `defaultGateLevel: 'review'` initially.

---

## I. SPT mid-workflow expiry

**Charges check SPT validity at execution time, not at policy resolution time.**

If the SPT has expired or been revoked between policy resolution and charge execution, the charge fails with a specific error code (`spt_expired` or `spt_revoked`).

**Workflow behaviour.** The workflow does not silently fail. It pauses with a HITL request of kind `spt_reconnect_required`, payload includes the affected Spending Budget, the merchant the charge was attempting, the amount, and a link to reconnect Stripe.

**Reconnect flow.** Operator reconnects Stripe via the standard `integrationConnections` reauthorization path. Once reconnected, the workflow resumes and the charge re-attempts with the fresh SPT.

**Audit trail.** The expired-SPT charge attempt writes a `failed` ledger row with reason `spt_expired`. The reconnect writes an audit event. The retried charge writes a new ledger row with its own idempotency key. Both rows are linked via `replay_of_charge_id` (mirrors the existing `replay_of_action_id` pattern).

---

## J. Default Spending Budget template

**Conservative, opt-in to live mode.**

When an operator creates a new Spending Budget, the default state is:

- `mode: 'shadow'`
- `monthly_limit_minor: 0`
- `daily_limit_minor: 0`
- `per_txn_limit_minor: 0`
- `merchant_allowlist: []`
- `approval_threshold_minor: 0` (everything goes to HITL until configured)

A "Load conservative defaults" one-click button populates: $20 per transaction, $100 per day, $500 per month, allowlist of common SaaS tooling (Namecheap, OpenAI, Anthropic, Cloudflare, Twilio, Stripe). Operator can edit before activating.

**Promotion from shadow to live.** A HITL-gated action. Operator clicks "Promote to live" on the budget, the system creates an approval request through the configured channels, the operator (or designated approver) confirms, the budget mode flips to `live`. Audit-logged.

**Why the conservative default.** The persona research shows operators are risk-averse. A new budget that defaulted to live with permissive limits would be too easy to misconfigure into a costly mistake. Defaulting to shadow with $0 limits forces the operator to consciously choose what they are authorising.

---

## K. Idempotency key shape (correction from v2 brief)

The v2 brief proposed `(skillRunId, intent)` as the idempotency key. The exploration report flagged this as insufficient. **Locked: stronger key shape.**

```
${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${intent}:${sha256(canonicaliseJson(args))}
```

Where:
- `CHARGE_KEY_VERSION` is a constant for future migration.
- `skillRunId` is the agent run that initiated the spend.
- `toolCallId` distinguishes multiple charges within one run.
- `intent` includes the mode (`charge:live` or `charge:shadow`) so shadow→live promotion creates fresh keys.
- `args` hash catches argument drift between attempts.

Stored as a UNIQUE column on `agent_charges`. Insert via `INSERT ... ON CONFLICT DO UPDATE` returning the winning row, mirroring the `compute_reservations` H-1 pattern.

Declare `idempotencyStrategy: 'locked'` on the new `actionRegistry.ts` entries.

---

## L. cost_aggregates RLS retrofit (in scope, not optional)

The exploration report flagged that `cost_aggregates` has no RLS policy today and that adding agent-spend dimensions without retrofitting RLS would leak agent spend across orgs at the read layer.

**This retrofit ships in the same migration as the new `entityType` values.** Add `organisation_id` column to `cost_aggregates`, add canonical org-isolation RLS policy modelled on `migrations/0267_agent_recommendations.sql:50-66`, add `cost_aggregates` to `server/config/rlsProtectedTables.ts`.

Backfill the `organisation_id` column for existing rows before enabling RLS. Existing aggregate rows are mostly per-subaccount or per-agent-run, both of which can be resolved to an org via foreign keys.

---

## M. Append-only enforcement on `agent_charges`

**Trigger-based DB-level enforcement.** Deviates from the prevailing app-layer pattern (`llm_requests`, `audit_events`, `mcp_tool_invocations`), but financial records are a stronger durability case.

`BEFORE UPDATE` and `BEFORE DELETE` triggers on `agent_charges` raise an exception unless:
- The row is in a non-terminal state (`pending`).
- The transition is to a terminal state (`succeeded`, `failed`, `refunded`, `disputed`, `shadow_settled`) per the state-machine guard.
- The retention job is purging an aged shadow charge.

All other UPDATEs and DELETEs raise. App-layer code that needs to make changes goes through approved paths (the charge router for status transitions, the retention job for shadow purges).

---

## N. Open question status

| Question | Status | Resolution |
|---|---|---|
| Spend denial as distinct audit reason code | Resolved | Yes. `reason: 'spend_block'` distinct from generic policy holds. |
| Worker round-trip mechanism | Resolved | pg-boss request-reply, 30-second deadline. |
| `purchase_resource` etc. allowlist namespace | Resolved | Sibling constant `SPEND_ACTION_ALLOWED_SLUGS`, concat into `ACTION_CALL_ALLOWED_SLUGS`. |
| `cost_aggregates` RLS retrofit timing | Resolved | Same migration as new entityType values. |
| Slack one-tap blocker for v1 | Resolved | Out of scope v1. In-app channel only. ApprovalChannel interface designed to absorb later. |
| Spend in PendingApprovalCard fourth lane | Resolved | Yes. Add as fourth lane alongside `client | major | internal`. |
| BriefApprovalCard dual surface | Resolved | Queue-only for v1. In-conversation card is a follow-up. |
| `LinkedEntityType` value name | Resolved | `'spend_ledger'`. |
| Append-only enforcement on `agent_charges` | Resolved | Trigger-based DB-level (Section M). |
| Shadow→live promotion semantics | Resolved | Policy-level flip, not retroactive. Old shadow charges remain `shadow_settled`. |
| Budget terminology collision | Resolved | Compute Budget vs Spending Budget (Section B). |
| Subaccount-org approval channel inheritance | Resolved | Subaccount-owned by default, org grants opt-in (Section C). |
| Spend Ledger retention | Resolved | Indefinite executed, 90 days shadow (Section E). |
| Approval routing destinations | Resolved | Role-based `spend_approver` permission (Section F). |
| Currency support v1 | Resolved | Single currency per budget (Section G). |
| Refund accounting | Resolved | Same ledger, charge_type 'refund' (Section H). |
| SPT mid-workflow expiry | Resolved | Fail charge, pause workflow with reconnect prompt (Section I). |
| Default Spending Budget template | Resolved | Shadow + $0 limits, one-click conservative defaults (Section J). |

No open questions remain blocking the spec.

---

## O. Updated chunk plan

Chunk 1 is new (the rename). Chunks 2-13 follow the exploration report's plan with adjustments for the addendum.

1. **Compute Budget rename.** All schema, code, type, function, event, UI string renames per Section B.4. Migrations rename tables and columns. Drizzle schema files renamed. No new functionality. Ships fully reviewed before any new spending code lands.
2. **Schema + RLS for new tables.** `spending_budgets`, `spending_policies`, `agent_charges`, three approval-channel tables. Canonical RLS policies. `cost_aggregates` RLS retrofit (Section L). Append-only triggers on `agent_charges` (Section M). Both migrations.
3. **SPT vault and connection lifecycle.** `stripe_agent` providerType, refresh case in `connectionTokenService`, `revokeSubaccountConnection` sibling, adapter-side `accessToken` reading.
4. **Charge router pure.** Policy resolution, cap math, idempotency key build, mode discrimination, intent normalisation. Heavy unit-test chunk.
5. **Charge router impure.** Stripe call, ledger insert, state-machine writes, `agent_execution_events` cross-ref. State machine wired into `shared/stateMachineGuards.ts`.
6. **Action registry and skill handlers.** Four new spend skills (`pay_invoice`, `purchase_resource`, `subscribe_to_service`, `top_up_balance`) plus `issue_refund`. `spendsMoney: true` flag on `ActionDefinition`. `requiredIntegration: 'stripe_agent'`. Dual registration in `ACTION_REGISTRY` and `SKILL_HANDLERS`.
7. **Policy engine extension.** `spendDecision` field on `PolicyDecision`, `higherGate` merge, planning-phase advisory preview (`previewSpendForPlan` pure helper).
8. **HITL surface.** `metadata_json.category: 'spend'`, `ReviewQueuePage` `renderSpendPayload` branch, `PendingApprovalCard` fourth lane.
9. **ApprovalChannel interface and in-app implementation.** Channel adapter interface, `InAppApprovalChannel` as first conformant implementation, three approval-channel tables wired up, fan-out and first-response-wins logic, audit trail for grants and revocations.
10. **Workflow engine wiring.** `SPEND_ACTION_ALLOWED_SLUGS`, `reviewKind: 'spend_approval'`, workflow pause-resume integration.
11. **Worker round-trip.** `agent-spend-request` and `agent-spend-response` pg-boss queues, correlation IDs, 30-second deadline. `shared/iee/actionSchema.ts` extension. `iee_steps` integration.
12. **Stripe webhook ingestion.** `stripeAgentWebhookService.ts`, `/api/webhooks/stripe-agent` route, signature verification, dedupe, reconciliation against `paymentReconciliationJob`.
13. **Cost-aggregation parallel writer.** `agentSpendAggregateService` writing to `cost_aggregates` with new entityType values. Dashboard query routes.
14. **Admin UI.** Spending Budget editor, ledger dashboard, approval-channel configuration screens (subaccount and org variants), grant management screen, kill switches.
15. **Shadow-to-live promotion flow.** HITL-gated promotion action, audit logging, channel notification.
16. **Default templates and onboarding.** Conservative-defaults one-click template (Section J), per-org retention configuration UI, role-based approver grants.

Estimated wall-clock: 4 weeks for a single experienced builder, 2.5-3 weeks if chunks 4-5 and 13-14 parallelise.

---

## P. Spec-coordinator handoff inputs

When spec-coordinator runs, the input package is:

1. `docs/agentic-commerce-brief.md` (v2) — the strategic frame.
2. `docs/agentic-commerce-exploration-report.md` — the codebase reconnaissance.
3. `docs/agentic-commerce-brief-addendum.md` (this document, v3) — stakeholder-resolved decisions.

These three documents together are authoritative. Where they conflict, this addendum wins, then the exploration report, then the v2 brief. Spec-coordinator should call out any unresolvable conflict back to the brief author before writing the spec.
