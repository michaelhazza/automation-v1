# Agentic Commerce — Technical Spec

**Build slug:** `agentic-commerce`
**Branch:** `claude/agentic-commerce-spending`
**Classification:** Major
**Status:** Draft — awaiting spec-reviewer
**Source documents:** `docs/agentic-commerce-brief.md` (v3), `docs/agentic-commerce-exploration-report.md`, `docs/agentic-commerce-brief-addendum.md` (v3)
**Date:** 2026-05-03

---

## Table of Contents

1. [Overview](#1-overview)
2. [Glossary](#2-glossary)
3. [Domain Model](#3-domain-model)
4. [Charge Lifecycle State Machine](#4-charge-lifecycle-state-machine)
5. [Data Model](#5-data-model)
6. [Service Architecture](#6-service-architecture)
7. [Integration Boundaries](#7-integration-boundaries)
8. [Contracts](#8-contracts)
9. [Execution-Safety Contracts](#9-execution-safety-contracts)
10. [System Invariants](#10-system-invariants)
11. [Permissions and RLS](#11-permissions-and-rls)
12. [Execution Model](#12-execution-model)
13. [Approval Channels](#13-approval-channels)
14. [Shadow Mode Semantics](#14-shadow-mode-semantics)
15. [Kill Switch](#15-kill-switch)
16. [Edge-Case Semantics](#16-edge-case-semantics)
17. [Chunk Plan](#17-chunk-plan)
18. [File Inventory](#18-file-inventory)
19. [Testing Posture](#19-testing-posture)
20. [Deferred Items](#20-deferred-items)
21. [Out of Scope](#21-out-of-scope)

---

## 1. Overview

Agentic Commerce gives Automation OS agents real spending authority. Every skill that currently stops at "hand a URL to a human" becomes a skill that completes the transaction autonomously, within operator-defined policy limits, with a full audit trail, and with a one-tap kill switch.

The build adds six primitives to the platform: a **Spending Budget** (the operator-facing spending container), a **Spending Policy** (the rules object), an **SPT Vault** (per-sub-account Stripe Shared Payment Token storage), a **Charge Router** (policy enforcement + Stripe execution service), a **Spend Ledger** (append-only charge record table), and a **Kill Switch** (three-level revocation). These integrate with the existing HITL queue, workflow engine, policy engine, cost aggregation surface, and IEE worker via the pg-boss transport already in place.

Shadow mode ships day one, defaulted on for every new Spending Budget. Agents run the full execution path — policy check, allowlist match, threshold compare, HITL routing — but the Stripe call is replaced by a ledger write. Operators accumulate real audit evidence before flipping to live. Shadow-to-live promotion is itself a HITL-gated action.

The build also renames the existing LLM cost system from "Budget" to "Compute Budget" (Chunk 1) so the two budget concepts are unambiguous in code, UI, and documentation.

**Effort:** 4 weeks single builder; 2.5-3 weeks with parallelism on Chunks 4-5 and 13-14. 16 chunks, mandatory pipeline: spec-reviewer, architect, chunked build, spec-conformance, pr-reviewer, adversarial-reviewer, finalisation-coordinator.

## 2. Glossary

The vocabulary lock below is authoritative. Any prose in this spec, migration comments, UI labels, or event names that contradicts these definitions is wrong.

### Compute Budget system (renamed from "Budget")

| Term | Meaning |
|---|---|
| **Compute Budget** | Umbrella concept. LLM and compute cost ceiling. Formerly "Budget." |
| **Compute Reservation** | Pre-flight row created before an LLM call. Formerly "BudgetReservation." |
| **Compute Limit** | Single cap (monthly/daily/hourly/per-minute). |
| **Compute Context** | Resolution context (org, subaccount, agent, run). Formerly "BudgetContext." |
| **Compute Budget Exceeded Error** | Typed error. Formerly "BudgetExceededError." |
| **Compute Budget Lock** | Advisory lock taken during reservation. Formerly "OrgBudgetLock." |

### Spending Budget system (new)

| Term | Meaning |
|---|---|
| **Spending Budget** | Umbrella operator concept. Accounting container holding ownership scope, currency, name, monthly-spend alert threshold, and kill-switch timestamp. Limits, mode, allowlist, and thresholds live on the Spending Policy, not here. |
| **Spending Policy** | Rules object inside a Spending Budget. Sole owner of Spending Limits, Merchant Allowlist, Approval Threshold, Spending Mode, approval-expiry window, and policy version. Foreign-keyed one-to-one from `spending_budgets`. |
| **Spending Limit** | Single cap (per-transaction, daily, monthly). |
| **Spending Mode** | `shadow` or `live`. Per Spending Policy. |
| **Charge** | Unit row in `agent_charges`. Every money-movement attempt, regardless of outcome. |
| **Charge Status** | `proposed`, `pending_approval`, `approved`, `executed`, `succeeded`, `failed`, `blocked`, `denied`, `shadow_settled`, `refunded`, `disputed`. |
| **Charge Intent** | Human-readable description of what the spend is for. |
| **Charge Type** | `purchase`, `subscription`, `top_up`, `invoice_payment`, `refund`. |
| **Spend Ledger** | The `agent_charges` table. System source of truth for agent intent and audit trail. |
| **Merchant Allowlist** | Approved vendor identifiers per Spending Policy. |
| **Approval Threshold** | Amount (in `amount_minor`) above which charges route to HITL. |
| **Kill Switch** | Three-level revocation: per-policy, per-sub-account, per-org. |
| **Shared Payment Token (SPT)** | Stripe-issued credential. Stored as `accessToken` on a `stripe_agent` `integrationConnection`. |
| **SPTConnection** | The `integrationConnection` row where `providerType = 'stripe_agent'`. |
| **Charge Router** | Server-side service that every spend-enabled skill calls. Lives exclusively in the main app. |
| **Spend Intent** | Logical operation grouping one or more Charges. Multiple retried Charges share one `intent_id`. |
| **spend_approver** | Permission role. Grantable to org admins and sub-account admins. Default-granted to the relevant admin when a Spending Budget is created. |

### Do not use

- "Budget" alone — ambiguous. Use "Compute Budget" or "Spending Budget."
- "Agent Budget" — not a term in this system.
- "Spending Budget" to mean just the rules — that is the "Spending Policy."

## 3. Domain Model

### Entity relationships

```
Organisation        → SpendingBudgets          (zero to many; org-level budgets)
SubAccount          → SpendingBudgets          (zero to many; subaccount-level budgets)
Agent               → SpendingBudget           (optional, zero or one per agent)
SpendingBudget      → SpendingPolicy           (one-to-one; the rules object)
SpendingBudget      → Charges                  (one-to-many via agent_charges)
Charge              → ApprovalRequest          (zero or one; fires when amount > approval_threshold)
SubAccount          → SPTConnection            (zero or one; providerType = 'stripe_agent' in integrationConnections)
SubAccount          → SubaccountApprovalChannels  (one-to-many)
Organisation        → OrgApprovalChannels      (one-to-many)
Organisation        → OrgSubaccountChannelGrants  (one-to-many; bridge for fan-out)
SpendingBudget      → SpendingBudgetApprovers  (one-to-many; explicit approver grants beyond role default)
```

### Key distinctions

- **Spending Budget** is the accounting container (ownership scope, currency, name, monthly-spend alert threshold, kill-switch timestamp). It does NOT carry limits, mode, allowlist, or thresholds — those live exclusively on `spending_policies`. One per agent, or per sub-account (one per currency), or org-level (for cross-sub-account agents like Portfolio Health Agent).
- **Spending Policy** is the rules object inside the budget. It owns Spending Limits (per-txn, daily, monthly), Spending Mode (`shadow`/`live`), Merchant Allowlist, Approval Threshold, approval-expiry window, and policy version. Never accessed directly by skills — only via the Charge Router.
- **Charge** is the unit of record. Every attempt regardless of outcome.
- **Spend Ledger** (`agent_charges`) is the table of all Charges. System source of truth for agent intent. Stripe is the financial source of truth for payment state.
- **SPTConnection** is the Stripe-issued credential stored as `accessToken` in `integrationConnections` (`providerType = 'stripe_agent'`). One per sub-account. Scoped to the Spending Budget for that sub-account.

### Portfolio Health Agent cross-sub-account model

The Portfolio Health Agent holds a Spending Budget at the org level with a Spending Policy permitting retention gifts. Each gift Charge attributes to the recipient sub-account in `agent_charges.subaccount_id`. This solves the cross-sub-account spending need without breaking per-sub-account isolation.

## 4. Charge Lifecycle State Machine

### States

| State | Type | Description |
|---|---|---|
| `proposed` | non-terminal | Entry state. Written by Charge Router before any policy evaluation. |
| `pending_approval` | non-terminal | Over Approval Threshold. Waiting for HITL response. Reserves amount against limits. |
| `approved` | non-terminal | Either auto-approved (under threshold) or HITL-approved. Reserves amount against limits. |
| `executed` | non-terminal | Stripe API call made (live mode). Awaiting webhook confirmation. Reserves amount until terminal. |
| `blocked` | terminal | System-enforced denial: allowlist miss, limit exceeded, Kill Switch active, or SPT expired/revoked. |
| `denied` | terminal | Human rejection via HITL. |
| `shadow_settled` | terminal | Shadow mode execution. No Stripe call. Success returned to caller. |
| `succeeded` | terminal | Stripe webhook confirmed payment. |
| `failed` | terminal | Stripe error, SPT expired, roundtrip timeout, or execution timeout. |
| `refunded` | terminal | Refund issued against a succeeded charge. |
| `disputed` | non-terminal | Chargeback opened. Treated as in-dispute pending resolution. |

### Transitions

Evaluation order from `proposed` is fixed: (1) Kill Switch / SPT validity, (2) Merchant Allowlist, (3) Spending Limits including in-flight reserved capacity, (4) Approval Threshold. The first failing gate determines the outgoing transition. Limits set to `0` are treated as unset (no cap) and never trip the limit gate.

```
proposed → blocked             (Kill Switch active, SPT expired/revoked, allowlist miss, or limit exceeded)
proposed → pending_approval    (all gates pass; amount > approval_threshold)
proposed → approved            (all gates pass; amount <= approval_threshold, auto-approved)
pending_approval → approved    (HITL operator approved)
pending_approval → denied      (HITL operator rejected)
approved → executed            (live mode — Stripe call made)
approved → shadow_settled      (shadow mode — no Stripe call, success returned)
executed → succeeded           (Stripe webhook: payment confirmed)
executed → failed              (Stripe error, SPT error, execution_timeout)
succeeded → refunded           (refund issued)
succeeded → disputed           (chargeback opened)
disputed → succeeded           (chargeback resolved in merchant's favour — Stripe webhook)
disputed → refunded            (chargeback resolved in customer's favour — Stripe webhook)
```

### Rules

- `blocked`, `denied`, `failed`, `shadow_settled`, `succeeded`, `refunded` are terminal. No further transitions. No automatic retry. **One narrow exception:** an inbound Stripe webhook MAY override a row currently in `failed` if Stripe reports a `succeeded` outcome for that `provider_charge_id` (only possible when the row was failed via `roundtrip_timeout` or `execution_timeout` but the Stripe call actually succeeded). This `failed → succeeded` override is the ONLY permitted post-terminal transition; it is whitelisted in `stateMachineGuards` and the DB trigger, gated on the inbound transition originating from `stripeAgentWebhookService` (server-side caller identity check). All other post-terminal transitions raise. See §8.6 precedence rule 4 and §9.4 post-terminal carve-out.
- `failed` is terminal for the row. A retry is a new Charge row under the same `intent_id`.
- All non-terminal states (`pending_approval`, `approved`, `executed`, `disputed`) reserve their `amount_minor` against Spending Limits until the row reaches a terminal state. Reserved capacity is consistent across §9.3 and §16.2 — anything not yet terminal counts.
- An `approved` Charge that does not transition to `executed` or `shadow_settled` within the execution window is auto-marked `failed` with `reason = 'execution_timeout'`. The execution window is `EXECUTION_TIMEOUT_MINUTES` (a global constant in `server/config/spendConstants.ts`, default `30`). `expires_at` is set at the `proposed → approved` transition as `NOW() + EXECUTION_TIMEOUT_MINUTES`. The execution-window timeout job (registered in `server/jobs/`) scans `agent_charges WHERE status IN ('approved','executed') AND expires_at < NOW()` every minute and transitions matching rows to `failed`.
- A `pending_approval` Charge that receives no response within `approval_expires_at` is auto-marked `denied` with `reason = 'approval_expired'`.
- When a Kill Switch fires, all `pending_approval` Charges for that scope are immediately auto-cancelled (transition to `denied` with `reason = 'kill_switch'`). In-flight `executed` Charges continue to their Stripe outcome.
- Transitions are enforced by `shared/stateMachineGuards.ts::assertValidTransition`. Every code path that writes a status update calls this guard before the UPDATE.
- Status transitions on `agent_charges` are additionally enforced by DB-level triggers (see §5.1). The only permitted mutations are lifecycle state transitions and the shadow-charge retention purge.

### Idempotency of state transitions

The concurrency guard is optimistic: `UPDATE agent_charges SET status = $newStatus WHERE id = $id AND status = $expectedPreviousStatus`. Zero rows updated = the transition was lost to a race; caller receives the current row and resolves per §9.3.

## 5. Data Model

### 5.1 New Tables

All new tables follow the canonical RLS pattern from `migrations/0267_agent_recommendations.sql:50-66` and `DEVELOPMENT_GUIDELINES.md §26-91`. Every table ships with its RLS policy in the same migration that creates it.

#### `spending_budgets`

Umbrella accounting container. One per agent (primary), or per sub-account (at most one per currency), or org-level for cross-sub-account agents. Cardinality is enforced by the unique constraints in §9.5.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `subaccount_id` | uuid NULL FK → subaccounts | NULL = org-scoped budget |
| `agent_id` | uuid NULL FK → agents | NULL = sub-account-wide budget |
| `currency` | text NOT NULL | ISO 4217. Set at creation, immutable. |
| `name` | text NOT NULL | Operator-provided label |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |
| `monthly_spend_alert_threshold_minor` | integer NULL | Fires a warning alert when net monthly spend exceeds this value. NULL = no alert. |
| `disabled_at` | timestamptz NULL | Kill Switch: per-policy revocation timestamp |

#### `spending_policies`

Rules object. One-to-one with `spending_budgets`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `spending_budget_id` | uuid NOT NULL FK → spending_budgets | |
| `mode` | text NOT NULL | `shadow` or `live` |
| `per_txn_limit_minor` | integer NOT NULL | Per-transaction cap on `amount_minor`. `0` = unset (no per-txn cap; gating is left to `approval_threshold_minor`). |
| `daily_limit_minor` | integer NOT NULL | Cap on net daily spend (settled outbound charges minus inbound refunds plus in-flight reserved). `0` = unset (no daily cap). |
| `monthly_limit_minor` | integer NOT NULL | Cap on net monthly spend (same accounting as daily). `0` = unset (no monthly cap). |
| `approval_threshold_minor` | integer NOT NULL | Charges with `amount_minor > approval_threshold_minor` route to HITL. `0` routes every positive charge to HITL. |
| `merchant_allowlist` | jsonb NOT NULL | Array of `{ id: string \| null, descriptor: string, source: 'stripe_id' \| 'descriptor' }`. Identical shape to the §8.5 SpendingPolicy contract and to the §8.1 ChargeRouterRequest `merchant` field. `id` is the Stripe merchant ID when available; `descriptor` is the normalised string fallback (always present). |
| `approval_expires_hours` | integer NOT NULL | Default 24 |
| `version` | integer NOT NULL | Incremented on every update; used for policy_changed revalidation |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |
| `velocity_config` | jsonb NULL | Reserved for future rate-limit config (schema must not preclude it) |
| `confidence_gate_config` | jsonb NULL | Reserved for future confidence-gating (schema must not preclude it) |

#### `agent_charges`

Spend Ledger. Append-only for non-terminal rows. DB-level trigger prevents UPDATE/DELETE except for lifecycle state transitions and shadow-purge retention job.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `subaccount_id` | uuid NULL FK → subaccounts | Attribution target; may differ from budget owner for cross-sub-account agents |
| `spending_budget_id` | uuid NOT NULL FK → spending_budgets | |
| `spending_policy_id` | uuid NOT NULL FK → spending_policies | Snapshot of policy at charge time (via `spending_policies.id`) |
| `policy_version` | integer NOT NULL | Snapshot of `spending_policies.version` at charge time |
| `agent_id` | uuid NULL | Initiating agent |
| `skill_run_id` | uuid NULL | The agent run that initiated this charge |
| `action_id` | uuid NULL FK → actions | The action row from the gate path |
| `idempotency_key` | text NOT NULL UNIQUE | `${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${intent}:${sha256(canonicaliseJson(args))}` |
| `intent_id` | uuid NOT NULL | Groups retries. All charges for the same logical operation share one `intent_id`. |
| `intent` | text NOT NULL | Human-readable description of the spend |
| `charge_type` | text NOT NULL | `purchase`, `subscription`, `top_up`, `invoice_payment`, `refund` |
| `direction` | text NOT NULL | `outbound` or `inbound_refund` |
| `amount_minor` | integer NOT NULL | Always positive. Direction field signals balance impact. |
| `currency` | text NOT NULL | ISO 4217 |
| `merchant_id` | text NULL | Stripe merchant ID where available |
| `merchant_descriptor` | text NULL | Normalised string fallback |
| `status` | text NOT NULL | See §4 state machine |
| `mode` | text NOT NULL | `shadow` or `live` at execution time |
| `provider_charge_id` | text NULL | Stripe charge/payment-intent ID; set after `executed` |
| `spt_connection_id` | uuid NULL FK → integration_connections | The SPT used |
| `decision_path` | jsonb NOT NULL | Policy evaluation trace: allowlist result, limit check, threshold compare, mode |
| `failure_reason` | text NULL | For terminal `failed`/`blocked`/`denied` states |
| `parent_charge_id` | uuid NULL FK → agent_charges | For refunds: points to original charge |
| `replay_of_charge_id` | uuid NULL FK → agent_charges | For retries after SPT expiry |
| `provenance` | text NULL | `workflow`, `manual`, `scheduled`, `retry` — reserved, not required for v1 logic |
| `approved_at` | timestamptz NULL | |
| `executed_at` | timestamptz NULL | |
| `settled_at` | timestamptz NULL | |
| `expires_at` | timestamptz NULL | Execution window deadline; auto-fail if exceeded |
| `approval_expires_at` | timestamptz NULL | Approval expiry; auto-deny if exceeded |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |

**Append-only enforcement:** `BEFORE UPDATE` trigger raises unless the UPDATE is part of a valid lifecycle state transition (see §4) AND only mutates columns from the explicit mutable-on-transition allowlist below. The valid-transition set includes the carved-out `failed → succeeded` post-terminal override, gated on the caller being `stripeAgentWebhookService` (per §4 rules / §9.4). `BEFORE DELETE` trigger raises unless invoked by the retention job purging a `shadow_settled` row past its retention date. Deviates from the app-layer precedent of `llm_requests`/`audit_events` — financial records warrant stronger durability.

**Mutable-on-transition allowlist** (the only columns the trigger permits an UPDATE to write):

- `status` (the transition itself)
- `action_id` (set when transitioning to `pending_approval` if HITL action created)
- `provider_charge_id` (set when transitioning to `executed`)
- `spt_connection_id` (set when transitioning to `executed` or `shadow_settled`)
- `decision_path` (extended at each gate evaluation; append-only JSON merge at the trigger level)
- `failure_reason` (set when transitioning to `blocked`, `denied`, or `failed`)
- `approved_at` (set when transitioning to `approved`)
- `executed_at` (set when transitioning to `executed` or `shadow_settled`)
- `settled_at` (set when transitioning to `succeeded`, `refunded`, or `failed`)
- `updated_at` (always)

Every other column on `agent_charges` (organisation_id, subaccount_id, spending_budget_id, spending_policy_id, policy_version, agent_id, skill_run_id, idempotency_key, intent_id, intent, charge_type, direction, amount_minor, currency, merchant_id, merchant_descriptor, mode, parent_charge_id, replay_of_charge_id, provenance, expires_at, approval_expires_at, created_at) is immutable post-insert and the trigger raises if any UPDATE attempts to change it.

#### `subaccount_approval_channels`

Per-sub-account channel configuration. Owned and managed by the sub-account admin.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `subaccount_id` | uuid NOT NULL FK → subaccounts | |
| `channel_type` | text NOT NULL | `in_app` in v1; `slack`, `email`, `telegram` deferred |
| `config` | jsonb NOT NULL | Channel-specific configuration |
| `enabled` | boolean NOT NULL DEFAULT true | |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |

#### `org_approval_channels`

Org-owned channels. Used for approvals on org-level agents and for granted sub-account fan-out.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `channel_type` | text NOT NULL | `in_app` in v1 |
| `config` | jsonb NOT NULL | |
| `enabled` | boolean NOT NULL DEFAULT true | |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |

#### `org_subaccount_channel_grants`

Bridge: org admin grants an org-owned channel to receive approvals from a specific sub-account.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `subaccount_id` | uuid NOT NULL FK → subaccounts | Target sub-account |
| `org_channel_id` | uuid NOT NULL FK → org_approval_channels | |
| `granted_by_user_id` | uuid NOT NULL | |
| `active` | boolean NOT NULL DEFAULT true | Deactivate on revoke; never delete |
| `created_at` | timestamptz NOT NULL | |
| `revoked_at` | timestamptz NULL | |

#### `spending_budget_approvers`

Explicit per-user approver grants beyond the role-based default.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisation_id` | uuid NOT NULL FK → organisations | RLS anchor |
| `spending_budget_id` | uuid NOT NULL FK → spending_budgets | |
| `user_id` | uuid NOT NULL | |
| `created_at` | timestamptz NOT NULL | |

### 5.2 Schema Modifications

#### `integration_connections.providerType`

Add `'stripe_agent'` to the enum. SPT stored as `accessToken` (encrypted via `connectionTokenService`). Token expiry in `tokenExpiresAt` + `claimedAt` + `expiresIn`. Revocation via existing `revokeOrgConnection` (org scope) and new `revokeSubaccountConnection` (sub-account scope). Webhook secret stored in `configJson.webhookSecret`.

**New `case 'stripe_agent':` in `connectionTokenService.performTokenRefresh`.** Uses Stripe's token rotation endpoint via platform-level keys, not per-connection client creds. Bypasses the existing `clientIdEnc`/`clientSecretEnc`/`tokenUrl` reads for this provider type.

**`refreshIfExpired` buffer:** parameterise the 5-minute buffer per provider type. Stripe SPT rotation may need a longer pre-roll.

#### `cost_aggregates`

Add `organisation_id uuid NOT NULL` column. Add canonical org-isolation RLS policy (same migration as the first new `entityType` values). Add to `server/config/rlsProtectedTables.ts`. Backfill `organisation_id` for existing rows (resolvable via foreign keys through `entityId`).

New `entityType` values (comment-only migration, precedent: `0186_cost_aggregates_source_type_dimension.sql`):
- `'agent_spend_subaccount'`
- `'agent_spend_org'`
- `'agent_spend_run'`

#### `actions`

No schema change. Write `metadata_json.category: 'spend'` at spend action creation time to enable HITL filtering. Existing `actions.actionCategory` enum is not modified.

#### `organisations`

Add `shadow_charge_retention_days integer NOT NULL DEFAULT 90`. Source-of-truth for the per-org shadow-retention window consumed by the shadow charge retention purge job (see §14, §17 Chunk 16). Migration ships in Chunk 2 alongside the new tables.

#### `shared/types/agentExecutionLog.ts`

Add `'spend_ledger'` to `LinkedEntityType` union.

#### `shared/iee/actionSchema.ts`

Add `spend_request` action to the IEE worker's loop vocabulary (uniform audit trail in `iee_steps`).

### 5.3 RLS Coverage

| Table | RLS Pattern | Mechanism | rlsProtectedTables.ts entry |
|---|---|---|---|
| `spending_budgets` | Canonical org-isolation | `organisation_id = current_setting('app.organisation_id')::uuid` | Yes |
| `spending_policies` | Canonical org-isolation | Same | Yes |
| `agent_charges` | Canonical org-isolation | Same | Yes |
| `subaccount_approval_channels` | Canonical org-isolation | Same | Yes |
| `org_approval_channels` | Canonical org-isolation | Same | Yes |
| `org_subaccount_channel_grants` | Canonical org-isolation | Same | Yes |
| `spending_budget_approvers` | Canonical org-isolation | Same | Yes |
| `integration_connections` (stripe_agent rows) | Already protected by P3B principal-scoped policies | Existing policies apply to new `providerType` value | No new entry needed |
| `cost_aggregates` | Canonical org-isolation added in this build | `organisation_id` column added + policy | Yes (new) |

**Sub-account visibility within an org** is enforced at the app layer (service-level `eq(table.subaccountId, ctx.subaccountId)` predicates), not pushed into RLS. This follows the prevailing pattern in `DEVELOPMENT_GUIDELINES.md`.

## 6. Service Architecture

### 6.1 New Services

All new services follow the mandatory pure/impure split: `*ServicePure.ts` contains all decision logic (pure functions, no DB/network imports); `*Service.ts` contains the DB writes, Stripe calls, and pg-boss jobs. This is enforced by `verify-pure-helper-convention.sh`.

#### `chargeRouterService.ts` + `chargeRouterServicePure.ts`

The single entry point for all money movement. Every spend-enabled skill calls `chargeRouterService.proposeCharge(input)`. No skill calls Stripe directly.

**Pure layer responsibilities:**
- Policy evaluation: allowlist match, limit check (per-txn / daily / monthly including reserved capacity), threshold compare, mode resolution.
- Idempotency key construction: `buildChargeIdempotencyKey(skillRunId, toolCallId, intent, args)`.
- Decision output: `{ outcome: 'approved' | 'blocked' | 'pending_approval', reason?, reservedMinor }`.
- Planning-phase advisory: `previewSpendForPlan(plan, policyRules)` — pure, returns per-action `would_auto | would_review | would_block | over_budget`. Called from the agent execution planning prelude; advisory only, never blocks execution.

**Impure layer responsibilities:**
- Write `proposed` charge row before any other action.
- Call pure layer to get decision.
- On `blocked`: write `blocked` row, return denial to caller.
- On `pending_approval`: write `pending_approval` row, enqueue HITL action via `actionService.proposeAction`, suspend (return `pending_approval` status to workflow engine).
- On `approved` + live mode + **main-app-direct execution path** (merchant supports a direct Stripe API call — e.g. `pay_invoice` against Stripe Invoices, `issue_refund` against Stripe Refunds): the main app calls Stripe via the SPT, writes the `executed` row WITH `provider_charge_id` populated, and returns `{ outcome: 'executed', chargeId, providerChargeId }` to the caller (or via `agent-spend-response` for worker-originated requests).
- On `approved` + live mode + **worker-hosted-form execution path** (merchant requires filling a hosted payment form — e.g. `purchase_resource` from a Playwright loop, `subscribe_to_service` against a vendor signup form): the main app writes the `executed` row WITHOUT `provider_charge_id` (left NULL until completion is reported), returns `chargeToken` (the SPT) plus `ledgerRowId` to the worker via `agent-spend-response`. The worker then fills the merchant's form, observes the result, and reports completion back via the `WorkerSpendCompletion` job (§8.7) which updates the row with `provider_charge_id`. The Stripe webhook still fires later to confirm the payment and transition `executed → succeeded`.
- The execution-path choice is per-skill: declared as `executionPath: 'main_app_stripe' | 'worker_hosted_form'` on each spend-skill `ActionDefinition` entry in `actionRegistry.ts`. `pay_invoice` and `issue_refund` use `main_app_stripe`. `purchase_resource`, `subscribe_to_service`, `top_up_balance` use `worker_hosted_form`.
- On `approved` + shadow mode: write `shadow_settled` row, return success to caller (same response shape as live; no Stripe call regardless of execution path).
- Emit `'spend_ledger'` cross-reference event on `agent_execution_events` for every attempt.
- After HITL approval: re-evaluate policy (policy may have changed), block if policy now denies.

#### `spendingBudgetService.ts` + `spendingBudgetServicePure.ts`

CRUD for Spending Budgets and Spending Policies. Version-increments the policy on every update. Handles shadow-to-live promotion (creates HITL action, flips mode on approval). Manages the conservative-defaults template.

#### `sptVaultService.ts`

SPT lifecycle helpers on top of `connectionTokenService`. Handles the `stripe_agent` provider-type refresh case, `revokeSubaccountConnection`, and `refreshIfExpired` with a per-provider buffer. Routes Stripe token rotation through platform-level keys (not per-connection client creds).

#### `agentSpendAggregateService.ts`

Parallel writer to `costAggregates`. Accepts a settled `Charge` record and upserts `agent_spend_subaccount`, `agent_spend_org`, and `agent_spend_run` dimension rows. Must not be called from `costAggregateService.upsertAggregates` — kept in a separate file to prevent accidental commingling with LLM cost rollups.

#### `stripeAgentWebhookService.ts`

Processes inbound Stripe webhook events for agent-initiated charges. Called from the new webhook route. Responsibilities: signature verification against per-connection webhook secret, deduplication via `webhookDedupeStore`, state-machine transition (`executed → succeeded/failed/refunded/disputed`), alert emission for mismatch or delay.

#### `approvalChannelService.ts` + `approvalChannelServicePure.ts`

Channel adapter framework. Owns the approval state machine (not the HITL queue itself). Responsibilities: fan-out to all configured channels on approval request, first-response-wins resolution, "resolved by" notification to losing channels, grant/revoke lifecycle for `org_subaccount_channel_grants`. In v1 ships with `InAppApprovalChannel` only.

### 6.2 Modified Services

#### `computeBudgetService.ts` (renamed from `budgetService.ts`)

Rename only. No functional change. All internal references updated. Tables renamed via migration.

#### `connectionTokenService.ts`

Add `case 'stripe_agent':` in `performTokenRefresh`. Parameterise `refreshIfExpired` buffer per provider. No other changes.

#### `integrationConnectionService.ts`

Add `revokeSubaccountConnection(subaccountId, organisationId, providerType)` sibling to existing `revokeOrgConnection`. No other changes.

#### `stripeAdapter.ts`

In the agent spend path, read the SPT from `accessToken` via `connectionTokenService.getAccessToken(conn)` (triggers auto-refresh). The existing checkout path reads from `secretsRef` unchanged.

#### `policyEngineService.ts` + `policyEngineServicePure.ts`

Add `spendDecision` field to `PolicyDecision` shape. Evaluated when `ActionDefinition.spendsMoney === true`. Pure layer: `evaluateSpendPolicy(policyRules, amount, merchant, mode)` returns `spendDecision`. Impure layer: `higherGate()` merges `spendDecision` into the overall `decision` — highest restriction wins.

#### `actionService.ts`

`resolveGateLevel()` consumes `spendDecision` from `PolicyDecision` in the existing `GATE_PRIORITY` merge. No structural changes to the gate-resolution path.

#### `proposeAction.ts` (middleware)

Add `spend_block` as a distinct audit reason code on the security event written when spend policy blocks an action. Distinguishes spend-policy holds from generic policy holds in the audit log.

#### `agentExecutionService.ts`

In the planning prelude (`isComplexRun()` path), after `parsePlan()`, call `chargeRouterServicePure.previewSpendForPlan(plan, policyRules)`. Inject the advisory result into the `<system-reminder>` block at `:2411-2414`. Fail-open: if preview throws, log and continue. No blocking.

#### `actionRegistry.ts`

- Add `spendsMoney: boolean` to `ActionDefinition` type.
- Add `executionPath: 'main_app_stripe' | 'worker_hosted_form'` to `ActionDefinition` type for spend-money entries (per §6.1).
- Add `requiredIntegration: 'stripe_agent'` to the five new skill entries.
- Add five new skill entries (see §7.1).
- Add `SPEND_ACTION_ALLOWED_SLUGS` constant, concatenated into `ACTION_CALL_ALLOWED_SLUGS`.

#### `skillExecutor.ts`

Add `SKILL_HANDLERS` entries for each of the five new spend skills. Must match `ACTION_REGISTRY` entries 1:1 (dual-registration rule).

#### `agentExecutionEventService.ts`

Accept `'spend_ledger'` as a valid `linkedEntityType` in event emission.

#### `costAggregateService.ts`

Add comment update for new `entityType` values (mirrors `0186` pattern). No logic changes.

#### `rlsProtectedTables.ts`

Add entries for `spending_budgets`, `spending_policies`, `agent_charges`, `subaccount_approval_channels`, `org_approval_channels`, `org_subaccount_channel_grants`, `spending_budget_approvers`, and `cost_aggregates`.

#### `ReviewQueuePage.tsx`

Add `renderSpendPayload(item)` branch in the payload renderer keyed on `item.reviewPayloadJson.actionType` matching a spend skill slug. Renders: merchant, amount (formatted from `amount_minor` + `currency`), Charge Intent, SPT last4, Approve/Deny buttons.

#### `PendingApprovalCard.tsx`

Add `spend` as a fourth lane alongside `client | major | internal`.

#### `workflowEngineService.ts` + `actionCallAllowlist.ts`

Add `SPEND_ACTION_ALLOWED_SLUGS` to the allowlist. Add `reviewKind: 'spend_approval'` to the resume path for spend-type approvals.

## 7. Integration Boundaries

### 7.1 Skill Registry Integration

**Decision: option (b) — spend as an orthogonal dimension on every gate type.**

New `spendsMoney: boolean` flag on `ActionDefinition` in `actionRegistry.ts`. When `true`, `policyEngineService.evaluatePolicy()` evaluates a `spendDecision` in addition to the existing gate decision. `higherGate()` merges both. This preserves the existing gate-type closed enum and GATE_PRIORITY map unchanged.

**Five new skills** (all `actionCategory: 'api'`, `directExternalSideEffect: true`, `idempotencyStrategy: 'locked'`, `requiredIntegration: 'stripe_agent'`, `defaultGateLevel: 'review'`, `spendsMoney: true`):

| Slug | Description | `executionPath` |
|---|---|---|
| `pay_invoice` | Outbound disbursement via Stripe Invoices API. Feeder: `process_bill`. | `main_app_stripe` |
| `purchase_resource` | One-shot purchase against a merchant-hosted checkout form. | `worker_hosted_form` |
| `subscribe_to_service` | Vendor signup against a hosted form. Read mirror: `track_subscriptions`. | `worker_hosted_form` |
| `top_up_balance` | Prepaid-balance top-up against a vendor's hosted top-up form (distinct from ad-platform budget). | `worker_hosted_form` |
| `issue_refund` | Issues a refund against a prior charge via Stripe Refunds API. `charge_type: 'refund'`, `direction: 'inbound_refund'`. | `main_app_stripe` |

Each skill is a thin shell over `chargeRouterService.proposeCharge`. Skills ship as `server/skills/<slug>.md` files with the standard skill-file frontmatter (matching the `add_deliverable.md` / `book_meeting.md` precedent) and are registered in both `ACTION_REGISTRY` and `SKILL_HANDLERS`.

**Spend audit reason:** `reason: 'spend_block'` written on the security event in `proposeAction.ts` when a spend policy blocks an action. Distinct from `'policy_block'` for analytics and debugging.

### 7.2 IEE Worker Round-Trip

**Decision: pg-boss request-reply with correlation IDs.**

Workers carry no persistent SPT credentials and have no direct DB access to `integration_connections`. All spend is authorised by the main app. When live-mode auto-approval requires the worker to fill a merchant-hosted payment form, the main app returns the SPT in the response payload as ephemeral, single-use material (see invariant 3). The round-trip mechanism:

1. Worker decides to make a purchase (Playwright loop emits `spend_request` action in `iee_steps`).
2. Worker writes a job to `agent-spend-request` queue (full payload in §8.3).
3. Main app processes the job: `chargeRouterService.proposeCharge()` → `actionService.proposeAction()`. Writes the **immediate decision** to `agent-spend-response` queue: `{ correlationId, decision: 'approved' | 'blocked' | 'pending_approval', executionPath, chargeToken?, providerChargeId?, ledgerRowId, errorReason? }` (see §8.4 for the full contract). The decision union is bounded to system-decided outcomes — `denied` is never delivered on this queue. The main app emits the response synchronously from the job handler. For `executionPath: 'main_app_stripe'`, the main app has already executed the Stripe call before responding and the response carries `providerChargeId`. For `executionPath: 'worker_hosted_form'`, the response carries `chargeToken` (the SPT) and the worker proceeds to fill the merchant's form.
4. Worker picks up the immediate response by `correlationId`. Deadline: 30 seconds. If no response within 30s, the worker records the timeout locally (worker log + IEE step) and abandons the in-flight purchase attempt. The worker MUST NOT write to `agent_charges` directly — invariant 1 reserves all ledger writes for `chargeRouterService`. The main app's execution-window timeout job (see §4 rules; runs in `chargeRouterService`) reconciles the orphaned row to `failed` with `reason = 'roundtrip_timeout'` once the row's `expires_at` passes.
5. Auto-approved charge (`decision: 'approved'`, live mode):
   - `executionPath: 'main_app_stripe'` — the response already carries `providerChargeId`; the worker simply records that the Stripe call succeeded and proceeds.
   - `executionPath: 'worker_hosted_form'` — the response carries `chargeToken` (SPT). The worker fills the merchant's payment form, observes the result, and emits a `WorkerSpendCompletion` job (§8.4a) on the `agent-spend-completion` queue with `outcome` and (if successful) `providerChargeId`. The 30-second deadline applies only to the IMMEDIATE response, not to merchant-side latency or the worker's form-fill duration.
6. Pending approval (`decision: 'pending_approval'`): the immediate response delivers `pending_approval` within 30 seconds and the worker / its enclosing workflow PAUSES. The eventual approve/deny outcome is delivered later via the workflow-resume channel (the same pause/resume mechanics that other HITL actions use), NOT via a long-deadlined `agent-spend-response` reply. The 30-second deadline is the immediate-decision deadline only; HITL approval resolution has no bounded wait. After workflow resume on `approved`, the worker proceeds per step 5; after resume on `denied`, the workflow stops the spend attempt and follows its normal denial-handling logic.

**RLS context:** `organisationId` and `subaccountId` carried in the queue payload. Established at the main-app boundary via `actionService.proposeAction`'s tenant args, not via DB GUCs (worker sets none).

### 7.3 Workflow Engine Integration

**Decision: no new step type. Spending is a skill primitive on the existing `action_call` step.**

Spend skills are verbs. They live at the skill layer, not the workflow control-flow layer. The existing `action_call` step already: enforces an allowlist (`ACTION_CALL_ALLOWED_SLUGS`), routes through `actionService.proposeAction` (policy + HITL gating), and pauses on `pending_approval` + resumes on review completion.

Changes:
- Add five spend slugs to `SPEND_ACTION_ALLOWED_SLUGS`, concatenated into `ACTION_CALL_ALLOWED_SLUGS`.
- Add `reviewKind: 'spend_approval'` to the resume path so operators can filter spend approvals from other approval types.
- Idempotency: workflow `idempotencyScope: 'run'` dovetails with `(skillRunId, toolCallId)` in the charge idempotency key.

`invoke_automation` steps that contain spend skills resolve their `gateLevel` from the Automation's `side_effects: 'mutating'` declaration — they naturally land at `'review'` unless policy promotes them.

### 7.4 SPT Vault and Connection Lifecycle

The existing `integrationConnections` + `connectionTokenService` infrastructure handles SPT storage with one addition: `providerType: 'stripe_agent'`.

**Storage:** SPT in `accessToken` (AES-256-GCM encrypted). Refresh handle in `refreshToken`. Stripe-issued expiry: `tokenExpiresAt` + `claimedAt` + `expiresIn`. Auth type: `'oauth2'`.

**Refresh:** New `case 'stripe_agent':` in `connectionTokenService.performTokenRefresh`. Calls Stripe's token rotation endpoint using platform-level keys (not per-connection `clientIdEnc`/`clientSecretEnc`). The advisory-lock-protected `refreshWithLock` flow prevents double-spend on rotation.

**Revocation:**
- Per-policy kill switch: `spending_budgets.disabled_at` set to now.
- Per-sub-account kill switch: `sptVaultService.revokeSubaccountConnection(subaccountId, orgId)` — calls new `integrationConnectionService.revokeSubaccountConnection` which sets `connectionStatus: 'revoked'` and nulls both tokens for all `stripe_agent` connections in the sub-account.
- Per-org kill switch: same but scoped to all sub-accounts in the org.

**Expiry during execution (§16.9):** If SPT expires between policy resolution and charge execution, the charge fails with `reason = 'spt_expired'`. Workflow pauses with HITL request `kind = 'spt_reconnect_required'`. Operator reconnects via standard reauthorisation flow. Workflow resumes; charge retried as a new row linked via `replay_of_charge_id`.

**Webhook secret:** Stored in `integrationConnections.configJson.webhookSecret` (not a separate column) for the `stripe_agent` connection row.

### 7.5 Stripe Webhook Ingestion

**Decision: new dedicated route `server/routes/webhooks/stripeAgentWebhook.ts` mounted at `/api/webhooks/stripe-agent/:connectionId`.**

The existing Stripe data connector has no webhook handler — brief option (a) "modify existing" is inapplicable. The scoped path (`/stripe-agent` not `/stripe`) keeps it isolated from any future general-purpose Stripe handler. The `:connectionId` path parameter carries the `integration_connections.id` used to look up the per-connection `webhookSecret` BEFORE signature verification — Stripe is configured at SPT-issuance time with the per-connection webhook URL containing the connection ID.

**Route responsibilities** (in strict order — ordering matters for correctness):
1. `raw({ type: 'application/json' })` body parser registered before the global JSON parser to preserve raw body for HMAC.
2. Resolve `:connectionId` from the path; load the corresponding `integration_connections` row via `withAdminConnection` (no tenant context yet — verification happens before tenant resolution). 404 if no row, or if the row's `providerType !== 'stripe_agent'` or `connectionStatus = 'revoked'`.
3. Verify `stripe-signature` header against the loaded row's `configJson.webhookSecret`. Reject with HTTP 400 + `recordIncident` on signature failure.
4. Resolve the tenant context (`organisation_id`, `subaccount_id`) from the verified connection row.
5. Deduplicate via `webhookDedupeStore` keyed on Stripe's event `id`. If the event id has already been processed, return HTTP 200 immediately and do NOT enqueue.
6. Enqueue dispatch to `stripeAgentWebhookService` with the resolved tenant context (precedent: `paymentReconciliationJob.ts` for the `withAdminConnection` + connection-driven tenant resolution shape).
7. Acknowledge with HTTP 200.

The dedupe step MUST run before the enqueue and before the 200 acknowledgement so that duplicate Stripe deliveries (which Stripe will retry on any non-2xx) cannot enqueue the same event twice.

**`stripeAgentWebhookService` responsibilities:**
- Transition `agent_charges` rows: `executed → succeeded`, `executed → failed`, `succeeded → refunded`, `succeeded → disputed`, `disputed → succeeded`, `disputed → refunded`.
- On outbound `→ succeeded` (live charge confirmed): trigger `agentSpendAggregateService.upsertAgentSpend(charge)` to add the charge to the rollups.
- On inbound-refund-row `→ succeeded` (operator-issued refund settles via `issue_refund`): trigger `agentSpendAggregateService.upsertAgentSpend(charge)`; the service's direction-aware path subtracts from the parent's rollup window (see §7.6).
- On outbound `→ refunded` (dispute lost via webhook): trigger `agentSpendAggregateService.upsertAgentSpend(charge)`; the service subtracts from the rollup window. No separate inbound_refund row is created in this path (per §7.6 source-of-truth rule).
- On `succeeded → disputed` and `disputed → succeeded`: aggregates remain unchanged. Only the final `→ refunded` outcome (whether dispute or operator-issued) ever reduces the aggregate.
- Alert if `executed` row not found for a webhook event (reconciliation mismatch — critical alert).
- Handle the case where a webhook arrives for a row the ledger considers `failed` (e.g. via timeout path): Stripe's determination takes precedence, update ledger.

**Existing `paymentReconciliationJob`:** continues unchanged for checkout-session charges. Agent-initiated charges live entirely in `agent_charges` and are excluded from the polling reconciliation job. No double-counting risk as the two surfaces have different source rows.

### 7.6 Cost Aggregation

**Decision: new `entityType` values in the existing `cost_aggregates` table.**

`agentSpendAggregateService.upsertAgentSpend(chargeRecord)` writes three new dimensions:
- `agent_spend_subaccount` — monthly + daily rollups keyed by `subaccountId`.
- `agent_spend_org` — monthly + daily rollups keyed by `organisationId`.
- `agent_spend_run` — per-run total keyed by `agentRunId`.

The upsert path mirrors `costAggregateService.upsertAggregates` but accepts a `Charge` input shape (not `LlmRequest`). The aggregate write rules are mutually exclusive per charge row — there is exactly one source of truth for each refund event:

- **Outbound `succeeded` charges:** add `amount_minor` to `totalCostCents`, increment `requestCount`. Source of truth: the row's own `succeeded` transition.
- **Inbound-refund charges (operator-issued via `issue_refund`):** these are NEW rows with `direction = 'inbound_refund'`, `parent_charge_id` pointing at the original. When THIS row reaches `succeeded`, subtract its `amount_minor` from the original charge's rollup window (the parent row remains `succeeded` and its rollup row is unchanged by this refund). Source of truth: the inbound_refund row's own `succeeded` transition.
- **Outbound `succeeded → refunded` transitions (dispute lost; Stripe webhook):** there is no separate inbound_refund row in this path. Subtract `amount_minor` from the rollup window when the original row transitions to `refunded`. Source of truth: the outbound row's `→ refunded` transition.

Because operator refunds and dispute-loss refunds use disjoint rows / transitions, no double-subtract is possible. `totalTokensIn/Out = 0`. Non-commingled because dashboards filter by `entityType`.

Dashboard query routes (`server/routes/agentCharges.ts`) expose the ledger directly; the aggregate surface provides the rollup numbers.

**`checkAlertThresholds`:** Agent spend triggers spend-specific alerts when net monthly spend exceeds `spending_budgets.monthly_spend_alert_threshold_minor`. Separate from Compute Budget alert caps. Dashboard surfaces this as a warning state on the Spending Budget card.

### 7.7 HITL Queue

**Decision: extend existing `review_items` surface with spend-specific metadata and renderer.**

- Write `metadata_json.category: 'spend'` at action creation time (no schema change; precedent: `reviewService.ts:230-232`).
- Spend approval cards render merchant, `amount_minor` formatted with currency, Charge Intent, SPT last4, and one-tap Approve/Deny via the existing `PendingApprovalCard` pattern.
- `renderSpendPayload(item)` branch in `ReviewQueuePage.tsx:370` keyed on `item.reviewPayloadJson.actionType` matching a spend slug.
- Fourth spend lane in `PendingApprovalCard.tsx` alongside `client | major | internal`.
- Approval routing: all users with `spend_approver` permission relevant to the budget's scope, via configured channels (see §13).
- Slack one-tap is out of scope for v1 (see §20).
- BriefApprovalCard in-conversation path is deferred to v2 (see §20). Queue-only in v1.

### 7.8 Adaptive Intelligence Routing

**Decision: advisory spend-policy preview in the planning prelude, non-blocking.**

When `isComplexRun()` is true and the parsed plan includes spend-enabled actions, `chargeRouterServicePure.previewSpendForPlan(plan, policyRules)` runs against the current Spending Policy. Result is injected into the `<system-reminder>` block alongside the plan at `agentExecutionService.ts:2411-2414`.

Output per action: `'would_auto' | 'would_review' | 'would_block' | 'over_budget'`. Advisory only — the live gate at `proposeAction.ts:294-322` is the authoritative enforcement point. The preview uses `policyEngineService.evaluatePolicy` (deterministic, no LLM). Fail-open: errors in the preview do not block the run.

The planning-phase call passes `tools: undefined` (no tool calls) so no `proposeAction()` fires in planning mode — the preview is purely informational.

### 7.9 Audit Log Cross-Reference

**Decision: independent spend ledger with a single cross-reference event in `agent_execution_events`.**

The Spend Ledger (`agent_charges`) is the financial record. It throws on insert failure (opposite of `auditService.log`'s swallow contract). `auditService.log` is NOT used for charge events — its fire-and-forget durability is wrong for financial records.

Each charge attempt emits a single `skill.completed`-class event on `agent_execution_events` with:
- `linkedEntityType: 'spend_ledger'`
- `linkedEntityId: <agent_charges.id>`

This gives the run-timeline UI a "charge attempted → see ledger row" link without conflating streams. The spend ledger does not route through `workspace_memory_entries` — its decay/utility/soft-delete machinery would corrupt financial records.

## 8. Contracts

### 8.1 ChargeRouterRequest

**Producer:** All spend-enabled skills (thin shells that call `chargeRouterService.proposeCharge`).
**Consumer:** `chargeRouterService.ts`.
**Type:** TypeScript interface, passed in-process.

```typescript
{
  organisationId: string          // uuid
  subaccountId: string | null     // uuid; null for org-level budgets
  agentId: string | null          // uuid
  skillRunId: string              // uuid — the agent run
  toolCallId: string              // uuid — this specific tool call within the run
  intent: string                  // human-readable description
  amountMinor: number             // positive integer, currency-minor units
  currency: string                // ISO 4217
  merchant: {
    id: string | null             // Stripe merchant ID if available
    descriptor: string            // normalised string
  }
  chargeType: 'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund'
  args: Record<string, unknown>   // canonical args for idempotency key hash
  parentChargeId: string | null   // uuid; for refunds only
}
```

**Nullability:** `subaccountId` is null for org-level budget charges. `merchant.id` is null when Stripe merchant ID is unavailable (fallback to descriptor matching). `parentChargeId` is null except for refund charges.

### 8.2 ChargeRouterResponse

**Producer:** `chargeRouterService.ts`.
**Consumer:** All spend-enabled skills (direct in-process calls; `WorkerSpendResponse` in §8.4 is the wire shape for the worker round-trip).
**Type:** TypeScript discriminated union.

```typescript
// Auto-approved, live mode, main-app-direct execution (Stripe API call already made)
{ outcome: 'executed', chargeId: string, providerChargeId: string, executionPath: 'main_app_stripe' }

// Auto-approved, live mode, worker-hosted-form execution (worker must fill form)
{ outcome: 'executed', chargeId: string, providerChargeId: null, executionPath: 'worker_hosted_form', chargeToken: string }

// Auto-approved, shadow mode
{ outcome: 'shadow_settled', chargeId: string }

// Routed to HITL
{ outcome: 'pending_approval', chargeId: string, actionId: string }

// Blocked by policy
{ outcome: 'blocked', chargeId: string, reason: string }
```

**Caller contract:** shadow auto-approved charges return `{ outcome: 'shadow_settled' }` and live auto-approved charges return `{ outcome: 'executed', ... }`. Skills must treat both as successful completions — no workflow or skill may branch on whether execution was shadow or live. The `mode` field on the ledger row is the observability signal. The `executionPath` discriminator on `outcome: 'executed'` tells the caller whether `providerChargeId` is already present (`'main_app_stripe'`) or pending worker completion (`'worker_hosted_form'`).

### 8.3 WorkerSpendRequest (pg-boss queue `agent-spend-request`)

**Producer:** `worker/src/persistence/runs.ts` (new helper, mirrors `iee-run-completed` pattern).
**Consumer:** Main app job handler.

```typescript
{
  ieeRunId: string           // uuid
  agentRunId: string         // uuid
  organisationId: string     // uuid
  subaccountId: string       // uuid
  agentId: string            // uuid
  toolCallId: string         // uuid; this specific tool call within the run (carried so the main app can recompute the idempotency key)
  intent: string
  amountMinor: number        // positive integer
  currency: string           // ISO 4217
  merchant: {
    id: string | null
    descriptor: string
  }
  chargeType: 'purchase' | 'subscription' | 'top_up' | 'invoice_payment'
  args: Record<string, unknown>  // canonical args used for the idempotency key hash; main app rebuilds and verifies the key
  idempotencyKey: string     // pre-built by worker using charge key shape from §9.1; main app recomputes from (skillRunId, toolCallId, intent, args) and rejects on mismatch
  correlationId: string      // uuid; used to match response
}
```

### 8.4 WorkerSpendResponse (pg-boss queue `agent-spend-response`)

**Producer:** Main app job handler.
**Consumer:** Worker — picks up by `correlationId`.

```typescript
{
  correlationId: string
  decision: 'approved' | 'blocked' | 'pending_approval'
  executionPath: 'main_app_stripe' | 'worker_hosted_form' | null  // null when decision != 'approved' or mode = 'shadow'
  chargeToken: string | null   // SPT for worker to use; present only when decision = 'approved' AND mode = 'live' AND executionPath = 'worker_hosted_form'
  providerChargeId: string | null  // present only when decision = 'approved' AND executionPath = 'main_app_stripe' (main app already executed Stripe)
  ledgerRowId: string          // uuid; always present
  errorReason: string | null
}
```

**Decision union scope:** the immediate-decision response is bounded to system-decided outcomes only — `approved` (auto-approval), `blocked` (system-enforced denial), `pending_approval` (over threshold). Human-decided outcomes (`denied` from HITL, late `approved` from HITL) are NEVER delivered on `agent-spend-response`; they arrive via the workflow-resume channel per §7.2 step 6. `blocked` is returned for policy / limit / allowlist / Kill Switch / SPT-failure outcomes per invariant 10.

**Deadline:** 30 seconds. If no response arrives within 30s, the worker records the timeout locally and abandons the attempt; the main app's execution-window timeout job reconciles the orphaned ledger row to `failed` with `reason = 'roundtrip_timeout'` once `expires_at` passes (per invariant 1 the worker never writes ledger rows itself).

### 8.4a WorkerSpendCompletion (pg-boss queue `agent-spend-completion`)

**Producer:** Worker — after filling the merchant's hosted payment form (path `worker_hosted_form` only).
**Consumer:** Main app job handler.

```typescript
{
  ledgerRowId: string                // uuid; the agent_charges row to update
  outcome: 'merchant_succeeded' | 'merchant_failed'
  providerChargeId: string | null    // Stripe/merchant payment identifier (null if outcome = merchant_failed and no ID was issued)
  failureReason: string | null       // populated when outcome = merchant_failed
  completedAt: string                // ISO 8601 timestamp from the worker's clock
}
```

The main app's handler updates the row: on `merchant_succeeded`, set `provider_charge_id` (state remains `executed` until the Stripe webhook arrives to drive `executed → succeeded`). On `merchant_failed`, transition `executed → failed` with the supplied `failureReason`. If no completion arrives before `expires_at`, the execution-window timeout job marks the row `failed` with `reason = 'execution_timeout'` (same path as roundtrip timeouts). This is the only inbound queue from worker to main app for spend; `agent-spend-completion` is consumed server-side and produces no reply.

### 8.5 SpendingPolicy Shape

**Producer:** `spendingBudgetService.ts`.
**Consumer:** `chargeRouterServicePure.ts` (policy evaluation), `ReviewQueuePage.tsx` (display).

```typescript
{
  id: string
  spendingBudgetId: string
  mode: 'shadow' | 'live'
  perTxnLimitMinor: number        // 0 = unset (no per-txn cap)
  dailyLimitMinor: number          // 0 = unset (no daily cap)
  monthlyLimitMinor: number        // 0 = unset (no monthly cap)
  approvalThresholdMinor: number  // 0 = every positive charge routes to HITL
  merchantAllowlist: Array<{
    id: string | null             // Stripe merchant ID (primary identifier)
    descriptor: string            // normalised fallback
    source: 'stripe_id' | 'descriptor'
  }>
  approvalExpiresHours: number    // default 24
  version: number
  velocityConfig: null            // reserved; null in v1
  confidenceGateConfig: null      // reserved; null in v1
}
```

**Merchant matching in v1:** exact-match on `id` where available, normalised string match on `descriptor` otherwise. Pattern matching and category grouping are deferred.

### 8.6 Source-of-Truth Precedence

Two representations of charge state exist: the Spend Ledger (`agent_charges`) and Stripe's payment record.

**Precedence rule:**
1. Stripe is the **financial source of truth**: Stripe's webhook stream is authoritative for whether money actually moved and for the final payment state of an executed charge.
2. The Spend Ledger is the **system source of truth**: authoritative for agent intent, policy decisions, and audit history. Records every attempt regardless of Stripe outcome.
3. Reconciliation flows one way only: Stripe outcome updates ledger charge status. The ledger's intent record is immutable (trigger-enforced).
4. When a Stripe webhook arrives for a row the ledger considers `failed` (e.g. via timeout path), Stripe's determination takes precedence: `stripeAgentWebhookService` updates the row.
5. Divergence (webhook arrives for an unknown `providerChargeId`) triggers a critical alert.

**Read path for dashboards:** read `agent_charges` for audit history and agent intent; read Stripe's API for live payment state where needed. Do not query both and reconcile at read time.

## 9. Execution-Safety Contracts

### 9.1 Idempotency Posture

**Charge Router:** `key-based`. Idempotency key shape:

```
${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${intent}:${sha256(canonicaliseJson(args))}
```

Where `intent` encodes the mode as a prefix (`charge:live:buy_domain_example.com` vs `charge:shadow:buy_domain_example.com`) so shadow-to-live promotion produces fresh keys. `CHARGE_KEY_VERSION` is a new constant for future migration.

Key stored as `UNIQUE NOT NULL` on `agent_charges.idempotency_key`. Insert via `INSERT ... ON CONFLICT DO UPDATE SET updated_at = NOW() RETURNING *` (H-1 pattern from `compute_reservations`). The winning row is returned; `isNew = false` signals a duplicate.

`idempotencyStrategy: 'locked'` declared on all five new `ActionRegistry` entries (enforced by `verify-idempotency-strategy-declared.sh`).

**Worker→app round-trip:** worker pre-builds the idempotency key using the same shape before emitting the pg-boss job (the worker also runs `chargeRouterServicePure.buildChargeIdempotencyKey` since the pure layer is dependency-free). The `WorkerSpendRequest` carries `toolCallId`, `args`, and the pre-built `idempotencyKey`. The main app's job handler rebuilds the key from those fields via the same pure helper and rejects the request if the recomputed key does not match the supplied one (defends against a buggy worker emitting a malformed key). The verified key is then used for the charge row insert.

**Shadow→live promotion:** policy-level flip only. Does not retroactively re-issue past shadow charges. Past shadow rows remain `shadow_settled`. Future charges on the same policy create new rows with `mode = 'live'` and new idempotency keys (because intent includes `charge:live:` prefix).

### 9.2 Retry Classification

| Operation | Classification | Boundary |
|---|---|---|
| `chargeRouterService.proposeCharge` | `guarded` | Idempotency key on `agent_charges` UNIQUE constraint |
| Stripe SPT API call | `guarded` | Stripe's own idempotency-key header; key passed from `agent_charges.idempotency_key` |
| HITL approval action | `guarded` | Existing `actions.idempotencyKey` UNIQUE constraint |
| `agent-spend-request` pg-boss job | `guarded` | pg-boss job deduplication + `correlationId` |
| Webhook event processing | `guarded` | `webhookDedupeStore` keyed on Stripe event `id` |
| Shadow charge write | `guarded` | Same idempotency key UNIQUE constraint |
| Retention purge of shadow rows | `safe` | Purge is idempotent by definition (delete already-deleted = no-op) |

### 9.3 Concurrency Guards

**Concurrent charge attempts against the same Spending Policy limits:**
- Spending Limits are evaluated against settled outbound charges (net of inbound refunds, per §16.7) **plus all non-terminal charges** (`pending_approval`, `approved`, `executed`, `disputed`). Non-terminal charges reserve their `amount_minor` against limits until they reach a terminal state.
- Guard: `chargeRouterServicePure.evaluatePolicy` reads all non-terminal charges for the budget and sums reserved capacity before accepting a new charge. Two concurrent charges that individually fit but collectively exceed the limit — the second is `blocked`.
- Enforcement: advisory lock on `spending_budgets.id` during the propose+gate sequence (mirror of `acquireOrgComputeBudgetLock` pattern), released after the charge row is written.

**Concurrent HITL approval responses:**
- `UPDATE agent_charges SET status = 'approved', approved_at = NOW() WHERE id = $id AND status = 'pending_approval'` — optimistic predicate.
- Zero rows updated = another response already won. Losing caller writes its response onto the corresponding `actions` row (using the existing `actions.responseStatus` / response metadata fields, with status set to `superseded`); the `agent_charges` row itself is not mutated by losing responses. Caller returns 200. SPT-reconnect-required workflow metadata (per §16.9) is similarly recorded on `actions` and `iee_steps`, never on `agent_charges` — the ledger row stays narrowly scoped to the charge state machine.

**Policy revalidation on approval:**
- When an approval response arrives for a `pending_approval` charge, `chargeRouterService` re-reads the current `spending_policies` row (checking `version` against `agent_charges.policy_version`).
- If the policy version has changed such that the charge would now be blocked: auto-deny with `reason = 'policy_changed'`.
- The advisory lock is NOT held across the full approval wait period — only across the re-validate + execute sequence.

### 9.4 Terminal Events

Every charge attempt produces exactly one terminal state transition. Mutually exclusive terminal states: `blocked`, `denied`, `shadow_settled`, `succeeded`, `failed`, `refunded`.

The `spend.*` event labels below are **logical state-machine event names** used in audit reasoning, dashboards, and the charge `decision_path` JSON — they are NOT separate rows on `agent_execution_events`. The `agent_execution_events` table receives exactly one cross-reference event per charge attempt (a `skill.completed`-class event with `linkedEntityType: 'spend_ledger'`, `linkedEntityId: <agent_charges.id>`), per §7.9. Per-state-transition history lives on `agent_charges` itself (status column + `decision_path` JSON + the timestamp columns).

Logical event chain (for analytics and audit reasoning, not a separate event stream):
1. `spend.proposed` — `agent_charges` row first written.
2. `spend.approved` — charge transitions to `approved`.
3. `spend.executed` — Stripe call made (live mode only).
4. `spend.shadow_settled` — terminal event for shadow mode execution.
5. `spend.succeeded` — terminal event for confirmed live payment (from webhook).
6. `spend.blocked` — terminal event for system-enforced denial (policy, limits, Kill Switch, SPT failure). Distinct from `spend.denied` for analytics.
7. `spend.denied` — terminal event for human rejection via HITL. Distinct from `spend.blocked`.
8. `spend.failed` — terminal event for execution failures (Stripe error, timeout, SPT expiry).
9. `spend.refunded` — terminal event for refund settlement.

**Post-terminal prohibition:** no further state transitions occur for a charge after it reaches a terminal state, with one carved-out exception: `failed → succeeded` driven by an inbound Stripe webhook (per §4 rules and §8.6 precedence rule 4). This carve-out is enforced by `stateMachineGuards` and the DB trigger BOTH allowing this single transition and ONLY when the caller is `stripeAgentWebhookService` (server-side caller identity check) — every other post-terminal transition raises. No other post-terminal override is permitted.

**Partial success:** no partial success is possible on a single charge (atomic). Workflow-level partial success (charge succeeded but subsequent step failed) surfaces as the `failed-but-charged` state, which fires a HITL with three options: refund, manually retry failed steps, or accept partial state. The terminal event for the charge itself is `spend.succeeded`; the workflow emits a separate `workflow.partial_completion` event.

### 9.5 Unique-Constraint HTTP Mapping

| Constraint | Violation means | HTTP response |
|---|---|---|
| `agent_charges.idempotency_key` UNIQUE | Duplicate charge attempt | 200 — return existing charge row (idempotent hit) |
| `spending_budgets (organisation_id, agent_id)` UNIQUE WHERE `agent_id IS NOT NULL` | Duplicate budget for same agent (one budget per agent) | 409 — "Agent already has a Spending Budget" |
| `spending_budgets (organisation_id, subaccount_id, currency)` UNIQUE WHERE `agent_id IS NULL AND subaccount_id IS NOT NULL` | Duplicate sub-account-wide budget for same currency (sub-accounts may have multiple budgets, but at most one per currency) | 409 — "Sub-account already has a Spending Budget in this currency" |
| `spending_policies.spending_budget_id` UNIQUE | Duplicate policy for same budget | 409 — "Spending Budget already has a policy" |
| `spending_budget_approvers (spending_budget_id, user_id)` UNIQUE | Duplicate approver grant | 409 — "User is already an approver for this budget" |

No `23505` violations bubble as 500. All mapped at the service layer.

## 10. System Invariants

These rules hold in every code path. Violations are blocking issues in adversarial-reviewer and spec-conformance passes.

1. **Ledger row before charge.** `chargeRouterService` writes a `proposed` row in `agent_charges` before contacting Stripe or calling any external service. No code path reaches Stripe without a ledger row already written.
2. **Policy check before execution.** No spend-enabled skill calls Stripe directly. All execution flows through `chargeRouterService.proposeCharge`.
3. **Worker never charges directly.** IEE workers hold no persistent SPT credentials, have no DB access to `integration_connections`, and never authorise spend on their own. All spend is authorised by the main app via the pg-boss request-reply round-trip. When live-mode auto-approval requires the worker to fill a merchant-hosted payment form, the main app returns the SPT in the response payload bound to one `ledgerRowId`. The token is not server-mint-rotated per call (it is the SPT held in `integration_connections`); "single-use at the protocol level" means: (a) the `chargeToken` field is delivered exactly once per `correlationId`, (b) the worker's payment call carries the charge `idempotency_key` as Stripe's idempotency-key header so any re-use against the same merchant call collapses to the original outcome, and (c) the `agent_charges.idempotency_key` UNIQUE constraint blocks duplicate ledger rows. The worker MUST NOT log, persist, or reuse the token across charges; on receipt it uses the token inline and discards the variable. Stronger enforcement (server-minted single-use wrapper) is deferred — see §20.
4. **Idempotency at DB level.** `agent_charges.idempotency_key` is UNIQUE. Duplicates resolve via `INSERT ... ON CONFLICT DO UPDATE`, not application-layer deduplication.
5. **Tenant isolation.** RLS policies protect `spending_budgets`, `spending_policies`, and `agent_charges`. Cross-tenant SPT access is a critical incident.
6. **Shadow charges write to the real ledger.** Shadow mode does not skip the Spend Ledger. Every shadow attempt gets a full `shadow_settled` row with policy decision, allowlist result, and Charge Intent recorded.
7. **Kill Switch is synchronous.** A fired Kill Switch blocks new charges immediately. In-flight `executed` charges resolve normally. `pending_approval` charges are auto-cancelled. No retries permitted after kill.
8. **`cost_aggregates` RLS before new dimensions.** The RLS retrofit on `cost_aggregates` ships in the same migration as the first new `entityType` values. No spend data lands in the table without RLS protection.
9. **No silent drops.** Every proposed charge must reach a terminal state or an explicit intermediate state. Terminal states: `blocked`, `denied`, `failed`, `shadow_settled`, `succeeded`, `refunded`. Non-terminal charges (`pending_approval`, `executed`, `disputed`) hold their reserved amount against limits until they reach a terminal state. `disputed` is non-terminal — it resolves to `succeeded` or `refunded` per §4 once Stripe's chargeback flow concludes.
10. **Blocked vs denied.** `blocked` = system-enforced denial (policy, limits, Kill Switch, SPT failure). `denied` = human rejection via HITL. Distinct categories for analytics, debugging, and audit semantics.
11. **Execution window.** An `approved` charge that does not transition within the execution window is auto-marked `failed` with `reason = 'execution_timeout'`. Prevents permanent reserved-capacity lock.
12. **Approval window.** A `pending_approval` charge whose `approval_expires_at` passes without a response is auto-marked `denied` with `reason = 'approval_expired'`.
13. **Compute Budget rename ships first.** Chunk 1 (the rename) is fully reviewed and merged before any new spending code lands on the branch. No spending code references `budgetReservations`, `BudgetContext`, or `BudgetExceededError`.
14. **Dual registration.** Every entry in `ACTION_REGISTRY` with `spendsMoney: true` is also registered in `SKILL_HANDLERS`. Orphaned registrations do not fail at compile time — the spec must call this out explicitly and the reviewer must verify it.
15. **Pure/impure split enforced.** Charge router decisions (policy match, cap math, idempotency key build, mode discrimination) live in `chargeRouterServicePure.ts`. Stripe calls and DB writes live in `chargeRouterService.ts`. Enforced by `verify-pure-helper-convention.sh`.
16. **Subaccount resolution.** Any route with `:subaccountId` calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming it (gate `verify-subaccount-resolution.sh`).

## 11. Permissions and RLS

### 11.1 spend_approver Permission

New permission key: `spend_approver`. Added to the existing permission system (same mechanism as current `requirePermission(key)` guards).

**Authority rule:** a user is eligible to approve a charge against a Spending Budget B if and only if BOTH of the following hold:

1. The user holds the `spend_approver` permission key (granted by default to admins per the rules below, or granted explicitly by an admin).
2. The user is in B's approver scope, where "in scope" is defined as either (a) the role-based default grant for B (org admin if B is org-scoped; sub-account admin if B is sub-account-scoped or sub-account-agent-scoped), OR (b) an explicit row in `spending_budget_approvers` for `(B.id, user.id)`.

Both conditions must hold; neither alone is sufficient. Holding `spend_approver` without scope membership is not approval authority for B; scope membership without `spend_approver` (e.g. the permission was revoked) is also not approval authority.

**Default grant:** when a new Spending Budget is created:
- Budget scoped to an org-level agent: `spend_approver` granted to ALL users currently holding the org-admin role for that organisation. All such users are treated as in-scope by role for that budget.
- Budget scoped to a sub-account or sub-account agent: `spend_approver` granted to ALL users currently holding the sub-account-admin role for that sub-account. All such users are treated as in-scope by role for that budget.

The default-grant logic enumerates current admin-role holders at budget-creation time. Admins added to the role AFTER budget creation do NOT auto-receive `spend_approver` for pre-existing budgets; admins removed from the role retain `spend_approver` until an admin explicitly revokes it. Drift in either direction is an explicit operator action, not an implicit role-sync side-effect.

**Explicit additional grants:** via `spending_budget_approvers` join table. Any user holding the org-admin or sub-account-admin role (whichever owns the budget's scope) can add additional approvers. The added user must already hold (or be granted alongside) the `spend_approver` permission for the authority rule above to apply.

**Approval routing:** when an approval fires, the system collects all users satisfying the authority rule for the relevant budget and notifies them via the fan-out channel config (see §13). First approval wins.

### 11.2 RLS Coverage Table

See §5.3 for the full RLS coverage table. Summary of new protections added in this build:

- 7 new tables all have canonical org-isolation RLS in their creation migration.
- `cost_aggregates` retrofitted with org-isolation RLS in the same migration that adds agent-spend dimensions.
- `integration_connections` (stripe_agent rows): existing P3B principal-scoped policy already applies. No new work.

All new tables added to `server/config/rlsProtectedTables.ts`.

### 11.3 Route Guards

| Route | Guard | Notes |
|---|---|---|
| `GET /spending-budgets` | `authenticate` + `requirePermission('spend_approver')` or `requirePermission('admin')` | Org and subaccount scope |
| `POST /spending-budgets` | `authenticate` + `requirePermission('admin')` | Creating a budget requires admin |
| `PATCH /spending-budgets/:id` | `authenticate` + `requirePermission('admin')` | |
| `POST /spending-budgets/:id/promote-to-live` | `authenticate` + `requirePermission('spend_approver')` | HITL-gated action |
| `GET /spending-budgets/:id/policy` | `authenticate` + `requirePermission('spend_approver')` | |
| `PATCH /spending-budgets/:id/policy` | `authenticate` + `requirePermission('admin')` | |
| `GET /agent-charges` | `authenticate` + `requirePermission('spend_approver')` | Ledger read |
| `GET /agent-charges/:id` | `authenticate` + `requirePermission('spend_approver')` | |
| `POST /webhooks/stripe-agent/:connectionId` | No auth — Stripe-signed. Signature verification is the auth. | Look up connection row by `:connectionId` via `withAdminConnection`, verify signature against that row's `configJson.webhookSecret`, then resolve tenant context from the verified row. |
| `GET /approval-channels` | `authenticate` + scope-appropriate admin | |
| `POST /approval-channels` | `authenticate` + scope-appropriate admin | |
| All routes with `:subaccountId` | `resolveSubaccount(req.params.subaccountId, req.orgId!)` | Gate `verify-subaccount-resolution.sh` |

## 12. Execution Model

| Operation | Model | Notes |
|---|---|---|
| `chargeRouterService.proposeCharge` (auto-approved, shadow or live under threshold) | **Inline/synchronous** | Caller blocks. Returns before response is sent. |
| `chargeRouterService.proposeCharge` (pending_approval) | **Queued (pg-boss)** | Enqueues HITL action via `actionService.proposeAction`. Workflow engine pauses. Resumes on review completion. |
| IEE worker → charge router round-trip | **Queued (pg-boss request-reply)** | `agent-spend-request` + `agent-spend-response` queues. 30-second deadline. |
| Stripe webhook processing | **Queued (async)** | Route acks with 200 immediately. `stripeAgentWebhookService` processes asynchronously. |
| Cost aggregate upserts on charge settlement | **Inline** | Called from `stripeAgentWebhookService` on `succeeded` events. Synchronous within the webhook handler's async processing. |
| Shadow-to-live promotion | **Queued (HITL)** | Creates a HITL approval action. Policy flips on approval. |
| Spend-policy advisory preview (planning phase) | **Inline** | `previewSpendForPlan` is a pure function call inside the planning prelude. Fail-open. |
| Webhook reconciliation poll (30-min deadline miss) | **Scheduled job** | Existing job pattern. Polls Stripe API for `executed` charges past 30-minute threshold. |
| Shadow charge retention purge | **Scheduled job** | Background job. Purges `shadow_settled` rows past per-org retention window. |

**Non-functional alignment:**
- The Stripe SPT call within `proposeCharge` (live mode, auto-approved) is synchronous within the inline execution path. Latency impact is bounded by Stripe's API SLA.
- There is no prompt partition or cache tier involved in this build.

## 13. Approval Channels

### 13.1 Three-Table Model

See §5.1 for full column definitions.

- **`subaccount_approval_channels`** — owned by sub-account. Sub-account admin manages. These are the default channels for all approvals initiated from this sub-account.
- **`org_approval_channels`** — owned by org. Org admin manages. Used for approvals on org-level agents and for sub-account fan-out grants.
- **`org_subaccount_channel_grants`** — owned by org. Org admin manages. Each row adds an org-owned channel to a sub-account's approval fan-out. Sub-account cannot see, edit, or delete grant rows.

**Subaccounts are first-class tenants.** Org configuration adds oversight, never replaces the sub-account's own channels. The org admin cannot push approvals into a sub-account's channels; they can only add org-owned channels to the fan-out.

### 13.2 Fan-Out and First-Response-Wins

When an approval fires for a charge from sub-account X:
1. Collect all `subaccount_approval_channels` for sub-account X (enabled = true).
2. Collect all `org_approval_channels` linked via active `org_subaccount_channel_grants` for sub-account X.
3. Fan out simultaneously to all collected channels (notify all configured approvers).
4. Approval channels NEVER write to `agent_charges` directly. When a channel receives a response, it submits the decision to `chargeRouterService.resolveApproval(actionId, decision)`. That service is the sole writer for `pending_approval → approved/denied` transitions: it (a) performs the optimistic compare-and-set on the row, (b) on `approved` runs the policy revalidation per §9.3 and §16.3 (re-read current `spending_policies`, auto-deny with `reason = 'policy_changed'` if the policy now blocks), (c) writes the resulting state. Zero rows updated on the compare-and-set = another response already won; the channel records its response as `superseded` on the `actions` row only (per §9.3).
5. Losing channels receive a "resolved by Y via Z at T" follow-up notification.
6. Revocation of a grant row takes effect immediately for future approvals. In-flight approvals already fanned out continue to their resolution.

### 13.3 Channel Interface

Every channel adapter implements the same interface:

```typescript
interface ApprovalChannel {
  channelType: string
  sendApprovalRequest(approvalRequest: ApprovalRequest): Promise<void>
  receiveResponse(raw: unknown): ApprovalResponse | null
  sendResolutionNotice(resolution: ApprovalResolution): Promise<void>
}
```

Channel-specific quirks (signature verification, interactive callbacks, format) live inside the adapter. The core `approvalChannelService` owns the state machine; channels are stateless pipes.

**v1 ships:** `InAppApprovalChannel` — delivers to the in-app review queue via existing `hitlService`. No Slack, email, or external adapters in v1.

**Extension contract:** future channel adapters add one file per channel. No changes to `approvalChannelService` required (open/closed principle).

## 14. Shadow Mode Semantics

Shadow mode is not an approximation. It is the live execution path with the Stripe call replaced by a ledger write. This guarantees that the shadow audit trail is trustworthy evidence for the promotion decision.

**What shadow mode does:**
- Runs the full policy check: Spending Mode, Spending Limits, Merchant Allowlist, Approval Threshold.
- Routes over-threshold charges to HITL (approval request is real; the HITL queue entry is a real entry).
- Writes a full ledger row with `mode = 'shadow'`. Auto-approved (under threshold) charges land directly at `status = 'shadow_settled'`. HITL-approved charges transition `pending_approval → approved → shadow_settled` (the `approved → shadow_settled` step in §4 fires regardless of whether the approval was auto or HITL). HITL-denied charges land at `denied`.
- Returns a success response to the caller with the same shape as live mode. The workflow continues as if the charge succeeded.

**What shadow mode does NOT do:**
- Does not call Stripe.
- Does not return a real SPT to the IEE worker (worker returns `chargeToken: null`; worker does not fill a payment form).
- Does not produce a `providerChargeId`.

**From the caller's perspective:** shadow auto-approved charges return `outcome: 'shadow_settled'` and live auto-approved charges return `outcome: 'executed'`. Both are success outcomes. No workflow or skill may branch on mode — treat both as successful completions. The `mode` field on the ledger row is the observability signal.

**Shadow-to-live promotion:**
1. Operator clicks "Promote to live" on the Spending Budget UI.
2. System creates a HITL approval action (kind: `promote_spending_policy_to_live`).
3. All users with `spend_approver` for this budget are notified via configured channels.
4. First approval: `chargeRouterService` re-validates the current policy (version check), flips `spending_policies.mode = 'live'`, increments `version`, audit-logs the promotion.
5. Past shadow charges remain `shadow_settled`. Only future charges use live mode.

**Shadow retention:** `shadow_settled` rows are retained for `organisations.shadow_charge_retention_days` (new column added by this build, `integer NOT NULL DEFAULT 90`). A scheduled retention job purges aged shadow rows whose `settled_at + shadow_charge_retention_days < NOW()`. The retention job is the only DB path that may delete `agent_charges` rows.

**Conservative defaults on new Spending Budget:**
```
mode: 'shadow'
per_txn_limit_minor: 0          (unset — no per-txn cap)
daily_limit_minor: 0            (unset — no daily cap)
monthly_limit_minor: 0          (unset — no monthly cap)
merchant_allowlist: []          (empty — every charge fails the allowlist gate and is blocked)
approval_threshold_minor: 0     (every positive charge routes to HITL)
```

These defaults are intentionally maximally conservative: with an empty allowlist every proposed charge blocks before reaching the approval-threshold gate. Operators must configure the allowlist (and ideally limits) before the policy is useful, even in shadow mode. A "Load conservative defaults" one-click template populates working values: per_txn=$20, daily=$100, monthly=$500, threshold left at 0 so every charge still routes to HITL until the operator widens it. The merchantAllowlist payload uses the §8.5 shape `{ id, descriptor, source }` exactly:

```typescript
[
  { id: null, descriptor: 'NAMECHEAP', source: 'descriptor' },
  { id: null, descriptor: 'OPENAI',    source: 'descriptor' },
  { id: null, descriptor: 'ANTHROPIC', source: 'descriptor' },
  { id: null, descriptor: 'CLOUDFLARE', source: 'descriptor' },
  { id: null, descriptor: 'TWILIO',    source: 'descriptor' },
  { id: null, descriptor: 'STRIPE',    source: 'descriptor' },
]
```

`source: 'descriptor'` for all template entries because Stripe merchant IDs are not stable seeds across deployments. Operators can swap individual entries to `source: 'stripe_id'` with a real `id` value as Stripe IDs become known. Descriptors are uppercase normalised strings matching how `chargeRouterServicePure` normalises incoming `merchant.descriptor` values.

## 15. Kill Switch

Three-level revocation, each immediately effective with a single admin action.

| Level | Mechanism | Effect |
|---|---|---|
| Per-policy | Set `spending_budgets.disabled_at = NOW()` | Blocks new charges for this specific budget. SPT remains valid for other uses. |
| Per-sub-account | `sptVaultService.revokeSubaccountConnection(subaccountId, orgId)` — nulls all `stripe_agent` tokens for the sub-account + sets `connectionStatus = 'revoked'` | Blocks new charges from any agent against this sub-account. |
| Per-org | Same but scoped to all sub-accounts in the org | Blocks all spending across the entire org. |

**Behaviour when Kill Switch fires:**
- New `proposed` charges are immediately `blocked` with `reason = 'kill_switch'`.
- In-flight `executed` charges resolve normally via Stripe webhook. Not reversed.
- `pending_approval` charges are auto-transitioned to `denied` with `reason = 'kill_switch'`.
- No retries permitted. `blocked` is terminal.
- Every Kill Switch event is audit-logged with: triggered-by user, timestamp, scope (policy/subaccount/org), number of pending approvals cancelled.

**Kill Switch check location:** `chargeRouterServicePure.evaluatePolicy` checks `spending_budgets.disabled_at` and `integrationConnections.connectionStatus` as the first gates before any other policy evaluation. Kill Switch check is synchronous and inline.

**Re-enablement:** not in v1. Re-enabling a kill-switch-fired budget requires creating a new Spending Budget (and for sub-account/org level: re-authorising via the Stripe integration flow). This is intentional — re-enablement should be an explicit, deliberate action, not a button click.

## 16. Edge-Case Semantics

### 16.1 Spend Intent vs Charge

A **Spend Intent** is the logical operation ("buy domain example.com"). A **Charge** is one execution attempt. Multiple Charges may share one Spend Intent — when a Charge fails and is retried, both carry the same `intent_id`. `intent_id` groups retries in the UI and analytics. The idempotency key distinguishes individual attempts.

Retries are explicit: a `failed` Charge is terminal; a retry is a new Charge row under the same `intent_id`, initiated by either the workflow (if explicitly designed to retry) or an operator action. No automatic system retries.

### 16.2 Concurrency and Reserved Capacity

Spending Limits are enforced against settled outbound charges (net of inbound refunds) plus all non-terminal charges (`pending_approval`, `approved`, `executed`, `disputed`). Each non-terminal Charge reserves its `amount_minor` against limits until the row reaches a terminal state. Two concurrent charges that individually fit but collectively exceed a limit — the second is `blocked`. Evaluated at the Gate step, before HITL routing and before Stripe execution.

### 16.3 Approval Expiry and Policy Revalidation

Pending approvals expire after `spending_policies.approval_expires_hours` (default 24 hours). When an approval is acted on, the Charge Router re-checks the current `spending_policies` version before executing. If the policy has changed such that the charge would now be blocked (limit reduced, merchant removed, Kill Switch fired, version incremented), the Charge is auto-denied with `reason = 'policy_changed'`.

Approval resolution is atomic: the first valid response wins via the optimistic predicate (see §9.3). Subsequent responses are recorded as `superseded` on the `actions` row only (per §9.3); `agent_charges` rows are not mutated by losing responses.

### 16.4 Merchant Identity

Primary: Stripe merchant ID (`merchant.id`). Fallback: normalised string matching against `merchant.descriptor`. Exact-match semantics in v1. Pattern matching and category grouping are deferred (see §20).

### 16.5 Recurring Charges

Every recurring Charge (subscription renewal, scheduled top-up) is evaluated against the **current** Spending Policy at execution time. Pre-approval does not carry forward across billing cycles. Operators configure permissive limits and allowlists for low-friction renewals — not pre-approved subscriptions.

### 16.6 Webhook Failure

If a Stripe webhook for an `executed` Charge has not arrived within 30 minutes, a reconciliation poll runs against Stripe's API. The Charge remains `executed` until confirmed. If the poll also fails: the Charge stays `executed`, surfaces in the dashboard as "pending confirmation," and a warning alert fires. Manual reconciliation is the resolution path. Until webhook confirmation, `executed` is treated as pending external confirmation and is not considered settled for limit release or reporting.

### 16.7 Net Spend and Refunds

Spending Limits are enforced on **net spend**: settled charges minus `inbound_refund` charges. A $50 refund against a $100 daily limit restores $50 of available daily capacity. Per-transaction limits are point-in-time and are not affected by subsequent refunds.

### 16.8 Ledger Immutability

`agent_charges` rows are immutable except for the columns on the explicit "Mutable-on-transition allowlist" defined in §5.1, and only when an UPDATE accompanies a valid state-machine transition. Every other column is fixed at insert time. Enforced by DB-level `BEFORE UPDATE` / `BEFORE DELETE` triggers. Shadow rows are additionally purgeable by the retention job.

### 16.9 SPT Mid-Workflow Expiry

If the SPT has expired or been revoked between policy resolution and charge execution, the charge fails with `reason = 'spt_expired'` or `reason = 'spt_revoked'`. The workflow pauses with a HITL request of `kind = 'spt_reconnect_required'`. Payload includes: affected Spending Budget, merchant, amount, reconnect link. Operator reconnects via standard `integrationConnections` reauthorisation. Workflow resumes; charge retried as a new row linked via `replay_of_charge_id`.

### 16.10 Failure-Mode Handling

When a workflow fails after a successful charge (charge is `succeeded` but a subsequent workflow step fails):
- The system surfaces the `failed-but-charged` state to HITL.
- Three operator options: (a) refund, (b) manually retry the failed workflow steps, (c) accept partial state.
- No automatic refund-on-workflow-rollback in v1. Auto-refund introduces its own failure modes (refund fails, double-charge on retry, partial-refund acceptance) — deferred to follow-up.

### 16.11 Alert Severity

| Condition | Severity | Action |
|---|---|---|
| Reconciliation mismatch (webhook for unknown charge) | Critical | Page + incident |
| Cross-tenant SPT access attempt | Critical | Page + incident + block |
| Ledger inconsistency detected | Critical | Page + incident |
| Webhook delay beyond 30 minutes | Warning | Alert dashboard |
| Charge in `executed` pending confirmation beyond 1 hour | Warning | Alert dashboard |
| Kill Switch activation | Informational | Audit event; not page-worthy |

## 17. Chunk Plan

16 chunks. Chunk 1 is a prerequisite for all others. Chunks 4-5 can parallelise. Chunks 13-14 can parallelise. Estimated wall-clock: 4 weeks single builder; 2.5-3 weeks with parallelism.

### Chunk 1 — Compute Budget Rename

**Prerequisite for all subsequent chunks. Ships fully reviewed before any spending code lands.**

All schema, code, type, function, event, and UI string renames per §2 and addendum B.4.

- `budget_reservations` → `compute_reservations`
- `org_budgets` → `org_compute_budgets`
- `budgetService.ts` → `computeBudgetService.ts` + `computeBudgetServicePure.ts`
- Column renames: `monthly_cost_limit_cents` → `monthly_compute_limit_cents` (and all siblings)
- Type renames: `BudgetContext`, `BudgetExceededError`, `BudgetReservation`
- Function renames: `acquireOrgBudgetLock`, `checkAndReserveBudget`, `releaseBudget`, `commitBudget`
- Event renames: `budget.reserved`, `budget.exceeded`, `budget.committed`, `budget.released`
- UI string updates: all "Budget" labels in LLM-cost contexts become "Compute Budget"
- Schema files renamed accordingly

No new functionality.

### Chunk 2 — Schema + RLS for New Tables

Both migrations, all new schema files, manifest entries.

- `spending_budgets.ts`, `spending_policies.ts`, `agent_charges.ts`
- `subaccountApprovalChannels.ts`, `orgApprovalChannels.ts`, `orgSubaccountChannelGrants.ts`, `spendingBudgetApprovers.ts`
- Canonical RLS policies for all 7 new tables
- `cost_aggregates` RLS retrofit (add `organisation_id`, canonical policy)
- Append-only triggers on `agent_charges` (mutable-column allowlist per §5.1)
- DB-side state-machine validation in the trigger (mirror of the application-side `stateMachineGuards.ts` rules)
- `organisations.shadow_charge_retention_days integer NOT NULL DEFAULT 90` column add
- All entries in `server/config/rlsProtectedTables.ts`
- `shared/stateMachineGuards.ts` extended for `agent_charges` transitions (this is a shared/code change shipped in the same PR as the migration; tracked in §18.2 modified files, not §18.3 migration scope)

### Chunk 3 — SPT Vault and Connection Lifecycle

- Add `'stripe_agent'` to `integrationConnections.providerType` enum
- `connectionTokenService`: add `case 'stripe_agent':` in `performTokenRefresh`, parameterise refresh buffer
- `integrationConnectionService`: add `revokeSubaccountConnection`
- `stripeAdapter.ts`: read `accessToken` (not `secretsRef`) for `stripe_agent` connections
- `sptVaultService.ts` (new service file)

### Chunk 4 — Charge Router Pure

Heavy unit-test chunk. `chargeRouterServicePure.ts` only.

- Policy resolution: allowlist match, limit check (including reserved capacity), threshold compare, mode discrimination
- Idempotency key construction: `buildChargeIdempotencyKey`
- Planning-phase advisory: `previewSpendForPlan`
- All pure function unit tests (Vitest)

### Chunk 5 — Charge Router Impure

`chargeRouterService.ts` only.

- Propose → Gate → Execute four-step flow
- Stripe SPT API call via `sptVaultService`
- Ledger insert (`proposed`) + state-machine writes
- HITL enqueue via `actionService.proposeAction`
- `agent_execution_events` cross-reference (`linkedEntityType: 'spend_ledger'`)
- Policy revalidation on HITL approval
- Execution window timeout job

### Chunk 6 — Action Registry and Skill Handlers (5 skills)

- Five new skill entries in `actionRegistry.ts`: `pay_invoice`, `purchase_resource`, `subscribe_to_service`, `top_up_balance`, `issue_refund`
- `spendsMoney: boolean` flag on `ActionDefinition`
- `requiredIntegration: 'stripe_agent'`
- `SPEND_ACTION_ALLOWED_SLUGS` constant
- Five SKILL_HANDLERS entries in `skillExecutor.ts`
- Five `server/skills/<slug>.md` files (one per skill, standard skill-file frontmatter — same convention as the existing `add_deliverable.md` / `book_meeting.md` files)

### Chunk 7 — Policy Engine Extension

- `spendDecision` field on `PolicyDecision` shape in `policyEngineService.ts`
- `evaluateSpendPolicy` pure helper in `policyEngineServicePure.ts`
- `higherGate()` merge in `actionService.resolveGateLevel`
- `reason: 'spend_block'` audit path in `proposeAction.ts`
- Advisory spend preview hook in `agentExecutionService.ts` planning prelude

### Chunk 8 — HITL Surface

- `metadata_json.category: 'spend'` written at action creation
- `renderSpendPayload(item)` in `ReviewQueuePage.tsx` + `ACTION_BADGE` entries
- Fourth spend lane in `PendingApprovalCard.tsx`
- `spend_approver` permission added to permission system

### Chunk 9 — Approval Channel Interface and In-App Implementation

- `approvalChannelService.ts` + `approvalChannelServicePure.ts`
- `ApprovalChannel` interface definition
- `InAppApprovalChannel` as first conformant implementation
- Fan-out and first-response-wins logic
- Grant/revoke lifecycle for `org_subaccount_channel_grants`
- Audit trail for grant/revoke events
- `spending_budget_approvers` CRUD

### Chunk 10 — Workflow Engine Wiring

- `SPEND_ACTION_ALLOWED_SLUGS` concatenated into `ACTION_CALL_ALLOWED_SLUGS`
- `reviewKind: 'spend_approval'` on workflow resume path
- `workflowEngineService.ts` integration for pause/resume on spend approval
- `shared/types/agentExecutionLog.ts`: add `'spend_ledger'` to `LinkedEntityType`

### Chunk 11 — Worker Round-Trip

- `agent-spend-request`, `agent-spend-response`, and `agent-spend-completion` pg-boss queues
- Correlation ID tracking and 30-second deadline on the request/response pair
- Worker-hosted-form completion contract via `agent-spend-completion` (per §8.4a) — fires only for `executionPath: 'worker_hosted_form'` paths
- `worker/src/persistence/runs.ts`: `iee-spend-request` and `iee-spend-completion` event helpers
- `worker/src/loop/executionLoop.ts`: spend-request emit branch + spend-completion emit branch after merchant form-fill
- `shared/iee/actionSchema.ts`: `spend_request` and `spend_completion` action types
- Main app job handlers for `agent-spend-request` and `agent-spend-completion`

### Chunk 12 — Stripe Webhook Ingestion

- `server/routes/webhooks/stripeAgentWebhook.ts` mounted at `/api/webhooks/stripe-agent`
- `stripeAgentWebhookService.ts`
- Signature verification, body parser order, dedupe via `webhookDedupeStore`
- State-machine transitions: `executed → succeeded/failed/refunded/disputed`
- Alert emission for mismatch and delay
- 30-minute reconciliation poll job

### Chunk 13 — Cost Aggregation Parallel Writer + Budget/Channel Routes

- `agentSpendAggregateService.ts`
- New `entityType` values: `agent_spend_subaccount`, `agent_spend_org`, `agent_spend_run`
- Comment-only migration for new values (precedent: `0186`)
- Dashboard query routes: `server/routes/agentCharges.ts` (read-only ledger queries)
- `server/routes/spendingBudgets.ts` (CRUD + promote-to-live)
- `server/routes/spendingPolicies.ts` (CRUD on policy fields)
- `server/routes/approvalChannels.ts` (channel + grant CRUD)
- Net spend calculation (refunds included)
- `spend_approver` default-grant logic in `spendingBudgetService.create()` — grants the permission to the relevant org / sub-account admin atomically with the budget insert. Ships in this chunk so budget creation is never available without default-grant logic (closes the §17 Chunk 16 sequencing gap Codex flagged).

### Chunk 14 — Admin UI

- Spending Budget editor (create, configure policy, conservative-defaults template)
- Spend Ledger dashboard (charges table, filters, status, merchant, amount, mode)
- Approval channel configuration screens (subaccount and org variants)
- Grant management screen (org admin adds/revokes org channels to sub-account fan-out)
- Kill switch surfaces (per-policy, per-subaccount, per-org) in relevant admin panels
- Compute vs Spend tab disambiguation in budget/cost dashboards

### Chunk 15 — Shadow-to-Live Promotion Flow

- HITL-gated promotion action (`promote_spending_policy_to_live`)
- Policy version increment on promotion
- Audit logging for promotion
- Channel notification on promotion request
- UI: "Promote to live" button + confirmation modal + approval state

### Chunk 16 — Default Templates and Onboarding

- Conservative-defaults one-click template button
- Per-org shadow retention configuration: `organisations.shadow_charge_retention_days integer NOT NULL DEFAULT 90` (added in Chunk 2's schema migration; admin UI surface lands in Chunk 16)
- SPT onboarding flow integration with existing `integrationConnections` OAuth UI

(Note: `spend_approver` default-grant logic ships earlier in Chunk 13 alongside the budget-creation endpoint — see Chunk 13 for that line item.)

## 18. File Inventory

### 18.1 New Files

**Schema files (`server/db/schema/`):**
- `spendingBudgets.ts`
- `spendingPolicies.ts`
- `agentCharges.ts`
- `subaccountApprovalChannels.ts`
- `orgApprovalChannels.ts`
- `orgSubaccountChannelGrants.ts`
- `spendingBudgetApprovers.ts`
- `computeReservations.ts` (renamed from `budgetReservations.ts` — Chunk 1)

**Service files (`server/services/`):**
- `chargeRouterService.ts`
- `chargeRouterServicePure.ts`
- `spendingBudgetService.ts`
- `spendingBudgetServicePure.ts`
- `agentSpendAggregateService.ts`
- `sptVaultService.ts`
- `stripeAgentWebhookService.ts`
- `approvalChannelService.ts`
- `approvalChannelServicePure.ts`
- `computeBudgetService.ts` (renamed from `budgetService.ts` — Chunk 1)
- `computeBudgetServicePure.ts` (renamed from `budgetServicePure.ts` — Chunk 1)

**Route files (`server/routes/`):**
- `spendingBudgets.ts` — CRUD + `POST /:id/promote-to-live`
- `spendingPolicies.ts` — `GET`/`PATCH /spending-budgets/:id/policy`
- `agentCharges.ts` — read-only ledger queries
- `approvalChannels.ts` — CRUD for `subaccount_approval_channels`, `org_approval_channels`, and `org_subaccount_channel_grants`
- `webhooks/stripeAgentWebhook.ts`

**Skill files (`server/skills/`):**
- `pay_invoice.md`
- `purchase_resource.md`
- `subscribe_to_service.md`
- `top_up_balance.md`
- `issue_refund.md`

**Config files (`server/config/`):**
- `spendConstants.ts` — `EXECUTION_TIMEOUT_MINUTES` (default 30), `CHARGE_KEY_VERSION` (initial `'v1'`), and any other shared spend-side constants

**Client files (`client/src/`):**
- Spending Budget editor page/component
- Spend Ledger dashboard page/component
- Approval channel configuration component (subaccount)
- Approval channel configuration component (org)
- Grant management component
- Kill switch component
- `renderSpendPayload` function (within `ReviewQueuePage.tsx` or extracted)
- Spend lane in `PendingApprovalCard` (may extend existing file)

**pg-boss queue handlers (`server/jobs/`):**
- Handler for `agent-spend-request` queue (main app consumes; worker produces)
- Handler for `agent-spend-completion` queue (main app consumes; worker produces — only fires for `executionPath: 'worker_hosted_form'` paths after the worker's form-fill resolves)
- Scheduled: execution window timeout job
- Scheduled: approval expiry job
- Scheduled: 30-minute reconciliation poll job
- Scheduled: shadow charge retention purge job

(Note: `agent-spend-response` is produced by the main app and consumed by the worker — no server-side handler is registered for it. The worker-side consumer lives in `worker/src/persistence/runs.ts`.)

### 18.2 Modified Files

**Server:**
- `server/db/schema/organisations.ts` — add `shadow_charge_retention_days integer NOT NULL DEFAULT 90`
- `server/db/schema/integrationConnections.ts` — add `'stripe_agent'` to `providerType`
- `server/services/connectionTokenService.ts` — `stripe_agent` refresh case, parameterise buffer
- `server/services/integrationConnectionService.ts` — add `revokeSubaccountConnection`
- `server/adapters/stripeAdapter.ts` — read `accessToken` for `stripe_agent` connections
- `server/services/policyEngineService.ts` — add `spendDecision` to `PolicyDecision`
- `server/services/policyEngineServicePure.ts` — `evaluateSpendPolicy` pure helper
- `server/services/actionService.ts` — `resolveGateLevel` consumes `spendDecision`
- `server/services/middleware/proposeAction.ts` — `spend_block` audit reason code
- `server/services/agentExecutionService.ts` — planning prelude advisory preview
- `server/config/actionRegistry.ts` — 5 new skills, `spendsMoney` flag, `stripe_agent` integration slug, `SPEND_ACTION_ALLOWED_SLUGS`
- `server/services/skillExecutor.ts` — 5 new `SKILL_HANDLERS` entries
- `server/lib/workflow/actionCallAllowlist.ts` — add `SPEND_ACTION_ALLOWED_SLUGS`
- `server/services/workflowEngineService.ts` — `reviewKind: 'spend_approval'`
- `server/services/costAggregateService.ts` — comment update for new entityType values
- `server/services/agentExecutionEventService.ts` — accept `'spend_ledger'` linkedEntityType
- `server/config/rlsProtectedTables.ts` — add 8 new table entries
- `shared/types/agentExecutionLog.ts` — add `'spend_ledger'` to `LinkedEntityType`
- `shared/iee/actionSchema.ts` — add `spend_request` action
- `shared/stateMachineGuards.ts` — add `agent_charges` state machine
- `worker/src/loop/executionLoop.ts` — spend-request emit branch
- `worker/src/persistence/runs.ts` — `iee-spend-request` event helper
- `client/src/pages/ReviewQueuePage.tsx` — `renderSpendPayload` + ACTION_BADGE entries
- `client/src/components/dashboard/PendingApprovalCard.tsx` — spend lane

**Compute Budget rename (Chunk 1 only):**
- `server/db/schema/budgetReservations.ts` → `computeReservations.ts`
- `server/services/budgetService.ts` → `computeBudgetService.ts`
- `server/services/budgetServicePure.ts` → `computeBudgetServicePure.ts`
- All files that import `budgetReservations`, `BudgetContext`, `BudgetExceededError`, `acquireOrgBudgetLock`, `checkAndReserveBudget`, `releaseBudget`, `commitBudget` (full grep before migration)

### 18.3 Migrations

Minimum 3 migrations. Numbers assigned at merge time per `DEVELOPMENT_GUIDELINES.md`.

| Migration | Scope | Chunk |
|---|---|---|
| `<NNNN>_compute_budget_rename.sql` | `ALTER TABLE budget_reservations RENAME TO compute_reservations`, `ALTER TABLE org_budgets RENAME TO org_compute_budgets`, column renames | 1 |
| `<NNNN+1>_agentic_commerce_schema.sql` | Create all 7 new tables + RLS policies for all 7 + append-only triggers on `agent_charges` (mutable-column allowlist per §5.1) + DB-side state-machine validation in the trigger + `organisations.shadow_charge_retention_days` column | 2 |
| `<NNNN+2>_cost_aggregates_rls_and_spend_dims.sql` | Add `organisation_id` to `cost_aggregates`, canonical RLS policy, backfill, new entityType comment | 2 |
| `<NNNN+3>_integration_connections_stripe_agent.sql` | Add `'stripe_agent'` to `providerType` enum | 3 |

Down migrations required for each (`<NNNN>_<name>.down.sql`). Migration + Drizzle schema file in same PR per `DEVELOPMENT_GUIDELINES.md`.

## 19. Testing Posture

Per `docs/spec-context.md`:

```
testing_posture: static_gates_primary
runtime_tests: pure_function_only
```

**What ships with this build:**
- Vitest unit tests for `chargeRouterServicePure.ts`: policy resolution, cap math (including reserved capacity), idempotency key construction, mode discrimination, merchant allowlist matching, Kill Switch check, execution-timeout logic, `previewSpendForPlan`.
- Vitest unit tests for `spendingBudgetServicePure.ts`: limit calculation, policy version increment, promotion state machine.
- Vitest unit tests for `approvalChannelServicePure.ts`: fan-out logic, first-response-wins, grant/revoke.
- Vitest unit tests for `policyEngineServicePure.ts` extensions: `evaluateSpendPolicy`.

**What does NOT ship with this build (per spec-context):**
- E2E tests.
- Frontend tests.
- API contract tests.
- Full integration tests against a real Stripe environment.

**CI gates apply as normal:** lint, typecheck, `build:server`, `build:client`, `verify-rls-coverage.sh`, `verify-pure-helper-convention.sh`, `verify-idempotency-strategy-declared.sh`, `verify-subaccount-resolution.sh`, `verify-org-scoped-writes.sh`.

## 20. Deferred Items

- **Slack one-tap approval.** v1 ships in-app channel only. `slackConversationService.postReviewItemToSlack` is a stub today. Block Kit + `/slack/interactive` callback is multi-day work. Deferred to a standalone follow-up chunk after this build ships. The `ApprovalChannel` interface is designed to absorb it without core service changes.
- **Email, Telegram, SMS approval channels.** Same deferral rationale. Each adds one adapter file.
- **BriefApprovalCard in-conversation approval path.** Queue-only in v1. In-conversation approval card is a follow-up.
- **Merchant pattern matching and category grouping.** Allowlist matching is exact-match in v1. Pattern matching (`*.domain.com`) and category grouping (all "cloud provider" merchants) deferred.
- **Spend velocity limits (max N charges per minute/hour).** `spending_policies.velocity_config` column is nullable and reserved. Not built in v1.
- **Confidence gating.** Spending Policy may optionally gate on agent confidence score. `spending_policies.confidence_gate_config` column is nullable and reserved. Not built in v1.
- **Charge provenance analytics.** `agent_charges.provenance` column exists in schema but is not populated or used in v1 logic.
- **Kill Switch re-enablement UI.** Not in v1. Re-enabling requires creating a new Spending Budget.
- **Aggregated cross-currency spend dashboard.** v1 shows each budget in its own currency. Cross-currency aggregation deferred.
- **Org-exclusive approval channel mode** (org replaces sub-account channels entirely). Schema supports it; not exposed in v1 UI.
- **`increase_budget` and `update_bid` skill retrofits.** These skills were identified as candidates for spend integration (see exploration report §8.10). Deferred to a follow-up after the core spending primitive ships.
- **Server-minted single-use chargeToken wrapper.** v1 hands the SPT directly to the worker bound to a `ledgerRowId` and relies on Stripe's idempotency header + the `agent_charges.idempotency_key` UNIQUE constraint to prevent reuse (see invariant 3). A future hardening step replaces the raw SPT in the response with a server-minted single-use wrapper that expires after one redemption. Deferred until v1 produces evidence that the protocol-level controls are insufficient.

(Items previously listed here that overlap with §21 Out of Scope — Machine Payments Protocol, Customer-facing SPT issuance, Auto-refund on workflow rollback, Sales Autopilot Playbook spending capability — have been moved to §21 only. They are durable product stances, not deferrals, per the brief addendum.)

## 21. Out of Scope

These are durable product stances, not deferrals. They will not be in follow-up builds without a separate brief and stakeholder decision.

- **Machine Payments Protocol (MPP) and AI-to-AI commerce.**
- **Stripe Tempo, Metronome, and any usage-based billing infrastructure for customers.**
- **Customer-facing SPT issuance** (issuing payment tokens to an end-customer's chatbot).
- **A skills marketplace with revenue share.**
- **Multi-currency policy logic within a single Spending Policy.** Each policy has one declared currency.
- **VAT and tax routing for agent-purchased goods on behalf of clients.** Declared single-purchaser-entity model.
- **Auto-refund on workflow rollback.**
- **Sales Autopilot Playbook spending capability** (in this build cycle).
