# Agentic Commerce — Implementation Plan

**Build slug:** `agentic-commerce`
**Branch:** `claude/agentic-commerce-spending`
**Classification:** Major
**Source spec:** [`tasks/builds/agentic-commerce/spec.md`](./spec.md) (Final — 5 spec-reviewer Codex iterations + 5 chatgpt-spec-review rounds, APPROVED 2026-05-03)
**Author:** architect
**Date:** 2026-05-03
**Status:** **LOCKED** — chatgpt-plan-review APPROVED 2026-05-03 (3 rounds: round 1 added invariants 25-32; round 2 added invariants 33-42 + operational safeguards; round 3 final polish + lock). Build-ready; no further review loop required before implementation.

This plan is the build contract. It does not invent scope outside the spec. Where the spec is authoritative, this plan inherits its decisions and reproduces only the contract anchors a builder needs at hand. Every cross-reference cites a spec section so a builder can trace any decision back to the source.

---

## 0. Model-collapse check

The three questions:

1. Does this feature decompose into ingest → extract → transform → render? **No.** Agentic commerce is a policy enforcement + state machine + audit ledger + RLS-isolated cross-service flow. There is no document or media stream the system extracts facts from.
2. Is each step doing something a frontier multimodal model could do in a single call? **No.** The work is deterministic gating (allowlist match, currency/exponent validation, limit math against settled-plus-reserved capacity, kill-switch double-check, idempotency-key derivation), state-machine enforcement (`stateMachineGuards` plus a DB trigger), and durable persistence under tenant RLS. None of this is jagged-LLM territory; it is exact-arithmetic and exact-string-comparison territory.
3. Can the whole pipeline collapse into one model call with a structured-output schema? **No** — and the answer is durable, not provisional. **Reject collapse.** The reasons (any one is sufficient):
   - **Audit trail.** Every spend attempt must produce a tamper-evident ledger row with policy decision, allowlist trace, idempotency key, and policy-version snapshot. An LLM cannot be the system of record for money movement.
   - **Compliance and legal posture.** Stripe SPT auth, webhook signature verification, kill switch, and three-tier revocation are operator-visible safety surfaces. They must be code paths, not prompts.
   - **Determinism under concurrency.** Optimistic compare-and-set, advisory locks, and the trigger-based append-only contract have correctness guarantees an LLM cannot match.
   - **Tenant isolation.** RLS policies and `provider_charge_id`-keyed webhook resolution are correctness boundaries enforced by Postgres + the application layer, not by a model.

The advisory `previewSpendForPlan` (§7.8) is the only LLM-adjacent surface in the build. It is explicitly fail-open and never blocks execution; live gating is at `proposeAction.ts:294-322` per spec §7.8. That is the right surgical use of LLM context, not a candidate for further collapse.

---

## Table of Contents

0. [Model-collapse check](#0-model-collapse-check)
1. [System Invariants block](#1-system-invariants-block)
2. [Architecture Notes](#2-architecture-notes)
3. [Stepwise Implementation Plan](#3-stepwise-implementation-plan)
4. [Per-Chunk Detail — Chunks 1-4](#4-per-chunk-detail--chunks-1-4)
5. [Per-Chunk Detail — Chunks 5-8](#5-per-chunk-detail--chunks-5-8)
6. [Per-Chunk Detail — Chunks 9-12](#6-per-chunk-detail--chunks-9-12)
7. [Per-Chunk Detail — Chunks 13-16](#7-per-chunk-detail--chunks-13-16)
8. [UX Considerations](#8-ux-considerations)
9. [Risks and Mitigations](#9-risks-and-mitigations)
10. [Executor Notes](#10-executor-notes)

---

## 1. System Invariants block

This block mirrors spec §10 and the canonical terminal state reference at spec §4. It is reproduced here so executors can spot violations during chunk implementation without re-reading the spec. **Treat this as a numbered checklist; every PR review (`spec-conformance`, `pr-reviewer`, `adversarial-reviewer`) walks this list.** Numbering matches spec §10 one-to-one; carve-outs in §4 are surfaced inline.

1. **Ledger row before charge.** `chargeRouterService` writes a `proposed` row in `agent_charges` before contacting Stripe or any external service. No code path reaches Stripe without a ledger row written.
2. **Policy check before execution.** No spend-enabled skill calls Stripe directly. All execution flows through `chargeRouterService.proposeCharge`.
3. **Worker never charges directly.** IEE workers hold no persistent SPT credentials, no DB access to `integration_connections`, and never authorise spend. The SPT delivered to the worker on the `worker_hosted_form` path is ephemeral; the worker MUST drop the variable post-call AND MUST carry `agent_charges.idempotency_key` as Stripe's `Idempotency-Key` header on every merchant call. `agent_charges.idempotency_key` UNIQUE blocks duplicate ledger inserts. **SPT scope is single-iteration:** the `agent-spend-response` payload carries an `sptExpiresAt` timestamp; the worker MUST refuse to use any SPT where `Date.now() >= sptExpiresAt`; the SPT MUST NOT be persisted to disk, log, queue, or any cross-iteration cache; it lives only in the local async function scope of the loop tick that received it and is dropped synchronously post-call.
4. **Idempotency at DB level.** `agent_charges.idempotency_key UNIQUE NOT NULL`. Duplicates resolve via `INSERT ... ON CONFLICT DO UPDATE SET updated_at = NOW() RETURNING *` — H-1 pattern from `compute_reservations` (post-rename).
5. **Tenant isolation.** RLS policies on `spending_budgets`, `spending_policies`, `agent_charges`, the four channel/grant tables, plus the retrofit on `cost_aggregates`. Cross-tenant SPT access is a critical incident.
6. **Shadow charges write to the real ledger.** `mode = 'shadow'` rows carry full policy decision, allowlist trace, and Charge Intent. Shadow is the live execution path with the Stripe call replaced — not a skip.
7. **Kill Switch is synchronous and double-checked.** Once at propose-time (first gate in `chargeRouterServicePure.evaluatePolicy`), once at execute-time (`chargeRouterService.executeApproved` re-reads `spending_budgets.disabled_at` + SPT `connectionStatus` immediately before the Stripe call OR before sending the `agent-spend-response` payload). Late-firing kill switch produces an `approved → blocked` transition with `failure_reason = 'kill_switch_late'`; no `executed` row is written and no SPT is exposed to the worker. In-flight `executed` charges resolve normally via webhook (not reversed). `pending_approval` charges auto-cancelled. No retries permitted after kill.
8. **`cost_aggregates` RLS retrofit ships in the same migration as the new `entityType` values.** No spend data lands without RLS.
9. **No silent drops.** Every proposed charge reaches a truly-terminal state or holds reserved capacity in an explicit non-terminal state. Truly-terminal: `blocked`, `denied`, `failed`, `shadow_settled`, `refunded`. Non-terminal hold reserved capacity: `pending_approval`, `approved`, `executed`, `succeeded`, `disputed`. `succeeded` is functionally settled for skill-level callers but is non-terminal at the state-machine level (can move to `refunded` or `disputed` per §4).
10. **Blocked vs denied.** `blocked` = system-enforced denial (policy, limits, Kill Switch, SPT failure). `denied` = human rejection via HITL. Distinct categories; never collapse them.
11. **Execution window.** An `approved` charge that does not transition to `executed`/`shadow_settled` within `EXECUTION_TIMEOUT_MINUTES` (default 30, in `server/config/spendConstants.ts`) is auto-marked `failed` with `reason = 'execution_timeout'`. `expires_at` is set on EVERY transition INTO `approved` (both `proposed → approved` and `pending_approval → approved`) — a fresh window regardless of HITL wait. The job scans `WHERE status = 'approved' AND expires_at < NOW()` and MUST NOT touch `executed` rows.
12. **Approval window.** `pending_approval` rows past `approval_expires_at` auto-marked `denied` with `reason = 'approval_expired'`. The job scans `WHERE status = 'pending_approval' AND approval_expires_at < NOW()` ONLY — once a row leaves `pending_approval`, `approval_expires_at` is inert.
13. **Compute Budget rename ships first.** Chunk 1 is fully reviewed and merged before any new spending code lands. No spending code references `budgetReservations`, `BudgetContext`, or `BudgetExceededError`.
14. **Dual registration.** Every `ACTION_REGISTRY` entry with `spendsMoney: true` is also registered in `SKILL_HANDLERS`. Orphans don't fail at compile time — the spec must call them out and the reviewer must verify.
15. **Pure/impure split enforced.** Charge router decisions (policy match, cap math, idempotency key build, mode discrimination, currency-exponent validation, merchant-descriptor normalisation) live in `chargeRouterServicePure.ts`. Stripe calls and DB writes live in `chargeRouterService.ts`. Enforced by `verify-pure-helper-convention.sh`. Same split for `spendingBudgetServicePure`, `approvalChannelServicePure`, `policyEngineServicePure`.
16. **Subaccount resolution.** Every route with `:subaccountId` calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming the ID. Gate `verify-subaccount-resolution.sh` enforces this.
17. **Approval audit trail.** Every approval-channel response — winning, losing, late, expired — is recorded on the corresponding `actions` row with `responder` (user_id), `channel_type`, and `responseAt`. Only the winning response (first to win the optimistic compare-and-set on `agent_charges`) drives the ledger transition; others are recorded on `actions` as `responseStatus = 'superseded'`. **The `agent_charges` row is mutated only by the winning response.** SPT-reconnect-required workflow metadata lives on `actions` and `iee_steps`, never on `agent_charges`.
18. **Currency consistency.** `chargeRequest.currency == budget.currency`, enforced by `chargeRouterServicePure.evaluatePolicy`. Mismatch → `blocked` with `failure_reason = 'currency_mismatch'`. Currency on `spending_budgets` is immutable.
19. **Positive amounts only.** `agent_charges.amount_minor > 0` enforced at DB layer (CHECK) AND at `ChargeRouterRequest` boundary in the impure router's propose step.
20. **Webhook precedence on `worker_hosted_form` path.** When `WorkerSpendCompletion` and a Stripe webhook race for the same `executed` row, Stripe is authoritative for the final state. `WorkerSpendCompletion` may ONLY: (a) set `provider_charge_id` on a still-`executed` row, OR (b) transition `executed → failed` on a still-`executed` row when `outcome = 'merchant_failed'`. **`WorkerSpendCompletion` MUST NOT transition to `succeeded`** — that's webhook-only. If the row already left `executed`, the trigger rejects the update; the handler logs `worker_completion_after_terminal` and drops silently (no error to the worker).
21. **Deterministic args AND intent for spend-enabled skills.** Skills with `spendsMoney: true` MUST emit a deterministic `args` payload AND deterministic `intent` string across retries. No embedded timestamps, request IDs, or volatile values. **The `merchant` field inside `args` MUST be normalised via `normaliseMerchantDescriptor` BEFORE the args payload is canonicalised and hashed into the idempotency key** — otherwise descriptor casing/whitespace drift between worker and main-app produces different keys for the same logical charge. Both the worker and the main app perform the same normalisation step; mismatch between worker-supplied `idempotencyKey` and main-app recomputation → reject with `failure_reason = 'idempotency_args_drift'`. Whitelist-based hashing deferred per spec §20.
22. **`executed` entered exactly once.** Only `approved → executed` is a valid path into `executed`; the state machine guard AND the DB trigger reject any other entry. Protects against pg-boss retry, duplicate worker triggers, and race conditions.
23. **Retries always use the latest policy.** A retry charge (new `agent_charges` row under the same `intent_id`) snapshots the CURRENT `spending_policies` row at retry time. `spending_policy_id` and `policy_version` on the original row are AUDIT-ONLY. Recurring charges (subscriptions, scheduled top-ups) likewise re-evaluate.
24. **Webhook amount and currency match invariant.** On `succeeded` events, `stripeAgentWebhookService` MUST verify (a) webhook amount (interpreted via ISO 4217 minor-unit exponent for the webhook's stated currency) equals `agent_charges.amount_minor`, AND (b) webhook currency equals `agent_charges.currency`. On any mismatch (or ambiguous exponent): hold the row in `executed`, fire `ledger_amount_mismatch` critical alert, surface for manual reconciliation. **All `amount_minor` values are ISO 4217 minor units** — USD/EUR/GBP cents (×10²); JPY/KRW whole units (×10⁰); BHD/KWD fils (×10³). `chargeRouterService.proposeCharge` rejects amounts inconsistent with the declared currency's exponent (e.g. fractional minor units; `0.5` of any currency is invalid). **Outbound-request twin (request-creation boundary):** every outbound Stripe charge / refund call in `chargeRouterService.executeApproved` MUST first call `validateAmountForCurrency(amount_minor, currency)` immediately before building the Stripe request body; failure → `approved → blocked` with `failure_reason = 'currency_amount_invalid'` and no Stripe call made. Same pure helper used at request creation and at webhook processing — single source of truth for ISO 4217 exponent rules.

25. **Capacity reads inside the lock.** All reads of reserved-plus-settled capacity used by `evaluatePolicy` MUST occur inside the same `pg_advisory_xact_lock(spending_budget_id)` scope as the subsequent UPDATE that consumes capacity. Reading capacity outside the lock and writing inside is a correctness bug — two concurrent transactions can both pass limit math and both insert. Applies to `chargeRouterService.proposeCharge` (propose-time gate) and to any future code path that reserves capacity. Reviewer checklist: confirm no code path reads `agent_charges` aggregate sums for limit decisions outside an advisory-lock-held transaction.

26. **Stripe retry classification is canonical.** `chargeRouterService` calls Stripe via `withBackoff` with the canonical HTTP-status classification table (Chunk 5 §5):

    | Class | Behaviour |
    |---|---|
    | 401 (auth) | Refresh SPT once via `connectionTokenService.refreshIfExpired`, then retry once. Second 401 → `failed` with `failure_reason = 'spt_auth_failed'`. |
    | 402 (card declined / business failure) | `failed` with `failure_reason = 'card_declined'`. No retry. |
    | 409 (idempotency conflict) | Treat as success-on-prior-call: re-read Stripe by idempotency key; if Stripe reports the original outcome, apply that outcome to the row. No new charge attempted. |
    | 429 (rate limited) | Retry with backoff (`withBackoff` defaults). Max attempts: 3. After max → `failed` with `failure_reason = 'stripe_rate_limited'`. |
    | 5xx (server error) | Retry with backoff. Max attempts: 3. After max → `failed` with `failure_reason = 'stripe_unavailable'`. |
    | other 4xx | `failed` with `failure_reason = '<stripe_error_code>'`. No retry. |

    No code path may invent its own classification. Single helper (`classifyStripeError(err): RetryClass`) lives in `chargeRouterServicePure.ts` and is the only authority.

27. **Aggregator idempotency.** `agentSpendAggregateService.upsertAgentSpend(charge)` MUST be idempotent per `(chargeId, terminal_state)` tuple. Webhook redelivery, out-of-order compensation, and the reconciliation-poll-job arriving for the same logical event MUST NOT double-count. Implementation: track `agent_charges.last_aggregated_state` (a column added by Chunk 2's migration, NULL on insert) and only apply the upsert when the new terminal state is distinct from `last_aggregated_state`; the upsert and the column update happen in the same transaction.

28. **Aggregates non-negative per window.** Per-window rollups in `cost_aggregates` (every dimension: `agent_spend_subaccount`, `agent_spend_org`, `agent_spend_run`) MUST NOT go below zero. Refund / dispute-loss subtractions clamp at zero AND emit a `negative_aggregate_clamp` warning alert (carries the offending `chargeId`, `dimension`, `windowKey`, attempted-delta, pre-clamp value). The parent `agent_charges` row remains the source of truth; the aggregate is a derived view, and a clamp event signals derived-view drift that needs manual investigation, not a financial loss.

29. **One active promotion per spending policy.** Only one `actions` row with `actionType = 'promote_spending_policy_to_live'` and `status = 'pending_approval'` may exist per `spending_policy_id` at any time. Enforced by service-layer guard in Chunk 15 (`spendingBudgetService.requestPromotion`): pre-insert SELECT under advisory lock keyed on `spending_policy_id`; if a pending row exists → return `{ outcome: 'promotion_already_pending', actionId }` rather than creating a duplicate. Optional belt-and-braces: partial unique index `UNIQUE (spending_policy_id) WHERE status = 'pending_approval' AND action_type = 'promote_spending_policy_to_live'` on `actions` (implementer chooses; the service-layer guard is mandatory regardless).

30. **`agent_charges.status` is a closed enum at the DB layer.** Postgres ENUM type (`agent_charge_status`) listing every state from §4 — `proposed`, `pending_approval`, `approved`, `executed`, `succeeded`, `failed`, `blocked`, `denied`, `disputed`, `shadow_settled`, `refunded`. String drift (typos, ad-hoc values) impossible at the column level. The trigger's CASE expression and `shared/stateMachineGuards.ts` pull from the same closed set. Same closed-enum treatment for `last_transition_by` (per Chunk 2) and for `mode` (`'shadow' | 'live'`).

31. **Structured transition logging.** Every status transition on `agent_charges` MUST emit one structured log line carrying: `chargeId`, `from` (previous status), `to` (new status), `reason` (`failure_reason` if blocked/failed/denied, otherwise the trigger label like `auto_approved` / `webhook_succeeded` / `worker_completed`), `caller` (the value written to `last_transition_by`), `lastEventId` (`last_transition_event_id` if set — Stripe event id or pg-boss job id). Levels: INFO for happy paths (`approved`, `executed`, `succeeded`, `shadow_settled`); WARN for `blocked`, `denied`, `failed`; ERROR for trigger rejections caught at the application layer. No transition is "silent" — silent transitions defeat post-hoc audit. Single helper `logChargeTransition(args)` in `server/lib/spendLogging.ts` (Chunk 2) is the only authority; every writer (`chargeRouterService`, `stripeAgentWebhookService`, the timeout/approval jobs, the worker-completion handler) calls it.

32. **Merchant allowlist max size.** `spending_policies.merchant_allowlist` capped at `MERCHANT_ALLOWLIST_MAX_ENTRIES = 250` distinct entries (`server/config/spendConstants.ts`). Validated at the service layer (Chunk 13: `spendingBudgetService.create` and `update`); >250 → 400 with `validation_error: 'allowlist_too_large'`. UI surfaces the cap (Chunk 14: counter `n/250` next to the allowlist editor; warning banner at 90 % capacity). Pathological policies are rejected before they reach `chargeRouterServicePure.evaluatePolicy`.

33. **Terminal precedence under late-arriving events.** When a worker-completion, webhook, or job-driven transition attempts to write a status that would regress the row's progress, the trigger MUST reject and the application MUST log `transition_after_terminal` and drop silently. Precedence ordering: `succeeded` > `failed` > `executed` > `approved` > `pending_approval` > `proposed`. Sibling-terminals on the truly-terminal row (`refunded`, `denied`, `blocked`, `shadow_settled`) are never re-entered. The `failed → succeeded` carve-out (timeout reconciliation) moves UP the precedence chain and is permitted via the existing `app.spend_caller = 'stripeAgentWebhookService'` GUC gate (invariant 7's carve-out). Generalises invariants 20 and 22; eliminates the worker-vs-webhook last-write-wins race entirely.

34. **Stripe metadata carries `agent_charge_id` and `mode`; `provider_charge_id` namespace is shadow/live-disjoint.** Every outbound Stripe API call (charge, refund, customer create) populates `metadata.agent_charge_id = <agent_charges.id>` and `metadata.mode = 'live'`. Shadow rows skip Stripe entirely (no API call, no metadata, no `provider_charge_id` — value remains NULL); live rows populate `provider_charge_id` only after Stripe confirms. There is no path by which a shadow row produces a `provider_charge_id`, so shadow/live cannot collide on this column even at the type level. Allows post-hoc reconciliation in the Stripe dashboard and operator forensics if a local ledger row is lost.

35. **External calls live OUTSIDE advisory-lock scope.** No outbound HTTP, Stripe API, merchant API, queue dispatch, or any other I/O that can stall MAY occur inside the `pg_advisory_xact_lock(spending_budget_id)` scope. The lock-held transaction is bounded to: (a) read aggregates, (b) call pure `evaluatePolicy`, (c) UPDATE `agent_charges` to the gate outcome, (d) COMMIT (releases lock). The Stripe call lives in `executeApproved`, AFTER COMMIT. Lock contention under high-frequency agents on the same budget would otherwise stall on Stripe latency and throughput would collapse. Reviewer checklist: walk every `withOrgTx` block in `chargeRouterService` and confirm no `await stripeAdapter.*` / `await pgBoss.send` calls sit between BEGIN and COMMIT. CRITICAL.

36. **Approval validity revalidated at execution time.** Before `executeApproved` calls Stripe (or sends the SPT to the worker on the `worker_hosted_form` path), it MUST re-read `agent_charges.expires_at` and confirm `NOW() < expires_at`. Late approvals (HITL granted near-expiry, picked up after) → `approved → failed` with `failure_reason = 'execution_window_elapsed'`; no Stripe call, no SPT exposure. Orthogonal to the kill-switch double-check (invariant 7) and the SPT-validity double-check (invariant 7); all three checks happen at the execute-time gate.

37. **Webhook dedupe is multi-layered.** Three layers of protection against duplicate processing:
    - **Primary:** `webhookDedupeStore` keyed on Stripe event id (TTL ≥ 96 h per invariant 24's TTL companion in Chunk 12).
    - **Secondary (DB-layer fallback):** before applying any transition, `stripeAgentWebhookService` checks `agent_charges.last_transition_event_id`; if the inbound Stripe event id matches, return 200 with no transition (already applied).
    - **Tertiary:** the trigger's monotonicity check rejects regression / out-of-order replays.

    A dedupe-store outage degrades to two-layer protection (event-id idempotency at the row + trigger monotonicity); operators receive a `dedupe_store_degraded` warning alert. No single-component failure permits duplicate transitions.

38. **Cross-system trace propagation.** Every spend-touching operation propagates a `traceId` across boundaries: `chargeRouterService.proposeCharge` → `agent-spend-request` queue → worker `executionLoop` → `agent-spend-completion` queue → `stripeAgentWebhookService` → reconciliation poll job → aggregator. Source: `traceId = agent_runs.id` for charges initiated by an agent run; new uuid for direct-call retries. Logged on every `logChargeTransition` line per invariant 31 as `traceId`. Single `withTrace(traceId, async () => { ... })` helper in `server/lib/spendLogging.ts` (Chunk 2) attaches the id to async-local-storage so handlers don't need to thread it explicitly through every internal call.

39. **Operational alert thresholds and silent-degradation metric.** Concrete triggers, default values pinned in `server/config/spendAlertConfig.ts` (Chunk 13):
    - `negative_aggregate_clamp` → ALWAYS critical (no threshold, single occurrence triggers).
    - Webhook delivery delay (Stripe event timestamp vs `stripeAgentWebhookService` receipt) > 10 minutes → warning.
    - Charge retry attempts (per `intent_id`) > 3 → warning.
    - Advisory-lock wait time on `pg_advisory_xact_lock(spending_budget_id)` > 1000 ms → warning.
    - **Silent-degradation metric:** rate of `proposed → terminal` transitions per minute, per organisation. If the rate falls below 50 % of the trailing-7-day-rolling baseline → warning; below 20 % for >5 minutes → critical (`spend_throughput_anomaly`). Surfaces stuck queues, webhook outages, advisory-lock starvation. Defaults tunable per environment via `spendAlertConfig`.

40. **Provider abstraction boundary.** Provider-specific failure-reason strings, provider-specific webhook event types, and provider-specific request/response shapes live in `server/adapters/stripeAdapter.ts` and `server/services/stripeAgentWebhookService.ts`. Core `agent_charges` state machine (`shared/stateMachineGuards.ts`) and `chargeRouterServicePure.evaluatePolicy` MUST remain provider-neutral — no Stripe enum imports, no Stripe-typed errors. The single allowed exception is `chargeRouterServicePure.classifyStripeError` (a pure decision function over Stripe HTTP statuses); future multi-provider work either generalises to `classifyProviderError(provider, err)` or duplicates per provider. Reviewer checklist: grep `stripe` (case-insensitive) in `shared/stateMachineGuards.ts` — zero hits required; grep in `chargeRouterServicePure.ts` — only `classifyStripeError` may match.

41. **Operator-initiated refunds are append-only.** The `issue_refund` skill creates a NEW `agent_charges` row with `kind = 'inbound_refund'` (column added in Chunk 2's migration), `parent_charge_id = <original charge id>`, `direction = 'subtract'`. The original outbound `succeeded` row is NOT mutated. Aggregator handles via the inbound-refund subtract path (Chunk 13). **Dispute-path note:** the spec's existing `succeeded → disputed → refunded` transition path on the original row is preserved for v1 because Stripe's chargeback model targets the original charge object directly; reframing dispute-loss as an inbound-chargeback row is a candidate spec simplification but not in this build's scope. Reviewer checklist: confirm `issue_refund`'s skill handler creates a new row (does not call `UPDATE agent_charges SET status='refunded'` on the parent).

42. **Half-open window intervals.** Daily, monthly, and any future policy-window aggregation uses half-open `[start, end)` semantics in `agentSpendAggregateService` and `chargeRouterServicePure.evaluatePolicy`. A charge at exactly `2026-05-04T00:00:00Z` falls into the May day window, not April; a charge at exactly `2026-06-01T00:00:00Z` falls into June, not May. Pure helper `deriveWindowKey(timestamp, dimension, windowType)` in `chargeRouterServicePure.ts` is the single source of truth for boundary derivation. Pinned by unit tests covering the boundary cases. Eliminates the boundary double-count / off-by-one class of bugs.

### Canonical terminal state reference (mirrors spec §4)

| Classification | States | Outbound transitions |
|---|---|---|
| **Truly-terminal** (immutable except shadow purge) | `blocked`, `denied`, `shadow_settled`, `refunded` | None |
| **Provisionally-terminal** (terminal for skill-level callers; one carve-out applies) | `failed` | `failed → succeeded` ONLY via Stripe webhook on `roundtrip_timeout` or `execution_timeout` rows. No other post-terminal transition permitted. Caller-identity check at app and DB layers. |
| **Functionally-settled** (treated as success by callers; NOT truly-terminal) | `succeeded` | `succeeded → refunded` (operator refund or dispute loss); `succeeded → disputed` (chargeback opened). Both webhook-driven. |
| **Non-terminal** (in-flight; reserved capacity counted in limit math) | `proposed`, `pending_approval`, `approved`, `executed`, `disputed` | Per spec §4 transitions table. |

> **Single authoritative table.** Every section that mentions "terminal" must align with this table. When a chunk's wording disagrees with this table, this table wins. The `failed → succeeded` carve-out is the only post-truly-terminal transition; only `stripeAgentWebhookService` may apply it; double-enforced (app + DB trigger).

---

## 2. Architecture Notes

The spec is the source of truth for every architectural decision below. This section captures the decisions the builder will hit early and often, plus the rejected alternatives so reviewers can verify the chosen path was deliberate.

### 2.1 Vocabulary lock as a hard prerequisite

**Decision.** Chunk 1 (Compute Budget rename) merges fully reviewed before any spending code lands. After the rename, the bare word `Budget` does not appear in any new code, prose, migration comment, UI label, or event name; it is always qualified as `Compute Budget` or `Spending Budget`.

**Why.** Two budget concepts coexist in the same codebase. Without the rename first, every subsequent PR has to disambiguate at every grep, lint, and review boundary. The cost is ambient and compounding — operators see "Budget" in two different UIs, gate scripts can't distinguish the two domains, and `BudgetExceededError` becomes ambiguous in stack traces.

**Considered and rejected.** "Rename later as a follow-up" — rejected because every spending-side file would import or reference the old names, making the rename a touch-everywhere PR with no clear seam. "Rename incrementally per chunk" — rejected because partial renames break grep-based reviewer workflows.

**Locked outcome.** Invariant 13 of §10 / §1 of this plan.

### 2.2 Pure/impure split applied exactly once per service

Standard Automation OS pattern (`*ServicePure.ts` for decisions, `*Service.ts` for I/O). Mandatory on `chargeRouter`, `spendingBudget`, `approvalChannel`, and the `policyEngineService` extension. Enforced by `verify-pure-helper-convention.sh`.

A note specific to Chunk 1: `server/services/budgetService.ts` does NOT yet have a `*Pure.ts` companion in the current repo. The Chunk 1 rename therefore both renames the file AND extracts the existing pure decisions into a new `computeBudgetServicePure.ts` to keep the gate satisfied. The spec's wording "renamed from `budgetServicePure.ts`" is a hand-wave; the executor must treat this as "extract pure on the rename." Per-chunk detail flags this in Chunk 1.

### 2.3 Append-only `agent_charges` enforced by trigger

**Decision.** `BEFORE UPDATE` and `BEFORE DELETE` triggers on `agent_charges`. The trigger permits UPDATEs only when (a) the new status is reachable from the old status per a mirror of `shared/stateMachineGuards.ts::assertValidTransition`, AND (b) only columns from the explicit "mutable-on-transition allowlist" (spec §5.1) are written. DELETE permitted only by the retention purge job, identified by an explicit session role / GUC.

**Why.** Other ledger tables in the codebase (`llm_requests`, `audit_events`, `mcp_tool_invocations`) rely on app-layer-only enforcement. Financial records warrant stronger durability — a code path that bypasses `chargeRouterService` and writes directly to `agent_charges` would corrupt the audit trail invisibly. The trigger is belt-and-braces.

**Considered and rejected.** App-layer-only enforcement (the pattern of neighbour ledgers) — rejected because of the audit-trail-integrity argument above. A lighter "check no terminal-state row is updated" trigger — rejected because it doesn't catch the mutable-allowlist class of bugs (e.g. a code path that mutates `amount_minor` post-insert). The §5.1 allowlist + state-machine pairing closes both classes.

**Carve-out.** The `failed → succeeded` post-terminal transition (timeout-row + Stripe-confirmed-success — §4 rules) is whitelisted in BOTH `stateMachineGuards` AND the trigger, gated on caller identity matching `stripeAgentWebhookService`.

### 2.4 `cost_aggregates` RLS retrofit ships in lockstep with new dimensions

**Decision.** A single migration (`<NNNN+2>_cost_aggregates_rls_and_spend_dims.sql`, Chunk 2) adds `organisation_id`, applies the canonical org-isolation policy, backfills existing rows, and carries the comment-only marker for the three new entityType values (`agent_spend_subaccount`, `agent_spend_org`, `agent_spend_run`). The new entityType values are not used by any code path until Chunk 13 ships; the migration order guarantees no spend data lands before RLS.

**Why.** Today `cost_aggregates` is RLS-unprotected because it carries aggregate totals with no PII. New spend dimensions change that calculus — per-subaccount and per-org spend rollups are tenant-sensitive. Shipping the dimensions first and the RLS later opens a window where spend data lands in an unprotected table.

**Backfill strategy.** Existing aggregate rows have one of `entityType ∈ {organisation, subaccount, run, agent, ...}`. `organisation_id` is resolvable for each via the existing FK chain (`subaccount → organisation`, `run → organisation`, etc.). The migration runs the backfill before applying `NOT NULL`. Out-of-band entityTypes (`platform`, `provider`) that have no per-tenant scope must be excluded from the policy via a partial policy or a sentinel `organisation_id` value; the spec defers this implementation choice to the migration author. Plan acceptance criterion: every row of `cost_aggregates` has `organisation_id IS NOT NULL` post-migration, and every read path that previously worked still works.

**Considered and rejected.** Two-step migration — adds RLS first, dimensions second — rejected because it doubles the migration count without changing the correctness window meaningfully. Comment-only-migration-then-spend-write later is the agreed precedent (§0186 for `source_type` dimension).

### 2.5 SPT storage on `integration_connections` — extension, not new table

**Decision.** Add `'stripe_agent'` to `integration_connections.providerType`. SPT in `accessToken` (encrypted via `connectionTokenService`). Webhook secret in `configJson.webhookSecret`. New `case 'stripe_agent':` in `connectionTokenService.performTokenRefresh`.

**Why.** `integration_connections` already has token rotation, encryption-at-rest, P3B principal-scoped RLS, audit logging on revoke, and a refresh-with-lock pattern. Re-implementing for one new provider would duplicate every one of those concerns. The spec's primitive-reuse decision is correct.

**Adjustment.** `refreshIfExpired`'s 5-minute buffer is parameterised per provider. Stripe SPT rotation may need a longer pre-roll; the buffer becomes a per-provider config rather than a constant. This is the smallest change that keeps existing providers (5 min) unchanged while allowing Stripe to pick its own value.

**Considered and rejected.** A new `stripe_spt_vault` table — rejected because it duplicates token rotation and RLS from `integration_connections`. A custom encryption envelope — rejected because `connectionTokenService` already handles AES-256-GCM with key rotation.

### 2.6 IEE worker round-trip via pg-boss request-reply, 30s deadline

**Decision.** Three queues: `agent-spend-request` (worker → main app), `agent-spend-response` (main app → worker, by `correlationId`), `agent-spend-completion` (worker → main app, fires only on `worker_hosted_form` paths). 30-second deadline on the IMMEDIATE response only; HITL approval and merchant form-fill latency are uncoupled from this deadline.

**Why.** The worker has no DB access to `integration_connections` and holds no SPT credentials. Sync HTTP between worker and app — rejected for the same reason IEE was built database-first: it complicates ops, requires service discovery, and breaks under network partition. Pre-minted permits — rejected because they pre-commit limit math to a transaction that may never happen, distorting reserved-capacity accounting.

**Failure modes pinned.** If no immediate response within 30s: worker logs the timeout + abandons; the main app's execution-window timeout job reconciles the orphaned `proposed`/`pending_approval` row to `failed` with `reason = 'roundtrip_timeout'` once `expires_at` passes. Worker MUST NOT write to `agent_charges` (invariant 1 — main app reserves all ledger writes).

### 2.7 Two `executionPath` values, not one — orthogonal to `mode`

**Decision.** `executionPath: 'main_app_stripe' | 'worker_hosted_form'` declared per-skill on `ActionDefinition`. `mode: 'shadow' | 'live'` carried per-policy on `spending_policies`. They are orthogonal: shadow + main_app_stripe, shadow + worker_hosted_form, live + main_app_stripe, live + worker_hosted_form are all valid.

**Why.** Some merchants accept direct Stripe API calls (`pay_invoice`, `issue_refund` — the main app calls Stripe and writes the `executed` row with `provider_charge_id` populated). Others require filling a hosted payment form (`purchase_resource`, `subscribe_to_service`, `top_up_balance` — the main app writes the `executed` row WITHOUT `provider_charge_id`, hands the SPT to the worker, and the worker fills the form, then reports completion via `WorkerSpendCompletion`). Conflating the two paths into one would either force every charge through the worker (slow) or force every merchant to expose a Stripe API (impossible).

**Considered and rejected.** A single uniform path — rejected because real-world merchants do not consistently expose Stripe API. Three or more paths (e.g. "card-on-file", "redirect-flow") — rejected because the v1 surface is exactly two; further splits emerge if and when concrete merchants drive them.

### 2.8 ApprovalChannel interface ships with one implementation (in-app)

**Decision.** `ApprovalChannel` interface defined; `InAppApprovalChannel` is the v1 implementation. Slack, email, Telegram, SMS deferred (see spec §20). Every channel adapter is one file; the core service owns fan-out + first-response-wins + grant/revoke lifecycle.

**Why.** Adapter pattern fits exactly here: external interface (Slack signature schemes, email reply-token handling, SMS callback URLs) varies; the core state machine doesn't. Open/closed: new adapters add a file; the core stays untouched.

**Considered and rejected.** Ship Slack at the same time — rejected because `slackConversationService.postReviewItemToSlack` is a stub today and Slack Block Kit + interactive callbacks is multi-day work. Skip the interface and inline the in-app code path — rejected because future Slack/email work would have to extract the interface anyway, paying the cost twice.

### 2.9 Trigger-based webhook precedence on the `worker_hosted_form` path

**Decision.** The DB trigger for `agent_charges` rejects any `WorkerSpendCompletion`-style update that would advance state past what's allowed (per invariant 20). The `agent-spend-completion` handler relies on this trigger for monotonicity rather than re-checking state in application code.

**Why.** Two writers can race for the same `executed` row: Stripe's webhook (authoritative) and the worker's completion message. The trigger is the only place the precedence rule can be enforced atomically — application code that reads-then-writes leaves a race window between read and write. The trigger's "valid transition" check is the same one used by every other writer.

**Failure path.** When the trigger rejects, the application catches the rejection, logs `worker_completion_after_terminal` with the row id and final status, and drops the message silently. No error surfaces to the worker — the webhook outcome is already correct.

### 2.10 Single source of truth at every flow boundary

The spec already declares this in §8.6:
- **Stripe = financial source of truth.** Stripe webhook stream is authoritative for whether money moved.
- **Spend Ledger = system source of truth.** Authoritative for agent intent, policy decisions, audit history.
- **Reconciliation flows one way only.** Stripe outcome updates ledger status; ledger intent record is immutable (trigger-enforced).
- **Read paths.** Read `agent_charges` for audit history and intent; read Stripe API for live payment state where needed. Don't query both and reconcile at read time.

The plan inherits this precedence verbatim. Per-chunk detail does not relitigate it; reviewers should reject any chunk PR that introduces a second writer to `agent_charges` outside of `chargeRouterService`, `stripeAgentWebhookService`, the timeout/expiry jobs, the worker-completion handler, and the retention purge job.

### 2.11 Reuse points — what this build extends rather than reinvents

| Existing primitive | How agentic commerce extends it |
|---|---|
| `integration_connections` + `connectionTokenService` | New `'stripe_agent'` provider type; new refresh case; per-provider buffer parameter |
| `actions` + `actionService.proposeAction` + `proposeAction` middleware | `metadata_json.category: 'spend'`; new `reason: 'spend_block'` audit code; `spendDecision` consumed by `resolveGateLevel` |
| `policyEngineService` + `policyEngineServicePure` | New `spendDecision` field on `PolicyDecision`; new `evaluateSpendPolicy` pure helper |
| `cost_aggregates` + `costAggregateService` | RLS retrofit; three new `entityType` values; new parallel writer `agentSpendAggregateService` (kept separate to prevent commingling with LLM costs) |
| `review_items` + `ReviewQueuePage.tsx` + `PendingApprovalCard.tsx` | New spend-payload renderer; fourth spend lane; new `spend_approver` permission |
| `workflowEngineService` + `actionCallAllowlist` + `action_call` step | New spend slugs in `SPEND_ACTION_ALLOWED_SLUGS`; new `reviewKind: 'spend_approval'` |
| `webhookDedupeStore` + per-route raw-body parser pattern | Reused as-is in the new Stripe webhook route |
| `shared/stateMachineGuards.ts` | Extended with `agent_charges` machine; same pattern as `agent_runs` and `iee_runs` |
| `agent_execution_events` (Live Agent Execution Log) | New `'spend_ledger'` `linkedEntityType`; one cross-reference event per charge attempt |
| `withOrgTx` + `getOrgScopedDb` + `withAdminConnection` | RLS context for tenant-scoped reads; admin-bypass for the webhook-route lookup before tenant resolution |
| `withBackoff` + `runCostBreaker` | `runCostBreaker` is for LLM cost ceilings; agentic-commerce does NOT touch it. `withBackoff` is the retry helper for any external call (Stripe API + Stripe token refresh) |
| `IDEMPOTENCY_KEY_VERSION` (`server/lib/idempotencyVersion.ts`) | Parallel constant `CHARGE_KEY_VERSION` in `server/config/spendConstants.ts` (initial `'v1'`); same load-time `/^v\d+$/` assert; same retry/replay contract |
| Conservative-defaults pattern (one-click template) | Mirror of "Load conservative defaults" in other admin surfaces |
| `audit_events` | NOT used as the spend-event log (its fire-and-forget durability is wrong); used only for kill-switch and policy-edit audit |

This is the primitives-reuse evidence. Anything claimed as "new" elsewhere in this plan should be the genuinely-new column above.

---

## 3. Stepwise Implementation Plan

The 16 chunks the spec proposes (§17) are sound and reproduced here as the implementation order. The plan adds an explicit dependency graph, parallelisation notes, and a chunk-level merge gate strategy. Wall-clock estimate: 4 weeks single-builder; 2.5–3 weeks with parallelism on Chunks 4–5 and 13–14.

### 3.1 Chunk list (ordered)

| # | Chunk | Hard prereqs | Soft prereqs | Notes |
|---|---|---|---|---|
| 1 | Compute Budget Rename | none | none | **Merge gate.** Must ship and pass full review before any spending code lands on the branch. Invariant 13. |
| 2 | Schema + RLS for New Tables | 1 | none | Migrations + Drizzle schema files + `rlsProtectedTables.ts` + append-only triggers + state-machine extension in `shared/stateMachineGuards.ts`. |
| 3 | SPT Vault and Connection Lifecycle | 1, 2 | none | `'stripe_agent'` providerType, `connectionTokenService` refresh case, `revokeSubaccountConnection`, `sptVaultService.ts`, `stripeAdapter` agent-spend path. |
| 4 | Charge Router Pure | 1, 2 | none | Heavy unit-test chunk. No DB, no Stripe. `chargeRouterServicePure.ts` only. |
| 5 | Charge Router Impure | 1, 2, 3, 4 | none | The propose → gate → execute four-step flow. Calls Stripe via `sptVaultService`. |
| 6 | Action Registry + Skill Handlers (5 skills) | 1, 5 | none | `spendsMoney` flag, `executionPath` flag, five skill markdown files, `SPEND_ACTION_ALLOWED_SLUGS`, dual-registration in `SKILL_HANDLERS`. |
| 7 | Policy Engine Extension | 1, 4 | 6 (for invariant 14 verification) | `spendDecision` on `PolicyDecision`; `evaluateSpendPolicy` pure helper; `higherGate()` merge; advisory `previewSpendForPlan` hook in planning prelude. |
| 8 | HITL Surface | 1, 2, 6 | none | `metadata_json.category: 'spend'`, spend payload renderer, fourth spend lane, `spend_approver` permission. |
| 9 | Approval Channel Interface + In-App Implementation | 1, 2, 8 | none | Channel adapter framework + first-response-wins + grant/revoke + `spending_budget_approvers` CRUD. |
| 10 | Workflow Engine Wiring | 1, 6, 8 | none | Allowlist concat, `reviewKind: 'spend_approval'`, `'spend_ledger'` in `LinkedEntityType`. |
| 11 | Worker Round-Trip | 1, 5 | none | Three queues (`agent-spend-request`, `agent-spend-response`, `agent-spend-completion`), worker-side helpers, `shared/iee/actionSchema.ts` extension, main-app handlers including the §10 invariant 20 webhook-precedence rule. |
| 12 | Stripe Webhook Ingestion | 1, 2, 3, 5 | none | `server/routes/webhooks/stripeAgentWebhook.ts`, `stripeAgentWebhookService`, signature verification, dedupe via `webhookDedupeStore`, state transitions, amount/currency invariant check (§10 invariant 24), 30-min reconciliation poll job. |
| 13 | Cost Aggregation Parallel Writer + Budget/Channel Routes | 1, 2, 5, 9 | none | `agentSpendAggregateService` (new file, never call from `costAggregateService.upsertAggregates`), CRUD routes for `spending_budgets` / `spending_policies` / `agent_charges` (read-only) / `approval_channels`, `spend_approver` default-grant logic. **The `POST /:id/promote-to-live` route ships as a 501 stub in this chunk; Chunk 15 fills in the real implementation.** |
| 14 | Admin UI | 1, 13 | 5 (so the routes return real data) | Eight client surfaces (see §8 — UX Considerations). |
| 15 | Shadow-to-Live Promotion Flow | 1, 9, 13, 14 | none | Replaces Chunk 13's stub; `promote_spending_policy_to_live` HITL action; policy version increment; channel notification; promotion confirmation modal in UI. |
| 16 | Default Templates and Onboarding | 1, 13, 14 | none | One-click conservative-defaults; per-org shadow retention admin surface; SPT onboarding wizard hookup. |

### 3.2 Dependency graph (forward-only edges)

```
1 (Compute Budget Rename) ─┐
                           │
                           ▼
                           2 (Schema + RLS) ─────────────────┐
                           │                                  │
                           ├─► 3 (SPT Vault) ──┐              │
                           │                   │              │
                           ├─► 4 (Pure Router)─┼──► 5 (Impure Router) ──┐
                           │                   │                         │
                           │                   │                         ├─► 6 (Skills)
                           │                   │                         ├─► 11 (Worker)
                           │                   │                         ├─► 12 (Webhook)
                           │                   │                         │
                           │                   │              ┌────────► 13 (Aggregator + Routes)
                           │                   │              │           │
                           ├─► 7 (Policy ext) ◄┘              │           ├─► 14 (Admin UI) ──┐
                           │                                  │           │                   │
                           ├─► 8 (HITL Surface) ──► 9 (Approval Channel) ─┤                   ├─► 15 (Promotion)
                           │                                  │           │                   │
                           │                                  │           │                   └─► 16 (Defaults)
                           └─► 10 (Workflow) ────────────────►┘           │
                                                                          │
                                                              (13 depends on 9 for default-grant
                                                               logic, but channel CRUD routes
                                                               can ship in 13 ahead of 9's
                                                               first-response-wins service.)
```

All edges are forward-only; no chunk depends on a later chunk. The merge gate is Chunk 1; every other chunk may submit a PR for review once its prereqs are merged.

### 3.3 Parallelisation notes

- **Chunks 4 ↔ 5 (Pure Router ↔ Impure Router).** Two builders. Chunk 4's pure file is dependency-free once schema (Chunk 2) is merged. Chunk 5's builder takes the pure interface as a contract and stubs/mocks the pure module while writing the impure side; both PRs land together (5 may merge a few hours after 4 once the pure exports finalise). Concretely: Chunk 4 ships the exported pure functions with full Vitest coverage; Chunk 5 imports them and stitches the propose → gate → execute flow.
- **Chunks 13 ↔ 14 (Backend routes ↔ Admin UI).** Two builders. Chunk 13 is the route + service layer (returns real data once Chunk 5 merges); Chunk 14 is the React client wiring against those routes. Builder 14 mocks Chunk 13's responses while Chunk 13 stabilises, then swaps to live data once Chunk 13 lands.
- **Chunks 6, 7, 8** can land in any internal order once their prereqs merge — they are independent of each other. A single builder can sequence them; two builders can split them.

### 3.4 Migration sequencing

Per spec §18.3, four migrations:

| Migration | Scope | Chunk | Reversibility |
|---|---|---|---|
| `<NNNN>_compute_budget_rename.sql` | `RENAME TABLE budget_reservations TO compute_reservations`, `RENAME TABLE org_budgets TO org_compute_budgets`, column renames per spec §2 (`monthly_cost_limit_cents → monthly_compute_limit_cents` etc.) | 1 | Down: reverse the renames. Hand-rolled `*.down.sql` per `DEVELOPMENT_GUIDELINES.md`. |
| `<NNNN+1>_agentic_commerce_schema.sql` | All 7 new tables + RLS policies + closed enum types (`agent_charge_status`, `agent_charge_mode`, `agent_charge_kind`, `agent_charge_transition_caller`) + append-only triggers on `agent_charges` (mutable-column allowlist + state-machine validation including `failed → succeeded` carve-out) + `agent_charges.amount_minor CHECK > 0` + `agent_charges.last_transition_by NOT NULL DEFAULT 'charge_router'` + `agent_charges.last_transition_event_id` + `agent_charges.last_aggregated_state` (NULL on insert, used by aggregator idempotency per invariant 27) + `agent_charges.kind agent_charge_kind NOT NULL DEFAULT 'outbound_charge'` (per invariant 41) + `agent_charges.parent_charge_id UUID NULL REFERENCES agent_charges(id)` (non-null when `kind = 'inbound_refund'`, CHECK enforces) + `organisations.shadow_charge_retention_days INT NOT NULL DEFAULT 90` | 2 | Down: drop tables in reverse FK order; drop new columns on `agent_charges` and `organisations`; drop the closed enum types. |
| `<NNNN+2>_cost_aggregates_rls_and_spend_dims.sql` | `cost_aggregates.organisation_id NOT NULL` (with backfill in same migration before applying NOT NULL) + canonical RLS policy + comment-only marker for new entityType values | 2 | Down: drop policy; drop `organisation_id` column; remove comment marker. |
| `<NNNN+3>_integration_connections_stripe_agent.sql` | Add `'stripe_agent'` to `providerType` enum | 3 | Down: remove the enum value (caveats around in-flight rows must be documented in the down file). |

**Migration numbers are assigned at merge time per `DEVELOPMENT_GUIDELINES.md` — do not pre-claim numbers in the PR.** The order above is the LOGICAL order; the actual prefix numbers depend on what else lands on `main` between now and merge.

### 3.5 Merge gates the executor must respect

1. **Gate 1 (after Chunk 1).** Every reference to `Budget` (bare) in new code is removed from the branch. `verify-pure-helper-convention.sh` passes against the new `computeBudgetServicePure.ts`. The grep pattern `\bBudget\b` returns only references qualified as "Compute Budget" or "Spending Budget" (the latter doesn't exist yet on the branch — confirm).
2. **Gate 2 (after Chunk 2).** All 8 new RLS table entries appear in `server/config/rlsProtectedTables.ts`. `verify-rls-coverage.sh` passes. `cost_aggregates` row count = pre-migration row count, all rows have `organisation_id IS NOT NULL`.
3. **Gate 3 (after Chunk 5).** `verify-pure-helper-convention.sh` passes against `chargeRouterServicePure.ts` (no impure imports). The trigger-based append-only enforcement is exercised by a unit test in `chargeRouterServicePure.test.ts` that confirms a forbidden mutation is rejected.
4. **Gate 4 (after Chunk 12).** `webhookDedupeStore` is keyed only by Stripe event id; no other key salt added. `paymentReconciliationJob` is unchanged (excluded from agent-charge reconciliation per spec §7.5).
5. **Gate 5 (after Chunk 14).** Empty-allowlist banner renders on the Spending Budget create surface; "Promote to live" button shows the 501 stub message until Chunk 15 merges.
6. **Gate 6 (after Chunk 15).** "Promote to live" round-trips through HITL fan-out and flips `spending_policies.mode` on first approval; policy `version` increments by exactly one.
7. **Gate 7 (programme end — i.e. before opening the merge PR).** Every spec §10 invariant is implementable, exercised, and pinned by either a unit test (pure logic) or a static gate (file-presence / grep-pattern). Adversarial-reviewer hunts for cross-tenant leakage on the SPT path and on the cost-aggregate read paths.

Note: these are **logical** gates — they describe what the chunk PR must demonstrate. They are not bash scripts the builder runs. The `[GATE]`-formatted enforcement is done by `npm run lint`, `npm run typecheck`, and the targeted unit tests authored within each chunk; full gate scripts run in CI only (see Executor Notes).

### 3.6 Pre-existing violations to handle without running gates

- **`server/services/budgetService.ts` is currently a single impure file** with cost-projection math inlined alongside DB reads. The current state passes `verify-pure-helper-convention.sh` only because no `*Pure.ts` companion exists to mismatch. Chunk 1 must extract pure helpers (cost projection, limit comparison, BudgetExceededError construction) into `computeBudgetServicePure.ts` as part of the rename — otherwise post-rename the gate's policy of "every service-tier file with non-trivial logic should have a pure companion" goes unsatisfied (the gate is grep-based and does not enforce this, but `pr-reviewer` will flag it). Acceptance criterion in Chunk 1: the `computeBudgetServicePure.ts` file has full Vitest coverage on the pure helpers.

---

## 4. Per-Chunk Detail — Chunks 1-4

Each chunk lists files, contracts, error handling, test considerations, dependencies, and acceptance criteria. **Verification commands are CI-only-aware**: every chunk lists only `npm run lint`, `npm run typecheck`, optional `npm run build:server` / `build:client`, and targeted execution of unit tests authored within the chunk. No `scripts/verify-*.sh` invocations, no `npm run test:*` umbrella commands, no programme-end gate sweep — see Executor Notes.

### Chunk 1 — Compute Budget Rename

**Goal.** Rename every "Budget" / "BudgetReservation" / "BudgetContext" / "BudgetExceededError" / "OrgBudgetLock" / "budget.*" event surface in code, prose, schema, and UI to the qualified "Compute Budget" form. No new functionality. Hard prereq for everything.

**Files to create or modify (exact paths):**

Creates:
- `server/db/schema/computeReservations.ts` — renamed Drizzle schema. Body identical to current `budgetReservations.ts` with table name and FKs updated.
- `server/services/computeBudgetService.ts` — renamed from `budgetService.ts`. All references updated.
- `server/services/computeBudgetServicePure.ts` — **NEW** file (does not currently exist; extracted from `budgetService.ts` as part of the rename, per §3.6).
- `server/services/__tests__/computeBudgetServicePure.test.ts` — Vitest coverage of the extracted pure helpers.
- `server/db/schema/orgComputeBudgets.ts` — renamed from `orgBudgets.ts`.

Migrates:
- `migrations/<NNNN>_compute_budget_rename.sql` + `<NNNN>_compute_budget_rename.down.sql`. `RENAME TABLE budget_reservations TO compute_reservations`, `RENAME TABLE org_budgets TO org_compute_budgets`, column renames per spec §2.

Modifies (consumers — full grep before migration):
- Every file importing `budgetReservations`, `orgBudgets`, `BudgetContext`, `BudgetExceededError`, `acquireOrgBudgetLock`, `checkAndReserveBudget`, `releaseBudget`, `commitBudget`, `BudgetReservation` — rename imports and identifiers.
- Event-name strings: `budget.reserved` → `compute_budget.reserved`; `budget.exceeded` → `compute_budget.exceeded`; `budget.committed`; `budget.released`. Every emit + every consumer.
- UI strings in admin/cost surfaces — every "Budget" label in an LLM-cost context becomes "Compute Budget" (e.g. `client/src/pages/SystemPnlPage.tsx`, `client/src/components/run-cost/RunCostPanel*`).

Deletes:
- `server/db/schema/budgetReservations.ts`
- `server/services/budgetService.ts`
- `server/db/schema/orgBudgets.ts`

**Contracts.** No new contract surfaces; this is a rename. The pure-extraction creates `computeBudgetServicePure.ts` exporting the previously-inlined helpers — at minimum: `projectCostCents(currentCents, deltaCents)`, `compareToLimit(projectedCents, limitCents): 'within' | 'exceeded'`, and a pure factory for `BudgetExceededError` (now `ComputeBudgetExceededError`).

**Error handling.**
- Existing `BudgetExceededError` renamed to `ComputeBudgetExceededError` (one canonical spelling). All catch-sites updated. Existing `instanceof` checks must update or use a `code === 'COMPUTE_BUDGET_EXCEEDED'` discriminator.
- `isBudgetExceededError` helper renamed to `isComputeBudgetExceededError`. Reference: architecture.md line 684 — the helper discriminates on `code === 'BUDGET_EXCEEDED'` for the plain-object 402 shape. The string code value updates too: `BUDGET_EXCEEDED` → `COMPUTE_BUDGET_EXCEEDED`.
- Migration down file must be hand-rolled (drizzle-kit no-op for renames sometimes).

**Test considerations.**
- `computeBudgetServicePure.test.ts` covers the extracted pure helpers (projection, comparison, error construction).
- A unit test that reads `runCostBreaker`'s ledger path proves the rename did not break the LLM-router cost-ceiling enforcement (the existing test infrastructure should still pass — author one targeted re-run if a test in `runCostBreakerPure.test.ts` exists).
- Reviewer checklist: grep for bare `Budget` in new + modified files post-rename. Every match must be qualified.

**Dependencies.** None.

**Acceptance criteria.**
- All `Budget*` symbols and identifiers renamed in code; old names absent from `server/`, `client/`, `shared/`, `worker/`.
- Migration applies cleanly forward and rolls back cleanly via the hand-rolled down file.
- `computeBudgetServicePure.ts` exports the extracted pure helpers; pure unit tests pass on a single `npx tsx` invocation.
- `runCostBreaker`'s code path is updated to read from the renamed schema — the four `runCostBreaker.ts` exports (`resolveRunCostCeiling`, `getRunCostCents`, `assertWithinRunBudget`, `getRunCostCentsFromLedger`, `assertWithinRunBudgetFromLedger`) still pass typecheck.
- Every UI surface that displays "Budget" in an LLM-cost context now displays "Compute Budget".
- This chunk's PR is fully reviewed and merged BEFORE any subsequent chunk PR opens.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx tsx server/services/__tests__/computeBudgetServicePure.test.ts`

---

### Chunk 2 — Schema + RLS for New Tables

**Goal.** Land all 7 new tables, their RLS policies, the `cost_aggregates` retrofit, the `agent_charges` append-only triggers, the `organisations.shadow_charge_retention_days` column, and the state-machine extension in `shared/stateMachineGuards.ts`. No service or route changes — this chunk is database structure only.

**Files to create or modify.**

Creates (`server/db/schema/`):
- `spendingBudgets.ts`
- `spendingPolicies.ts`
- `agentCharges.ts`
- `subaccountApprovalChannels.ts`
- `orgApprovalChannels.ts`
- `orgSubaccountChannelGrants.ts`
- `spendingBudgetApprovers.ts`

Migrates:
- `migrations/<NNNN+1>_agentic_commerce_schema.sql` + down file. Creates all 7 tables with canonical org-isolation RLS policies (template from `architecture.md §1499` and `migrations/0267_agent_recommendations.sql`), append-only `BEFORE UPDATE` and `BEFORE DELETE` triggers on `agent_charges` (with the mutable-column allowlist + state-machine validation per spec §5.1 and §4 transitions table including the `failed → succeeded` carve-out), the `agent_charges.amount_minor CHECK > 0` constraint, the `last_transition_by` and `last_transition_event_id` columns, the **`last_aggregated_state agent_charge_status NULL`** column (used by `agentSpendAggregateService` for invariant 27 idempotency — see Chunk 13), and the `organisations.shadow_charge_retention_days INT NOT NULL DEFAULT 90` column.

  **Closed enum at DB layer (invariant 30).** `agent_charges.status` declared as a Postgres ENUM type `agent_charge_status` listing every state from spec §4: `proposed`, `pending_approval`, `approved`, `executed`, `succeeded`, `failed`, `blocked`, `denied`, `disputed`, `shadow_settled`, `refunded`. Same enum reused by `last_aggregated_state`. The trigger's CASE expression and `shared/stateMachineGuards.ts` pull from this enum. `last_transition_by` is also a closed enum: `agent_charge_transition_caller` ∈ `'charge_router' | 'stripe_webhook' | 'timeout_job' | 'worker_completion' | 'approval_expiry_job' | 'retention_purge'`. `mode` likewise closed: `agent_charge_mode` ∈ `'shadow' | 'live'`. **`kind` is a NEW closed enum** `agent_charge_kind` ∈ `'outbound_charge' | 'inbound_refund'` (default `'outbound_charge'`) per invariant 41 — the column distinguishes operator-initiated refund rows from outbound charges; the aggregator (Chunk 13) branches on this column. **`parent_charge_id`** column added (`UUID NULL REFERENCES agent_charges(id)`); non-null when `kind = 'inbound_refund'`, null otherwise; CHECK constraint enforces this. String drift impossible at the column layer.
- `migrations/<NNNN+2>_cost_aggregates_rls_and_spend_dims.sql` + down file. Adds `organisation_id` to `cost_aggregates` (backfill in same migration; apply NOT NULL after backfill); applies canonical org-isolation RLS policy; comment-only marker for `agent_spend_subaccount`, `agent_spend_org`, `agent_spend_run` entityType values. Excludes `platform` and `provider` entityTypes from the policy via a partial policy or sentinel handling — implementer's choice, documented in the migration header.

Modifies:
- `server/config/rlsProtectedTables.ts` — add 8 new entries (the 7 new tables + `cost_aggregates` retrofit). Each entry's `policyMigration` field points at the migration that creates the policy, per architecture.md §1517.
- `server/db/schema/organisations.ts` — add `shadow_charge_retention_days` column.
- `shared/stateMachineGuards.ts` — extend with `assertValidAgentChargeTransition(from, to, options)`. The function mirrors the §4 transitions table; the `failed → succeeded` carve-out is gated on `options.callerIdentity === 'stripeAgentWebhookService'`. Also pin a closed enum for `last_transition_by` ∈ `'charge_router' | 'stripe_webhook' | 'timeout_job' | 'worker_completion' | 'approval_expiry_job' | 'retention_purge'` matching the DB-layer enum exactly (per invariant 30).
- `server/lib/spendLogging.ts` — **NEW** small utility exporting `logChargeTransition({ chargeId, from, to, reason, caller, lastEventId, level? })` per invariant 31. Single-call-site authority for transition logging used by every writer (`chargeRouterService`, `stripeAgentWebhookService`, the timeout/approval jobs, the worker-completion handler). The implementer chooses the logging primitive (likely `pino` or the existing structured logger); the function is a thin formatting wrapper that ensures every transition log carries the same shape.
- `shared/__tests__/stateMachineGuardsPure.test.ts` — add a test set that walks every transition in the §4 table plus every forbidden transition.

**Contracts.**

The DB-layer state-machine validation in the trigger MUST mirror `assertValidAgentChargeTransition` exactly. Both must allow the same set of transitions. A divergence is a correctness bug. The trigger's check is performed via a CASE expression listing every (from-status, to-status) pair from §4 plus the carve-out. Trigger pseudo-shape:

```sql
CREATE OR REPLACE FUNCTION agent_charges_validate_update() RETURNS trigger AS $$
DECLARE
  -- Allowed transitions from §4. The carve-out failed → succeeded is also allowed
  -- here, but the caller-identity check happens in the application layer (the
  -- trigger has no access to the caller's source-service identity beyond
  -- session GUCs, so the gate is at the app layer).
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Validate (OLD.status, NEW.status) is a permitted transition.
    -- Validate that ONLY columns from the mutable-on-transition allowlist were touched.
    -- Permit (failed → succeeded) only when current_setting('app.spend_caller', true) =
    -- 'stripeAgentWebhookService'.
  ELSE
    -- No status change. Only `provider_charge_id` and `updated_at` may be written, and only on
    -- a row currently in `executed`. Used by WorkerSpendCompletion handler.
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

The full SQL is the implementer's responsibility; the constraints above are non-negotiable. **Application code that needs the carve-out MUST set `app.spend_caller` via `SET LOCAL` inside `withOrgTx` before performing the UPDATE.** This adds a new GUC to the canonical session-variable list (`architecture.md §1560`); document it in the migration header and in `architecture.md` in the same commit.

Per `architecture.md §1570`, the canonical session variables are `app.organisation_id`, `app.current_subaccount_id`, `app.current_principal_*`, `app.current_team_ids`. The new `app.spend_caller` is a separate trigger-only GUC, not used by RLS, so it does not violate the canonicalisation gate. **Verify `verify-rls-session-var-canon.sh` does not match on `app.spend_caller`** — if it does, the migration must declare an explicit allowlist entry.

**Error handling.**
- Migration backfill failure (a `cost_aggregates` row whose entityType does not resolve to an `organisation_id`): the migration aborts with a structured error naming the offending row. The implementer must inspect and either delete the row or extend the backfill logic.
- Trigger violation on a forbidden transition: raises `RAISE EXCEPTION 'invalid agent_charges transition: % → %', OLD.status, NEW.status`. The application layer must catch and convert to `failure('invalid_state_transition', ...)`.
- Trigger violation on an out-of-allowlist column write: raises `RAISE EXCEPTION 'agent_charges immutable column changed: %', changed_columns`. The application layer must catch and rethrow as `failure('ledger_immutable_violation', ...)`.

**Test considerations.**
- `shared/__tests__/stateMachineGuardsPure.test.ts` — every §4 transition (allowed and forbidden) is exercised. Including the carve-out: `failed → succeeded` is allowed only with `callerIdentity === 'stripeAgentWebhookService'`, rejected otherwise.
- A unit test for `agentChargeAllowlistPure.ts` (a new pure helper that lists the mutable-on-transition columns; the trigger SQL pulls from this list at code-review time) — confirms every transition's allowed mutation set matches the §5.1 allowlist.
- No DB-level test in this chunk — DB triggers are integration territory; the executor relies on Chunk 5's impure tests to exercise the trigger end-to-end.

**Dependencies.** Chunk 1.

**Acceptance criteria.**
- All 7 new tables exist with canonical RLS policies; `verify-rls-coverage.sh` passes (CI runs this; locally the executor verifies the manifest entry exists in `rlsProtectedTables.ts`).
- `cost_aggregates.organisation_id` populated on every existing row; new policy in place.
- `agent_charges.status`, `last_aggregated_state`, `last_transition_by`, and `mode` are all Postgres ENUM types (invariant 30).
- `agent_charges.last_aggregated_state` column exists (NULL on insert) for invariant 27 aggregator idempotency.
- `agent_charges` triggers reject every forbidden transition (verified by the pure state-machine guard test plus a one-line sanity invocation against a local Postgres if the executor has one — not required).
- `shared/stateMachineGuards.ts` exports `assertValidAgentChargeTransition`; pure tests pass.
- `server/lib/spendLogging.ts` exports `logChargeTransition` per invariant 31.
- `app.spend_caller` GUC documented in the migration header and in `architecture.md §1560`.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx shared/__tests__/stateMachineGuardsPure.test.ts`

---

### Chunk 3 — SPT Vault and Connection Lifecycle

**Goal.** Add `'stripe_agent'` as a recognised provider type with token-rotation, encrypted storage, and per-sub-account/per-org revocation.

**Files to create or modify.**

Creates:
- `server/services/sptVaultService.ts` — thin facade over `connectionTokenService`. Exposes `getActiveSpt(subaccountId, orgId): Promise<SPT>`, `revokeSubaccountConnection(subaccountId, orgId)`, `refreshIfExpired(connectionId, options)`. No new persistence — reads `integration_connections` rows where `providerType = 'stripe_agent'`.

Migrates:
- `migrations/<NNNN+3>_integration_connections_stripe_agent.sql` + down file. Adds `'stripe_agent'` to the `providerType` enum.

Modifies:
- `server/db/schema/integrationConnections.ts` — extend the `providerType` enum.
- `server/services/connectionTokenService.ts` — add `case 'stripe_agent':` in `performTokenRefresh`. Calls Stripe's token rotation endpoint via platform-level keys (stored in `env.STRIPE_PLATFORM_*` — implementer to confirm exact env var name with the stripe adapter convention). Parameterise the existing 5-minute `refreshIfExpired` buffer to be per-provider — the implementation pattern: replace the constant with a `getRefreshBufferMs(providerType: string): number` lookup, default 300_000, override per-provider.
- `server/services/integrationConnectionService.ts` — add `revokeSubaccountConnection(subaccountId, orgId, providerType)` sibling to existing `revokeOrgConnection`. Sets `connectionStatus: 'revoked'` and nulls both tokens for matching rows. Audit-logs the revocation.
- `server/adapters/stripeAdapter.ts` — in the agent-spend code path, read SPT via `connectionTokenService.getAccessToken(conn)` (triggers auto-refresh). The existing checkout path keeps reading from `secretsRef`; do not regress.

**Contracts.**

`sptVaultService.getActiveSpt(subaccountId, orgId)` returns `{ token: string, expiresAt: Date | null, connectionId: string }`. Throws `failure('spt_unavailable', ...)` when no active connection exists for the (orgId, subaccountId, providerType='stripe_agent') tuple, or `failure('spt_revoked', ...)` when the connection is `revoked`.

The webhook-secret stored at `integration_connections.configJson.webhookSecret` is the per-connection HMAC secret used by Chunk 12. SPT issuance flow (Chunk 16) populates this field at OAuth completion.

**Error handling.**
- `revokeSubaccountConnection`: idempotent — calling on already-revoked connections returns 200 with `{ alreadyRevoked: true }`. Audit log on every call.
- Token refresh failure: throw `failure('spt_refresh_failed', detail, { connectionId, attempt })`. Caller (Chunk 5) translates this to `blocked` row with `failure_reason = 'spt_refresh_failed'`.

**Test considerations.**
- A pure helper `getRefreshBufferMs(providerType)` is unit-testable; `refreshBufferPure.test.ts` covers the lookup.
- No real Stripe API call in tests — `stripeAdapter` integration is exercised via Chunk 5's flow tests, not here.

**Dependencies.** Chunk 1, Chunk 2.

**Acceptance criteria.**
- `'stripe_agent'` is a valid `providerType` value at the DB layer and at the TypeScript type layer.
- `connectionTokenService.performTokenRefresh` handles the new case via platform-level keys.
- `revokeSubaccountConnection` is exposed and audit-logged.
- `stripeAdapter` reads `accessToken` for `stripe_agent` connections without regressing the checkout path.
- `sptVaultService.ts` is a single file with the three exported functions named above.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/refreshBufferPure.test.ts`

---

### Chunk 4 — Charge Router Pure

**Goal.** Heavy unit-test chunk. Exports the pure decision functions used by Chunk 5's impure router. No DB, no Stripe, no I/O.

**Files to create or modify.**

Creates:
- `server/services/chargeRouterServicePure.ts` — exports `evaluatePolicy`, `buildChargeIdempotencyKey`, `normaliseMerchantDescriptor`, `previewSpendForPlan`, `validateAmountForCurrency`, `classifyStripeError`, `deriveWindowKey`.
- `server/services/__tests__/chargeRouterServicePure.test.ts` — comprehensive Vitest suite.
- `server/config/spendConstants.ts` — `EXECUTION_TIMEOUT_MINUTES = 30`, `CHARGE_KEY_VERSION = 'v1'`, `MERCHANT_ALLOWLIST_MAX_ENTRIES = 250`, ISO 4217 minor-unit-exponent table (`USD: 2`, `JPY: 0`, `BHD: 3`, etc.), Stripe HTTP-status retry-classification table per invariant 26. Load-time `/^v\d+$/` assert on `CHARGE_KEY_VERSION` (mirror of `IDEMPOTENCY_KEY_VERSION` in `server/lib/idempotencyVersion.ts`).

**Contracts.**

```typescript
// Inputs to evaluatePolicy
interface EvaluatePolicyInput {
  policy: SpendingPolicy;            // §8.5 shape
  budget: { currency: string; disabledAt: Date | null; };
  request: ChargeRouterRequest;       // §8.1
  killSwitchActive: boolean;
  sptStatus: 'active' | 'expired' | 'revoked' | 'unavailable';
  reservedCapacity: { dailyMinor: number; monthlyMinor: number; };
  settledNet: { dailyMinor: number; monthlyMinor: number; };
}

interface EvaluatePolicyResult {
  outcome: 'approved' | 'pending_approval' | 'blocked';
  failureReason: string | null;       // present on blocked
  reservedMinor: number;
  decisionPath: {                     // serialised onto agent_charges.decision_path
    killSwitch: 'pass' | 'fail';
    spt: 'pass' | 'fail';
    allowlist: 'pass' | 'fail';
    currency: 'pass' | 'fail';
    perTxnLimit: 'pass' | 'fail' | 'unset';
    dailyLimit: 'pass' | 'fail' | 'unset';
    monthlyLimit: 'pass' | 'fail' | 'unset';
    threshold: 'auto' | 'review';
  };
}

buildChargeIdempotencyKey(input: { skillRunId; toolCallId; intent; args; mode: 'shadow' | 'live'; }): string
// Returns `${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${prefixedIntent}:${sha256(canonicaliseJson(args))}`
// where prefixedIntent = `charge:${mode}:${intent}` (so shadow→live promotion produces fresh keys per §9.1).
// CALLER CONTRACT (invariant 21): args.merchant MUST already have been passed through
// normaliseMerchantDescriptor BEFORE being placed on the args object. The function does NOT
// re-normalise — it canonicalises and hashes whatever it receives. Both worker and main app
// MUST normalise at the same point: when constructing the args payload prior to key derivation.

normaliseMerchantDescriptor(input: string): string
// Per §16.12 algorithm: NFKC, trim, collapse whitespace, en-US uppercase, strip
// punctuation but preserve `&`. Single source of truth — used by skill handlers (Chunk 6),
// worker spend_request emit path (Chunk 11), and main-app idempotency-recompute path (Chunk 11).

previewSpendForPlan(plan: ParsedPlan, policy: SpendingPolicy):
  Array<{ stepIndex: number; verdict: 'would_auto' | 'would_review' | 'would_block' | 'over_budget'; }>

validateAmountForCurrency(amountMinor: number, currency: string):
  { valid: true } | { valid: false; reason: 'fractional_minor_unit' | 'unknown_currency' }
// ISO 4217 exponent rule per invariant 24. Used by chargeRouterService.proposeCharge
// (boundary input validation), chargeRouterService.executeApproved (outbound Stripe request
// validation per invariant 24 outbound twin), AND stripeAgentWebhookService (incoming
// webhook amount validation). Single source of truth.

classifyStripeError(err: unknown): 'auth_refresh_retry' | 'fail_402' | 'idempotency_conflict' | 'rate_limited_retry' | 'server_retry' | 'fail_other_4xx'
// Maps Stripe HTTP status (and stripe-node error shapes) to the canonical retry class
// per invariant 26. Single authority — chargeRouterService.executeApproved branches on
// the result; no other call site invents its own classification. Provider-abstraction
// boundary exception per invariant 40 (the function name carries 'Stripe' deliberately;
// future providers either generalise to classifyProviderError(provider, err) or duplicate
// per provider — this is implementer's choice at multi-provider expansion time).

deriveWindowKey(timestamp: Date, dimension: 'daily' | 'monthly', timezone: 'UTC'): string
// Returns a canonical window key like '2026-05-04' (daily UTC) or '2026-05' (monthly UTC).
// Uses HALF-OPEN `[start, end)` semantics per invariant 42 — a charge at exactly
// 2026-05-04T00:00:00.000Z falls into the '2026-05-04' day window, not '2026-05-03'.
// Single source of truth for window boundaries; called by agentSpendAggregateService
// (Chunk 13) and by chargeRouterServicePure.evaluatePolicy when comparing settled +
// reserved capacity against per-window limits.
```

**Gate ordering in `evaluatePolicy`** is fixed per spec §4 transitions: (1) Kill Switch / SPT validity, (2) Merchant Allowlist, (3) Spending Limits including reserved capacity, (4) Approval Threshold. The first failing gate determines the outgoing transition.

**Limits set to 0 are treated as unset** (no cap, never trip the gate). Per spec §5.1 column comments and §8.5.

**Currency check** runs alongside the allowlist gate — `chargeRequest.currency != budget.currency` → `blocked` with `failure_reason = 'currency_mismatch'` (§10 invariant 18). This is gate position 1.5 (between SPT validity and allowlist) — implementer decides whether to fold into gate 1 or treat as a separate step in `decisionPath`. Reviewer accepts either.

**Error handling.** Pure functions; no exceptions thrown for "expected" outcomes. Programming errors (e.g. `amountMinor <= 0`, `currency` not in the exponent table) throw a generic `Error` — the impure caller in Chunk 5 maps these to `failure(...)` shape.

**Test considerations.**
- Property-pinning tests:
  - Currency exponent table covers USD (2), EUR (2), GBP (2), JPY (0), KRW (0), VND (0), BHD (3), KWD (3) — at minimum.
  - Idempotency key shape matches the spec exactly; `canonicaliseJson` reused from `actionService` (not a new walker — verify import).
  - Merchant descriptor normalisation covers each of the 5 algorithm steps; the `&` preservation case is pinned.
  - `evaluatePolicy` covers every (gate, outcome) cell — kill-switch fired, SPT expired, allowlist miss, currency mismatch, per-txn cap exceeded, daily cap exceeded, monthly cap exceeded, threshold trips, all gates pass.
  - Reserved-capacity-counts-against-limits property: a charge that fits against settled-only fails when `reservedCapacity` is added. Pin the §16.2 rule.
  - Limits-set-to-0-are-unset property.
  - `previewSpendForPlan` covers a 4-step plan with mixed verdicts.
- `classifyStripeError` test set: each row of the invariant-26 retry-classification table — 401, 402, 409, 429, 500, 502, 503, 400, 404. Pin the function output for each.
- `buildChargeIdempotencyKey` merchant-normalisation contract: same logical merchant with descriptor casing differences (`"Stripe Inc."` vs `"STRIPE INC"`) MUST produce the same key when passed through `normaliseMerchantDescriptor` first; produces DIFFERENT keys when callers forget to normalise (negative case pinned to surface the contract violation in test output).
- `deriveWindowKey` boundary cases (invariant 42): `2026-05-04T00:00:00.000Z` daily → `'2026-05-04'`; `2026-05-03T23:59:59.999Z` daily → `'2026-05-03'`; `2026-06-01T00:00:00.000Z` monthly → `'2026-06'`; `2026-05-31T23:59:59.999Z` monthly → `'2026-05'`. Half-open `[start, end)` is the contract.
- Test count target: ≥55 cases across the file (was 50; new boundary tests bring it up).

**Dependencies.** Chunk 1, Chunk 2.

**Acceptance criteria.**
- `chargeRouterServicePure.ts` exports the seven functions named above (`evaluatePolicy`, `buildChargeIdempotencyKey`, `normaliseMerchantDescriptor`, `previewSpendForPlan`, `validateAmountForCurrency`, `classifyStripeError`, `deriveWindowKey`).
- `verify-pure-helper-convention.sh` (CI) passes against the file. Locally: file imports nothing from `server/db/`, `server/services/` (other than other `*Pure.ts` modules), or `pg-boss`.
- `spendConstants.ts` is the single source of truth for `EXECUTION_TIMEOUT_MINUTES`, `CHARGE_KEY_VERSION`, `MERCHANT_ALLOWLIST_MAX_ENTRIES`, the ISO 4217 minor-exponent table, and the Stripe retry-classification table.
- Unit tests pass on a single `npx tsx` invocation; ≥50 test cases.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/chargeRouterServicePure.test.ts`

---

## 5. Per-Chunk Detail — Chunks 5-8

### Chunk 5 — Charge Router Impure

**Goal.** Implement the propose → gate → execute four-step flow. Single entry point for all money movement (`chargeRouterService.proposeCharge`). Owns DB writes, Stripe calls, advisory locks, HITL enqueue, idempotency, the execute-time kill-switch re-check, the execution-window timeout job, and the `agent_execution_events` cross-reference emit.

**Files to create or modify.**

Creates:
- `server/services/chargeRouterService.ts` — the impure router. Imports from `chargeRouterServicePure.ts`, `spendingBudgetService.ts` (Chunk 13), `sptVaultService.ts` (Chunk 3), `actionService.ts`, `stripeAdapter.ts`. Exports `proposeCharge(input)`, `executeApproved(chargeId)`, `resolveApproval(actionId, decision)`, `previewSpendAdvisory(plan, policy)`.
- `server/jobs/executionWindowTimeoutJob.ts` + `executionWindowTimeoutJobPure.ts` — scans `WHERE status = 'approved' AND expires_at < NOW()` every minute; transitions matching rows to `failed` with `reason = 'execution_timeout'`. Pure cutoff math + decision logic. Job header documents concurrency model (per-org advisory lock — see `architecture.md §3312` job-concurrency standard).
- `server/jobs/approvalExpiryJob.ts` + `approvalExpiryJobPure.ts` — scans `WHERE status = 'pending_approval' AND approval_expires_at < NOW()`; transitions to `denied` with `reason = 'approval_expired'`. Job header documents concurrency model.

Modifies:
- `server/services/queueService.ts` — register `executionWindowTimeoutJob` and `approvalExpiryJob` as scheduled cron jobs (per-minute cadence).
- `server/services/agentExecutionEventService.ts` — accept `'spend_ledger'` as a valid `linkedEntityType` in `tryEmitAgentEvent`. Validator branch added.

**Contracts.**

`proposeCharge(input: ChargeRouterRequest): Promise<ChargeRouterResponse>` per §8.1 / §8.2 in spec. Returns one of the five discriminated-union members. **Caller contract:** shadow auto-approved returns `{ outcome: 'shadow_settled' }`; live auto-approved returns `{ outcome: 'executed', ... }` with `executionPath` discriminator. Skills must treat both as success. Per spec §8.2 caller contract.

`executeApproved(chargeId: string)`: re-reads kill switch + SPT status (per §15 double-check rule), then either calls Stripe (main_app_stripe path) and writes `executed` with `provider_charge_id` populated, or writes `executed` with `provider_charge_id = NULL` and returns `chargeToken` (worker_hosted_form path). Late-firing kill switch → `approved → blocked` with `failure_reason = 'kill_switch_late'`.

`resolveApproval(actionId, decision)` is the SOLE writer for `pending_approval → approved/denied` transitions per spec §13.2 step 4. Performs the optimistic compare-and-set, then on `approved` runs policy revalidation (re-reads current `spending_policies` + version check; `policy_changed` auto-deny if blocked). Zero rows updated → another response already won; the channel records the response as `superseded` on `actions` only.

**Sequence — happy path, `pay_invoice` (main_app_stripe + live + auto-approved):**

```
1. INSERT agent_charges (status='proposed', mode='live', execution_path='main_app_stripe',
                         idempotency_key, decision_path={}, ...)
   ON CONFLICT DO UPDATE SET updated_at = NOW() RETURNING *
   - On is_new=false: return existing row with its outcome
2. BEGIN transaction; pg_advisory_xact_lock(spending_budget_id)  — mirror of `acquireOrgComputeBudgetLock`
3. Read settled-net + reserved-capacity from agent_charges INSIDE the lock-held transaction
   (invariant 25), invoke chargeRouterServicePure.evaluatePolicy
4. UPDATE agent_charges SET status = 'approved', approved_at = NOW(),
                              expires_at = NOW() + EXECUTION_TIMEOUT_MINUTES,
                              decision_path = $decision_path,
                              last_transition_by = 'charge_router'
                          WHERE id = $id AND status = 'proposed'
   - SET LOCAL app.spend_caller = 'charge_router'
   - COMMIT (releases advisory lock)
   - logChargeTransition({ chargeId, from: 'proposed', to: 'approved', reason: 'auto_approved',
                           caller: 'charge_router', lastEventId: null }) per invariant 31
5. executeApproved(chargeId):  -- runs OUTSIDE any DB transaction; advisory lock NOT held (invariant 35)
   - Re-read kill switch (spending_budgets.disabled_at) and SPT status
   - Re-read agent_charges.expires_at; if NOW() >= expires_at:
       UPDATE … status='failed', failure_reason='execution_window_elapsed'
              WHERE id=$id AND status='approved'
       → return { outcome: 'failed' }   (per invariant 36)
   - If late-fire: UPDATE … status='blocked', failure_reason='kill_switch_late' AND status='approved'
                                       → return { outcome: 'blocked' }
   - validateAmountForCurrency(amount_minor, currency) per invariant 24 (outbound twin):
     - On invalid: UPDATE … status='blocked', failure_reason='currency_amount_invalid'
                              WHERE id=$id AND status='approved'
                   → return { outcome: 'blocked' }
   - stripeAdapter.charge(SPT, idempotencyKey, amount, currency, merchant,
                          metadata: { agent_charge_id: $id, mode: 'live', traceId })  -- invariant 34
                          — wrapped in withBackoff branched on classifyStripeError per invariant 26
   - On Stripe success: UPDATE … status='executed', provider_charge_id=$id, executed_at=NOW()
                                  WHERE id=$id AND status='approved'
   - On Stripe failure (classified non-retryable): UPDATE … status='failed', failure_reason=$reason,
                                                   settled_at=NOW() WHERE id=$id AND status='approved'
   - On Stripe 409 idempotency-conflict: re-read by idempotency key; apply Stripe's reported
                                          outcome; no new charge attempted
6. Emit agent_execution_events row with linkedEntityType='spend_ledger',
   linkedEntityId=<agent_charges.id>
7. Return { outcome: 'executed', chargeId, providerChargeId, executionPath: 'main_app_stripe' }
```

**Lock-scope invariants (25 + 35).** The advisory lock MUST wrap the read-then-write sequence atomically: `BEGIN` → `pg_advisory_xact_lock(spending_budget_id)` → SELECT settled-and-reserved aggregates → `evaluatePolicy` → UPDATE → `COMMIT`. **The Stripe call MUST live AFTER COMMIT, outside any transaction (invariant 35).** Step 5 (`executeApproved`) above runs outside the lock-held transaction by construction — the COMMIT in step 4 releases the lock before Stripe is contacted. Reviewer checklist:
- Every `withOrgTx` block in `chargeRouterService` is bounded to DB-only operations.
- No `await stripeAdapter.*`, `await pgBoss.send`, `await fetch(...)`, or any other I/O sits between BEGIN and COMMIT.
- Concurrent agents on the same budget contend on the lock for the duration of capacity-read + UPDATE only — milliseconds — not for the duration of a Stripe round trip.

Violation of this pattern causes throughput collapse under high-frequency same-budget contention; it is invisible in low-traffic test environments and catastrophic in production.

**Sequence — pending_approval branch:**

After step 3, if `evaluatePolicy.outcome === 'pending_approval'`: UPDATE the row to `pending_approval` (with `approval_expires_at = NOW() + approval_expires_hours hours`), call `actionService.proposeAction({ ..., metadata: { category: 'spend', actionType: <skill slug>, chargeId, ledgerRowId, ... } })`, return `{ outcome: 'pending_approval', chargeId, actionId }`. The workflow engine catches this and pauses (Chunk 10).

**Sequence — shadow mode, auto-approved:**

After step 3, if `mode === 'shadow'`: UPDATE the row to `shadow_settled` directly (the `approved → shadow_settled` step in §4 fires). For `worker_hosted_form` skills, return `{ outcome: 'shadow_settled', chargeId }` per spec §8.2 — the worker receives `chargeToken: null` and `providerChargeId: null` on `agent-spend-response` and skips form-fill (per spec §14).

**Sequence — `worker_hosted_form` + live + auto-approved:**

After step 4 (approved with `expires_at` set): re-check kill switch + SPT status. If pass: UPDATE the row to `executed` with `provider_charge_id = NULL`, return `{ outcome: 'executed', chargeId, providerChargeId: null, executionPath: 'worker_hosted_form', chargeToken: <SPT> }`. The worker fills the merchant form, observes the result, emits `agent-spend-completion`. The main-app handler (Chunk 11) updates `provider_charge_id` (or transitions to `failed`); the Stripe webhook (Chunk 12) drives `executed → succeeded`.

**Error handling.**

Stripe error classification — the canonical table per invariant 26 (single authority is `chargeRouterServicePure.classifyStripeError`):

| HTTP class | Behaviour | failure_reason on terminal | Retry | SPT refresh |
|---|---|---|---|---|
| 401 (auth) | Refresh SPT once, retry once. Second 401 → terminal. | `spt_auth_failed` | 1 retry | Yes, exactly once |
| 402 (decline / business failure) | Terminal `failed` immediately. No retry. | `card_declined` (or specific Stripe code) | None | No |
| 409 (idempotency conflict) | Re-read Stripe by idempotency key; apply Stripe's reported outcome to the row. No new attempt. | n/a (Stripe authoritative) | n/a | No |
| 429 (rate limited) | `withBackoff` retry, max 3. After max → terminal. | `stripe_rate_limited` | 3 with backoff | No |
| 5xx (server error) | `withBackoff` retry, max 3. After max → terminal. | `stripe_unavailable` | 3 with backoff | No |
| other 4xx | Terminal `failed` immediately. No retry. | `<stripe_error_code>` | None | No |

Other failure surfaces:
- `failure('spt_unavailable', ...)` from `sptVaultService` → write `blocked` row with `failure_reason = 'spt_unavailable'` and return `{ outcome: 'blocked', reason }`.
- `validateAmountForCurrency` returning invalid in `executeApproved` → write `blocked` row with `failure_reason = 'currency_amount_invalid'` (invariant 24 outbound twin).
- DB trigger violation (forbidden transition or out-of-allowlist column write) → catch and rethrow as `failure('invalid_state_transition', ...)` or `failure('ledger_immutable_violation', ...)`. These are correctness bugs — surface them loudly. ERROR-level structured log per invariant 31.
- `INSERT ... ON CONFLICT DO UPDATE` returning a row whose `idempotency_key` matches a recomputed hash mismatch (per §9.1 worker handling) → `failure('idempotency_args_drift', ...)` and reject the request. The check applies on the worker round-trip path only (Chunk 11); proposeCharge in-process direct calls do not hit this.

**Test considerations.**
- Pure helpers in this chunk are minimal — most pure logic lives in Chunk 4. Targeted unit tests authored here:
  - `executionWindowTimeoutJobPure.test.ts` — cutoff math, decision logic.
  - `approvalExpiryJobPure.test.ts` — same.
  - One pure helper for `decision_path` JSON shape (so reviewer can verify the JSON serialisation matches `evaluatePolicy.decisionPath`).
- The full propose → gate → execute flow is integration territory; this chunk does not author DB-touching integration tests (per testing posture). The flow is exercised end-to-end in CI through Chunk 12's webhook tests once they land.

**Dependencies.** Chunks 1, 2, 3, 4.

**Acceptance criteria.**
- `proposeCharge` covers all four success paths (shadow auto, shadow review, live auto main_app_stripe, live auto worker_hosted_form, live review) AND all blocked paths (kill switch propose-time, kill switch execute-time / `kill_switch_late`, SPT failure, allowlist miss, currency mismatch, currency-amount-invalid at request creation, limit exceeded, execution-window-elapsed).
- `executeApproved` performs the execute-time kill-switch re-check, the **`expires_at` re-check (invariant 36)**, AND calls `validateAmountForCurrency` before constructing the Stripe request (invariant 24 outbound twin); all three re-checks happen outside any advisory-lock-held transaction (invariant 35).
- Outbound Stripe calls populate `metadata: { agent_charge_id, mode: 'live', traceId }` per invariant 34.
- `resolveApproval` is the only writer for `pending_approval → approved/denied`.
- Optimistic compare-and-set on every status UPDATE.
- `agent_execution_events` cross-reference emitted on every charge attempt (one event, `linkedEntityType: 'spend_ledger'`).
- `pg_advisory_xact_lock(spending_budget_id)` taken for the propose+gate sequence; **all reads of settled + reserved capacity occur INSIDE the same lock-held transaction as the subsequent UPDATE** (invariant 25); the lock is not held across HITL wait; **and no external I/O (Stripe API, queue dispatch, HTTP) occurs while the lock is held — Stripe call runs in `executeApproved` AFTER COMMIT (invariant 35)**.
- `traceId` propagated across `proposeCharge → agent-spend-request → worker → agent-spend-completion → webhook → reconciliation poll` per invariant 38; sourced from `agent_runs.id` on agent-driven charges, new uuid for direct-call retries.
- Every status transition in `chargeRouterService` calls `logChargeTransition` exactly once with the structured fields per invariant 31.
- Stripe error handling routes through `classifyStripeError` exclusively; no inline status-code branching.
- `executionWindowTimeoutJob` and `approvalExpiryJob` registered in `queueService.ts` and run on per-minute cadence.
- `verify-pure-helper-convention.sh` (CI) passes — `chargeRouterService.ts` does NOT export pure decisions; those live in `*Pure.ts`.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx server/services/__tests__/chargeRouterServicePure.test.ts`  (re-run from Chunk 4 to confirm pure imports still work)
- `npx tsx server/jobs/__tests__/executionWindowTimeoutJobPure.test.ts`
- `npx tsx server/jobs/__tests__/approvalExpiryJobPure.test.ts`

---

### Chunk 6 — Action Registry and Skill Handlers (5 skills)

**Goal.** Register the five new spend-enabled skills and wire their handlers so they invoke `chargeRouterService.proposeCharge`. No business logic in the handlers — they are thin shells.

**Files to create or modify.**

Creates:
- `server/skills/pay_invoice.md` — standard skill-file frontmatter; description, expected args (invoiceId, amount, currency, merchant), expected output. Pattern: precedent at `server/skills/add_deliverable.md`, `book_meeting.md`.
- `server/skills/purchase_resource.md`
- `server/skills/subscribe_to_service.md`
- `server/skills/top_up_balance.md`
- `server/skills/issue_refund.md`

Modifies:
- `server/config/actionRegistry.ts`:
  - Add `spendsMoney: boolean` field to the `ActionDefinition` type.
  - Add `executionPath: 'main_app_stripe' | 'worker_hosted_form' | undefined` to the type (undefined for non-spend skills).
  - Add `requiredIntegration: 'stripe_agent'` (or extend the existing `REQUIRED_INTEGRATION_SLUGS` enum if it doesn't already include it).
  - Five new entries with: `actionCategory: 'api'`, `directExternalSideEffect: true`, `idempotencyStrategy: 'locked'`, `requiredIntegration: 'stripe_agent'`, `defaultGateLevel: 'review'`, `spendsMoney: true`, `executionPath` set per spec §7.1 table (`pay_invoice` and `issue_refund` → `main_app_stripe`; the other three → `worker_hosted_form`).
  - Add `SPEND_ACTION_ALLOWED_SLUGS = ['pay_invoice', 'purchase_resource', 'subscribe_to_service', 'top_up_balance', 'issue_refund'] as const`.
  - Concatenate `SPEND_ACTION_ALLOWED_SLUGS` into the existing `ACTION_CALL_ALLOWED_SLUGS` (the workflow allowlist constant).
- `server/services/skillExecutor.ts` — Add `SKILL_HANDLERS` entries for each of the five new skills. Each handler:
  - Validates the skill input against the registered Zod schema.
  - Resolves `subaccountId`, `spending_budget_id`, etc. from the agent run context.
  - **Normalises `args.merchant` via `normaliseMerchantDescriptor` BEFORE calling proposeCharge** (per invariant 21 — main-app and worker must apply normalisation at the same point so idempotency keys agree).
  - Calls `chargeRouterService.proposeCharge(input)`.
  - Maps the response to a skill output: `{ outcome: 'shadow_settled' | 'executed' | 'pending_approval' | 'blocked', chargeId, providerChargeId? }`.
  - For `worker_hosted_form` skills running in the worker context: emits `spend_request` action via `agent-spend-request` queue (see Chunk 11) and awaits the `agent-spend-response`.
  - For `worker_hosted_form` skills running in the main-app context (rare; planning-time advisory): the handler does not actually invoke the form-fill; it returns the response from `chargeRouterService.proposeCharge` with `executionPath: 'worker_hosted_form'` and lets the caller decide.
  - **`issue_refund` is special (invariant 41 — operator refunds are append-only):** the handler does NOT mutate the parent `agent_charges` row. It calls `chargeRouterService.proposeCharge` with `kind: 'inbound_refund'`, `parentChargeId: <original>`, `direction: 'subtract'`. A NEW `agent_charges` row is created (with its own idempotency key, decision_path, etc.); the original `succeeded` row stays `succeeded`. The aggregator (Chunk 13) handles the subtraction via the inbound-refund path. Reviewer checklist: confirm the handler contains zero `UPDATE agent_charges SET status = 'refunded'` calls.
- `shared/iee/actionSchema.ts` — add `spend_request` and `spend_completion` actions to the IEE worker's loop vocabulary. Per spec §5.2.

**Contracts.**

Each skill's input shape is per spec §7.1 + §8.1 (`ChargeRouterRequest` is the contract; the skill input is a thin projection over it). Output union per §8.2 (`ChargeRouterResponse`).

**Error handling.**
- Invalid input → `failure('invalid_skill_args', ...)` rejected before charge router invocation.
- `chargeRouterService` throws `failure('spt_unavailable', ...)` etc. → bubble to skill output as `{ outcome: 'blocked', reason }`.

**Test considerations.**
- One pure unit test per skill (handler input → expected `proposeCharge` payload mapping). 5 test files, each ~5-10 cases.
- Verify dual-registration: `verify-action-registry-zod.sh` (CI) catches a skill with no Zod schema; the `pr-reviewer` checks invariant 14 by hand (every `spendsMoney: true` entry in `ACTION_REGISTRY` has a matching `SKILL_HANDLERS` entry).

**Dependencies.** Chunks 1, 5.

**Acceptance criteria.**
- Five skill markdown files exist under `server/skills/`.
- `actionRegistry.ts` has 5 new `ActionDefinition` entries with `spendsMoney: true` AND each has a matching `SKILL_HANDLERS` entry in `skillExecutor.ts` (invariant 14).
- `SPEND_ACTION_ALLOWED_SLUGS` is exported and concatenated into `ACTION_CALL_ALLOWED_SLUGS`.
- `shared/iee/actionSchema.ts` includes `spend_request` and `spend_completion` action types.
- `verify-idempotency-strategy-declared.sh` (CI) passes — every spend skill declares `idempotencyStrategy: 'locked'`.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx server/services/__tests__/spendSkillHandlers.test.ts`  (one test file covering the five handler input mappings)

---

### Chunk 7 — Policy Engine Extension

**Goal.** Extend the existing policy engine with a `spendDecision` field; add the advisory `previewSpendForPlan` hook to the agent execution planning prelude.

**Files to create or modify.**

Modifies:
- `server/services/policyEngineService.ts` — add `spendDecision` field to the `PolicyDecision` shape. Evaluated when `ActionDefinition.spendsMoney === true`. Read at the same point existing decisions are computed.
- `server/services/policyEngineServicePure.ts` — add `evaluateSpendPolicy(policyRules, request)` pure helper that returns `spendDecision`. Mirrors `chargeRouterServicePure.evaluatePolicy` shape but at the gate-decision granularity (this is the policy-engine layer, not the charge-router layer).
- `server/services/actionService.ts` — `resolveGateLevel()` consumes `spendDecision` from `PolicyDecision` in the existing `GATE_PRIORITY` merge (`higherGate()`). Highest restriction wins.
- `server/services/middleware/proposeAction.ts` — add `'spend_block'` as a distinct audit reason code on the security event written to `tool_call_security_events` when spend policy blocks an action. Distinguishes from generic `'policy_block'`.
- `server/services/agentExecutionService.ts` — in the planning prelude (`isComplexRun()` path), after `parsePlan()`, call `chargeRouterServicePure.previewSpendForPlan(plan, policyRules)`. Inject the advisory result into the `<system-reminder>` block at lines `~2411-2414`. **Fail-open: if preview throws, log and continue. No blocking.** Pass `tools: undefined` (no tool calls) in planning mode.

**Contracts.**

`PolicyDecision.spendDecision`:
```typescript
{
  evaluated: boolean;        // false when spendsMoney = false
  outcome: 'auto' | 'review' | 'block';
  reason: string | null;     // 'policy_block' | 'spend_block:allowlist' | etc.
}
```

Existing `gateLevel` enum unchanged. The `GATE_PRIORITY` merge: `block > review > auto`. `spendDecision` participates in the same priority comparison.

**Error handling.**
- `evaluateSpendPolicy` throws on malformed policy → caller (`resolveGateLevel`) catches and treats as `outcome: 'block'` with `reason: 'spend_decision_error'`.
- Planning-prelude advisory failure → log warning, return empty preview array, do not block the run.

**Test considerations.**
- `policyEngineServicePure.test.ts` extension — `evaluateSpendPolicy` covers each gate; merging with non-spend gate decisions; outcome priority.
- Reviewer checklist: `agentExecutionService.ts` planning prelude is fail-open. No `throw` reachable from the spend-preview branch.

**Dependencies.** Chunks 1, 4. Soft prereq: Chunk 6 (so `spendsMoney: true` skills exist; otherwise `evaluateSpendPolicy` is dead code).

**Acceptance criteria.**
- `PolicyDecision` carries `spendDecision`; `resolveGateLevel` consumes it.
- `proposeAction.ts` middleware writes `'spend_block'` audit reason on spend-policy holds.
- Planning prelude in `agentExecutionService.ts` calls `previewSpendForPlan` fail-open, injects results into `<system-reminder>` block.
- Pure unit tests pass.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/policyEngineServicePure.test.ts`

---

### Chunk 8 — HITL Surface

**Goal.** Surface spend approvals in the existing review queue with spend-specific renderer, fourth lane, and `spend_approver` permission gate.

**Files to create or modify.**

Modifies:
- `server/services/actionService.ts` (or `reviewService.ts`, depending on where the action-creation path lives — implementer to confirm) — write `metadata_json.category: 'spend'` at action creation time when the calling skill has `spendsMoney: true`. No schema change.
- `server/lib/permissions.ts` — add `spend_approver` to the permission key enum. Default-grant logic is in Chunk 13 (alongside budget creation); the permission key itself ships here.
- `client/src/pages/ReviewQueuePage.tsx` — add `renderSpendPayload(item)` branch in the payload renderer keyed on `item.reviewPayloadJson.actionType` matching a spend slug (the five from Chunk 6). Renders: merchant (id + descriptor), amount formatted from `amount_minor` + `currency` (use `formatMoney.ts` with currency-aware rendering), Charge Intent, SPT last4 (read from `integration_connections` via a new auxiliary endpoint or pre-attached metadata), Approve/Deny buttons.
- `client/src/components/dashboard/PendingApprovalCard.tsx` — add `'spend'` as a fourth lane alongside `'client' | 'major' | 'internal'`. Lane label: "Spend". Lane filter checkbox in the page header.
- `client/src/components/dashboard/ACTION_BADGE` (or wherever badges are registered) — add badge entries for the five spend slugs (`pay_invoice`, `purchase_resource`, etc.) with appropriate icons.

**Contracts.**

`metadata_json.category: 'spend'` is the route key for the renderer. `metadata_json.actionType` is the skill slug for badge resolution. `metadata_json.chargeId` and `metadata_json.ledgerRowId` are the FK back to `agent_charges` for the audit drilldown.

**Error handling.**
- `renderSpendPayload`: when `metadata_json` is malformed (missing `merchant`, `amount_minor`, etc.), render a graceful fallback ("Spend approval — details unavailable") rather than crashing the queue page.
- `spend_approver` permission check: if the user lacks the permission, the card renders read-only (no Approve/Deny buttons) — same pattern as health-audit's view-only mode.

**Test considerations.**
- One pure helper extracted: `formatSpendCardPure({ amountMinor, currency, merchantId, merchantDescriptor })` returns the display strings. Unit-tested for each currency exponent (USD: 100 → "$1.00"; JPY: 100 → "¥100"; BHD: 1000 → "1.000 BD" or similar).
- Reviewer checklist: the spend lane filter integrates with existing lane state without regressing the other three lanes.

**Dependencies.** Chunks 1, 2, 6.

**Acceptance criteria.**
- Spend approvals appear in `ReviewQueuePage` with the spend-specific renderer.
- `PendingApprovalCard` displays a `Spend` lane.
- Users without `spend_approver` see read-only spend cards.
- Audit-event reasoning supports `spend_block` (this lands in Chunk 7 and is verified here end-to-end).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx client/src/components/dashboard/__tests__/formatSpendCardPure.test.ts`

---

## 6. Per-Chunk Detail — Chunks 9-12

### Chunk 9 — Approval Channel Interface and In-App Implementation

**Goal.** Ship the channel adapter framework with first-response-wins fan-out and the in-app implementation. No Slack/email/Telegram/SMS in v1 (deferred per spec §20). Owns the grant/revoke lifecycle for `org_subaccount_channel_grants`.

**Files to create or modify.**

Creates:
- `server/services/approvalChannelService.ts` — impure orchestrator. Owns the approval state machine (NOT the HITL queue itself — that stays with `actionService`). Responsibilities: fan-out on approval request, first-response-wins resolution via `chargeRouterService.resolveApproval`, "resolved by Y at T" notification to losing channels, grant/revoke lifecycle for `org_subaccount_channel_grants`, audit logging of grant/revoke events.
- `server/services/approvalChannelServicePure.ts` — pure logic: collecting eligible channels for a (subaccount, org) pair, computing fan-out targets, classifying responses (winning vs superseded), computing notification payloads.
- `server/services/approvalChannels/InAppApprovalChannel.ts` — single conformant implementation. Delivers approval requests via existing `hitlService` / `reviewService` (depending on which is the entry point for in-app review-queue rows). On response receipt: calls `chargeRouterService.resolveApproval(actionId, decision)`. On notification: writes a "resolved by …" row on the underlying review item (or no-op if already resolved).

Modifies:
- (none — this chunk is mostly additive)

**Contracts.**

```typescript
interface ApprovalChannel {
  channelType: string;                              // 'in_app' in v1
  sendApprovalRequest(req: ApprovalRequest): Promise<void>;
  receiveResponse(raw: unknown): ApprovalResponse | null;
  sendResolutionNotice(resolution: ApprovalResolution): Promise<void>;
}

interface ApprovalRequest {
  actionId: string;
  chargeId: string;
  organisationId: string;
  subaccountId: string | null;
  spendingBudgetId: string;
  payload: SpendApprovalPayload;       // merchant, amount, intent, SPT last4
  approvers: Array<{ userId: string }>; // collected via authority rule (§11.1)
  expiresAt: Date;
}

interface ApprovalResolution {
  actionId: string;
  resolvedBy: { userId: string; channelType: string; respondedAt: Date };
  decision: 'approved' | 'denied';
  resolutionMessage: string;
}
```

**`spending_budget_approvers` CRUD.** Exposed via `approvalChannelService` (not via a separate service). The org/sub-account admin who owns the budget's scope can add/remove approvers; the user must already hold (or be granted alongside) `spend_approver`.

**Active-approval guard (one per chargeId).** Belt-and-braces on the existing `agent_charges.idempotency_key` UNIQUE: before `approvalChannelService.requestApproval` creates an `actions` row, it runs a guard query under advisory lock keyed on `chargeId`:

```sql
SELECT id FROM actions
 WHERE metadata_json->>'chargeId' = $1
   AND metadata_json->>'category' = 'spend'
   AND status = 'pending_approval'
 LIMIT 1;
```

If a row exists → return the existing `actionId` rather than creating a duplicate. Prevents duplicate HITL surfaces if an upstream caller retries the propose path concurrently (the agent_charges idempotency-key UNIQUE handles the ledger row; this guard handles the actions row). The guard is mandatory at the service layer; reviewers verify by walking `requestApproval`'s call graph.

**Error handling.**
- A channel adapter throws on `sendApprovalRequest` — `approvalChannelService` continues to other channels but logs the failure. If ALL channels fail, the approval action is marked `failed` with `failure_reason = 'channel_dispatch_failed'` and a critical alert fires.
- A losing channel's `sendResolutionNotice` throws — log and continue; do not fail the approval flow (the winning resolution is already committed).
- `resolveApproval` returns `{ status: 'superseded' }` on a losing race — channel records the response on the `actions` row only, never mutates `agent_charges`.
- Active-approval guard hit (existing pending row found) → return the existing `actionId`; no duplicate HITL surface; no error to the caller.

**Test considerations.**
- `approvalChannelServicePure.test.ts`:
  - Eligible-channel collection: `subaccount_approval_channels` (enabled) + `org_approval_channels` linked via active `org_subaccount_channel_grants`. Disabled channels excluded. Revoked grants excluded.
  - First-response-wins classification.
  - Notification payload construction.
  - Grant/revoke pure transition: grant adds the channel to fan-out; revoke removes it for future approvals; in-flight approvals are unaffected.
- The `InAppApprovalChannel` is exercised end-to-end in Chunk 10's workflow-engine integration; this chunk covers it via pure tests of its message-construction logic.

**Dependencies.** Chunks 1, 2, 8.

**Acceptance criteria.**
- `approvalChannelService` exposes `requestApproval(req)`, `resolveApproval(actionId, decision)` (delegates to `chargeRouterService.resolveApproval`), `notifyResolution(resolution)`, `addApprover`, `removeApprover`, `addGrant`, `revokeGrant`.
- `InAppApprovalChannel` implements the `ApprovalChannel` interface fully.
- Open/closed: future channel adapters add ONE file in `server/services/approvalChannels/`; no changes to `approvalChannelService.ts` required.
- Audit-event row written on every grant/revoke.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/approvalChannelServicePure.test.ts`

---

### Chunk 10 — Workflow Engine Wiring

**Goal.** Make the existing `action_call` workflow step type accept spend skills with the correct review kind and resume semantics.

**Files to create or modify.**

Modifies:
- `server/lib/workflow/actionCallAllowlist.ts` — concatenate `SPEND_ACTION_ALLOWED_SLUGS` (from Chunk 6) into `ACTION_CALL_ALLOWED_SLUGS`. The set membership is checked at workflow validation time and at step dispatch time.
- `server/services/workflowEngineService.ts` — add `reviewKind: 'spend_approval'` to the resume path so operators can filter spend approvals from other approval types. The resume path: when a workflow step pauses on a `pending_approval` action, the resume token carries `reviewKind`. On resume, the workflow engine matches the `reviewKind` against the action's metadata to confirm the resume is targeting the correct action.
- `shared/types/agentExecutionLog.ts` — add `'spend_ledger'` to the `LinkedEntityType` union (per spec §5.2).

**Contracts.**

`reviewKind` enum extension: existing kinds remain unchanged; `'spend_approval'` is added as a new value. The workflow-engine pause/resume machinery is unchanged otherwise — spend approvals reuse the existing pause/resume contract.

**Error handling.**
- Workflow definition references a slug not in `ACTION_CALL_ALLOWED_SLUGS` → reject at validation time with `failure('disallowed_action_in_workflow', ...)`.
- Resume token's `reviewKind` does not match the action's metadata → `failure('review_kind_mismatch', ...)`. Should not happen in normal flow; defensive guard.

**Test considerations.**
- `actionCallAllowlistPure.test.ts` — pin the union of `ACTION_CALL_ALLOWED_SLUGS` to ensure spend slugs are members.
- `workflowEngineServicePure.test.ts` (extension) — resume kind matching covers the new `'spend_approval'` value.

**Dependencies.** Chunks 1, 6, 8.

**Acceptance criteria.**
- Spend skills are valid `action_call` step targets at workflow validation.
- Resume on spend approval succeeds and the workflow continues from the paused step.
- `LinkedEntityType` includes `'spend_ledger'`.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/lib/workflow/__tests__/actionCallAllowlistPure.test.ts`

---

### Chunk 11 — Worker Round-Trip

**Goal.** Wire the IEE worker → main app → IEE worker round-trip via three pg-boss queues with correlation IDs and the 30-second deadline. Implement the `WorkerSpendCompletion` handler that respects invariant 20 (webhook precedence on `worker_hosted_form` paths).

**Files to create or modify.**

Creates:
- `server/jobs/agentSpendRequestHandler.ts` — main-app handler for the `agent-spend-request` queue. Receives `WorkerSpendRequest`, recomputes the idempotency key from `(skillRunId, toolCallId, intent, args)` via `chargeRouterServicePure.buildChargeIdempotencyKey`, rejects with `failure_reason = 'idempotency_args_drift'` if mismatched, otherwise calls `chargeRouterService.proposeCharge`. Emits the response on `agent-spend-response` keyed by `correlationId` synchronously (within the handler, before completing the pg-boss job). Awaits Stripe call inline for `main_app_stripe` paths so the response carries `providerChargeId` already.
- `server/jobs/agentSpendCompletionHandler.ts` — main-app handler for `agent-spend-completion`. Implements invariant 20: may only set `provider_charge_id` on a still-`executed` row OR transition `executed → failed` on a still-`executed` row when `outcome = 'merchant_failed'`. **MUST NOT transition to `succeeded`** — that's webhook-only. If the row already left `executed` (Stripe webhook beat the worker), the trigger rejects the update; the handler logs `worker_completion_after_terminal` and drops silently.

Modifies:
- `server/services/queueService.ts` — register the three new queue handlers. Per `architecture.md §3312` job concurrency standard: the `agent-spend-request` handler holds a per-budget advisory lock during the propose+gate sequence (already implemented in `chargeRouterService` — the handler just calls through). The `agent-spend-completion` handler is per-row idempotent via the trigger; no advisory lock needed at handler level.
- `worker/src/persistence/runs.ts` — add `iee-spend-request` (emit) and `iee-spend-completion` (emit) helper functions mirroring the `iee-run-completed` pattern. The worker calls these helpers from its execution loop.
- `worker/src/loop/executionLoop.ts` — add the `spend_request` action handler: emit the request via the helper, await the response by `correlationId` with 30-second timeout, on response branch on `decision`:
  - `approved` + `executionPath: 'main_app_stripe'`: response carries `providerChargeId`; record the success.
  - `approved` + `executionPath: 'worker_hosted_form'` + `mode: 'live'`: response carries `chargeToken` (SPT) AND `sptExpiresAt` (ISO 8601 timestamp). **Per invariant 3 (extended): refuse-if-expired check FIRST — `if (Date.now() >= Date.parse(sptExpiresAt)) { emit agent-spend-completion with outcome: 'merchant_failed', failureReason: 'spt_expired_at_worker'; return; }`**. Only then fill the merchant form; emit `agent-spend-completion` with `outcome: 'merchant_succeeded'` (carries `providerChargeId`) or `outcome: 'merchant_failed'` (carries `failureReason`); **drop the SPT variable synchronously — the SPT MUST NOT outlive the local async function scope; MUST NOT be persisted to disk, log line, queue payload, or any cross-iteration cache.**
  - `approved` + `mode: 'shadow'`: response carries `chargeToken: null`, `sptExpiresAt: null`, and `providerChargeId: null`; skip form-fill; record success.
  - `blocked`: record the policy denial; the workflow follows its denial-handling path.
  - `pending_approval`: pause the workflow; the resume happens via the workflow-resume channel (Chunk 10), not via a long-deadlined `agent-spend-response`.
  - Timeout (no response within 30s): record the timeout; the main app's execution-window timeout job will reconcile the orphaned row.
- `worker/src/persistence/runs.ts` — the worker MUST carry `agent_charges.idempotency_key` as Stripe's `Idempotency-Key` HTTP header on every merchant call (invariant 3). Document this with an inline comment + a small static-analysis test in `worker/src/__tests__/spendIdempotencyHeader.test.ts` if practical.

**Contracts.**

`WorkerSpendRequest` (§8.3), `WorkerSpendResponse` (§8.4), `WorkerSpendCompletion` (§8.4a) — exact shapes pinned in the spec, reproduced in `shared/iee/actionSchema.ts` extension. **All three payloads carry `traceId: string`** (per invariant 38) — sourced from the `agent_runs.id` of the run that initiated the charge, OR a new uuid for direct-call retries; propagated through the queue handlers and logged on every `logChargeTransition` line.

`WorkerSpendResponse` carries `sptExpiresAt: string | null` (ISO 8601). Non-null when `decision === 'approved'` AND `executionPath === 'worker_hosted_form'` AND `mode === 'live'`. Null in every other case (shadow / main_app_stripe / blocked / pending_approval). Computed by main-app `agentSpendRequestHandler` from the underlying `integration_connections.token_expires_at` minus a small safety margin (default 60 s; configurable via `SPT_WORKER_HANDOFF_MARGIN_MS`). Worker MUST refuse-if-expired per invariant 3 (extended).

`correlationId` is a uuid the worker generates per request. The main-app handler responds on `agent-spend-response` using the same uuid; the worker matches by uuid.

**Decision union scope (§8.4):** the immediate-decision response is `'approved' | 'blocked' | 'pending_approval'` ONLY. `'denied'` (HITL human rejection) and late `'approved'` (HITL approval after pending) NEVER go on this queue — they arrive via the workflow-resume channel.

**Error handling.**
- Idempotency-args drift → reject with `failure_reason = 'idempotency_args_drift'`. Worker receives `{ decision: 'blocked', errorReason: 'idempotency_args_drift' }`.
- Worker crash mid form-fill → no completion arrives; execution-timeout job reconciles to `failed(execution_timeout)`. If Stripe later webhooks `succeeded` for the `provider_charge_id` the worker had submitted, the `failed → succeeded` post-terminal override applies (§4 rules). Stripe's idempotency-key header collapses any duplicate redemption.
- Stale `agent-spend-completion` for a row that already left `executed` → trigger rejects; handler logs `worker_completion_after_terminal` and drops silently (no error to worker).

**Test considerations.**
- `agentSpendRequestHandler.test.ts` (pure-helper level) — payload validation + idempotency-key recompute + drift rejection.
- `agentSpendCompletionHandlerPure.test.ts` — decision logic for the three branches: `merchant_succeeded` on still-executed → permitted; `merchant_failed` on still-executed → permitted; either outcome on already-terminal → rejected (drops silently). Pure tests use a stubbed DB query result; do not exercise the trigger.
- The 30-second deadline is exercised by a worker-side pure test that mocks pg-boss send/receive.

**Dependencies.** Chunks 1, 5.

**Acceptance criteria.**
- Three queues registered: `agent-spend-request` (main app handler), `agent-spend-response` (worker consumer), `agent-spend-completion` (main app handler).
- `WorkerSpendRequest`, `WorkerSpendResponse`, `WorkerSpendCompletion` shapes pinned in `shared/iee/actionSchema.ts`.
- The worker emits `spend_request` from its loop and awaits the response with a 30-second timeout.
- The worker carries `agent_charges.idempotency_key` as Stripe's `Idempotency-Key` HTTP header on the merchant call (invariant 3).
- The worker performs the refuse-if-expired check on `sptExpiresAt` BEFORE using the SPT; expired SPT → emit `agent-spend-completion` with `outcome: 'merchant_failed'`, `failureReason: 'spt_expired_at_worker'` (invariant 3 extended).
- SPT scope is single-iteration: the worker does not persist the SPT to disk, log line, queue payload, or cross-iteration cache. Reviewer checklist: walk `executionLoop.ts` and confirm the SPT variable is local to the spend-handler function and goes out of scope on return.
- The main-app `agent-spend-completion` handler implements invariant 20 — only `provider_charge_id` set OR `executed → failed`; never `executed → succeeded`.
- `WorkerSpendResponse.sptExpiresAt` populated correctly per the contract above; null on shadow / main_app_stripe / blocked / pending_approval.
- All three queues are declared in `server/config/jobConfig.ts` with explicit retry / expiry / DLQ config.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx server/jobs/__tests__/agentSpendRequestHandlerPure.test.ts`
- `npx tsx server/jobs/__tests__/agentSpendCompletionHandlerPure.test.ts`

---

### Chunk 12 — Stripe Webhook Ingestion

**Goal.** Implement the Stripe webhook ingestion route + service for agent-initiated charges. Owns signature verification, deduplication, state-machine transitions, the amount/currency invariant check (§10 invariant 24), and the 30-minute reconciliation poll.

**Files to create or modify.**

Creates:
- `server/routes/webhooks/stripeAgentWebhook.ts` — mounted at `/api/webhooks/stripe-agent/:connectionId`. Strict route order:
  1. `raw({ type: 'application/json' })` body parser registered before global JSON parser.
  2. Resolve `:connectionId` via `withAdminConnection` (no tenant context yet). 404 if no row, or `providerType !== 'stripe_agent'`, or `connectionStatus = 'revoked'`.
  3. Verify `stripe-signature` against `configJson.webhookSecret`. Reject 400 + `recordIncident` on failure.
  4. Resolve tenant context (`organisationId`, `subaccountId`) from the verified row.
  5. Dedupe via `webhookDedupeStore` keyed on Stripe event `id`. If processed already, return 200 immediately and DO NOT enqueue.
  6. Enqueue dispatch to `stripeAgentWebhookService` with the resolved tenant context.
  7. Acknowledge with HTTP 200.
- `server/services/stripeAgentWebhookService.ts` — async processor. Responsibilities:
  - Resolve the `agent_charges` row by `provider_charge_id` match. On lookup failure → `reconciliation_mismatch` critical alert.
  - Verify tenant ID match between webhook resolved tenant and `agent_charges.organisation_id` / `subaccountId`. Mismatch → `reconciliation_mismatch` critical alert + block transition.
  - Apply invariant 24 amount/currency check: webhook amount (interpreted via ISO 4217 minor-unit exponent for the webhook's currency) MUST equal `agent_charges.amount_minor` AND webhook currency MUST equal `agent_charges.currency`. On any mismatch: hold row in `executed`, fire `ledger_amount_mismatch` critical alert.
  - State transitions: `executed → succeeded`, `executed → failed`, `succeeded → refunded`, `succeeded → disputed`, `disputed → succeeded`, `disputed → refunded`. **Plus the carved-out `failed → succeeded` post-terminal transition** when the original `failed` reason was `roundtrip_timeout` or `execution_timeout` and Stripe reports `succeeded` for the `provider_charge_id`. Caller-identity guard: `SET LOCAL app.spend_caller = 'stripeAgentWebhookService'` before each UPDATE.
  - Out-of-order webhook handling: if a webhook arrives for a transition whose predecessor state hasn't been reached, apply deterministically-implied missing transitions in a single atomic DB operation (e.g. `charge.refunded` on `executed` → apply `executed → succeeded → refunded` atomically). Log at INFO with label `webhook_ordering_compensated`. If sequence is ambiguous, re-enqueue with 60-second delay and retry up to 3 times, then `webhook_ordering_anomaly` warning alert.
  - Monotonicity: never roll back from a later terminal state to an earlier state. Enforced at app layer (`assertValidTransition`) and at DB layer (trigger).
  - On outbound `→ succeeded`: trigger `agentSpendAggregateService.upsertAgentSpend(charge)` (Chunk 13).
  - On inbound-refund-row `→ succeeded`: trigger `agentSpendAggregateService.upsertAgentSpend(charge)` — direction-aware path subtracts from parent's rollup window.
  - On outbound `→ refunded` (dispute lost): trigger `agentSpendAggregateService.upsertAgentSpend(charge)` — subtract.
  - Set `last_transition_by = 'stripe_webhook'` and `last_transition_event_id = <stripe event id>` on every transition.
- `server/jobs/stripeAgentReconciliationPollJob.ts` + `*Pure.ts` — runs every 5-10 minutes. Polls Stripe API for `executed` rows aged > 30 minutes. If poll returns a terminal Stripe state, drives the equivalent transition. On poll failure: log; row stays `executed`; surfaces in dashboard "pending confirmation"; warning alert fires (§16.6).

**Contracts.**

The route / service are independent: route does signature verification + dedup + enqueue; service does state transitions + invariant checks + alerts. The split keeps the route fast (200 ack target < 100ms) and the service's tenant-scoped logic isolated.

`webhookDedupeStore` is keyed on `stripe-event-id`. No additional salt or per-tenant scoping — Stripe event ids are globally unique.

**Dedupe TTL is locked at ≥ 96 hours** (`STRIPE_WEBHOOK_DEDUPE_TTL_MS = 96 * 60 * 60 * 1000` minimum). Stripe retries failed deliveries for up to 3 days; the dedupe store must outlive that window with margin so retry storms cannot reprocess. The TTL is set explicitly when the route registers the dedupe store; do NOT rely on the store's default. If the existing `webhookDedupeStore` infrastructure does not accept a per-route TTL override, the implementer extends it in this chunk (small change). Reviewer checklist: confirm the configured TTL on the spend webhook is ≥ 96 h and that it is set explicitly, not inherited from a shorter platform default.

**Multi-layer dedupe (invariant 37).** Three layers protect against duplicate processing:

| Layer | Key | Component | Failure tolerance |
|---|---|---|---|
| Primary | Stripe event id | `webhookDedupeStore` (Redis-backed in prod) | Required for normal-path performance. |
| Secondary | `agent_charges.last_transition_event_id` | `stripeAgentWebhookService` checks before applying any transition; if inbound event id matches the row's `last_transition_event_id`, return 200 with no transition (already applied). | Catches duplicates when primary is unavailable or evicted. |
| Tertiary | DB trigger monotonicity | `agent_charges_validate_update` | Catches regressions from out-of-order replays even if both above missed. |

When `webhookDedupeStore` is unavailable (Redis connection failure / timeout), the route logs a `dedupe_store_degraded` warning alert and proceeds with the layer-2 + layer-3 protection. No single-component failure permits duplicate transitions to the ledger. Implementer: the secondary check happens INSIDE `stripeAgentWebhookService.applyTransition` — read `last_transition_event_id` first, compare to inbound event id, return early if match.

**`traceId` threading.** The webhook route extracts `traceId` from `agent_charges.metadata_json.traceId` (set at proposeCharge time per invariant 38) and threads it through the service handler + every `logChargeTransition` call. End-to-end trace from `agent_runs.id` → `agent_charges.id` → Stripe webhook → reconciliation poll is preserved.

**Error handling.**
- Signature verification failure → 400 + `recordIncident` (`stripeAgentWebhook.signature_failure`). Stripe will retry; valid retries succeed once the secret matches (e.g. after rotation).
- Tenant ID mismatch (cross-account spoof or misrouted event) → critical alert; block the transition. The verified per-connection webhook secret is the first binding; the `provider_charge_id` row match is the second binding. Both must agree.
- Invariant 24 mismatch → critical alert; row stays `executed`; manual reconciliation.
- Unknown `provider_charge_id` → critical alert; no transition.
- Reconciliation poll API failure → log + warning alert; do not transition the row; retry on the next poll cycle.

**Test considerations.**
- `stripeAgentWebhookServicePure.test.ts` — every state transition listed in §4 (allowed and forbidden); the carve-out `failed → succeeded` only when caller is the webhook service and the original failure reason was a timeout; out-of-order compensation logic (deterministic implied transitions); monotonicity guard.
- `stripeAgentReconciliationPollJobPure.test.ts` — cutoff math (30-minute threshold), candidate-row selection.
- `webhookAmountInvariantPure.test.ts` — invariant 24 check with USD/JPY/BHD examples (different exponents); ambiguous-exponent rejection.
- Reviewer checklist: `paymentReconciliationJob.ts` is unchanged (excluded from agent-charge reconciliation per spec §7.5 — different source rows, no double-counting risk).

**Dependencies.** Chunks 1, 2, 3, 5.

**Acceptance criteria.**
- New webhook route mounted with strict body-parser order; signature verification against per-connection secret; dedup via `webhookDedupeStore` with **TTL set explicitly to ≥ 96 hours**; 200 ack target.
- **Multi-layer dedupe (invariant 37):** primary `webhookDedupeStore`, secondary `last_transition_event_id` row-level check, tertiary trigger monotonicity. Dedupe-store outage triggers `dedupe_store_degraded` warning alert; layers 2 + 3 still prevent duplicate transitions.
- `stripeAgentWebhookService` covers all state transitions including the carve-out, out-of-order compensation, monotonicity, invariant 24.
- Webhook amount validation uses `validateAmountForCurrency` (single source of truth shared with Chunk 5 / invariant 24 outbound twin).
- `last_transition_by` and `last_transition_event_id` populated correctly; every transition emits `logChargeTransition` (with `traceId`) per invariants 31 + 38.
- Reconciliation poll job registered in `queueService.ts`; polls every 5-10 minutes; respects the 30-minute threshold.
- `paymentReconciliationJob` unchanged.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx server/services/__tests__/stripeAgentWebhookServicePure.test.ts`
- `npx tsx server/jobs/__tests__/stripeAgentReconciliationPollJobPure.test.ts`
- `npx tsx server/services/__tests__/webhookAmountInvariantPure.test.ts`

---

## 7. Per-Chunk Detail — Chunks 13-16

### Chunk 13 — Cost Aggregation Parallel Writer + Budget/Channel Routes

**Goal.** Land the parallel writer for spend dimensions, the CRUD routes for `spending_budgets` / `spending_policies` / `agent_charges` (read-only) / approval channels, and the `spend_approver` default-grant logic. Ship a 501 stub for the promote-to-live route (replaced in Chunk 15).

**Files to create or modify.**

Creates:
- `server/services/agentSpendAggregateService.ts` — parallel writer to `costAggregates`. `upsertAgentSpend(charge)` upserts three dimension rows: `agent_spend_subaccount` (monthly + daily, keyed by `subaccountId`), `agent_spend_org` (monthly + daily, keyed by `organisationId`), `agent_spend_run` (per-run, keyed by `agentRunId`). Direction-aware: outbound `succeeded` adds; inbound-refund `succeeded` subtracts from parent's window; outbound `succeeded → refunded` (dispute-loss) subtracts from window. **MUST NOT be called from `costAggregateService.upsertAggregates`** — kept in a separate file to prevent commingling with LLM cost rollups (per spec §6.1 last paragraph).

  **Idempotency per invariant 27.** The function is idempotent per `(chargeId, terminal_state)` tuple. Implementation:

  ```sql
  BEGIN;
  -- guard: only apply when last_aggregated_state differs from new terminal state
  UPDATE agent_charges
     SET last_aggregated_state = $new_state
   WHERE id = $charge_id
     AND (last_aggregated_state IS DISTINCT FROM $new_state);
  -- if 0 rows updated → already aggregated for this terminal state; return early
  -- otherwise: apply the per-dimension UPSERTs to cost_aggregates
  COMMIT;
  ```

  The guard column `agent_charges.last_aggregated_state` is added by Chunk 2's migration (`<NNNN+1>_agentic_commerce_schema.sql` — see Chunk 2 update below). Webhook redelivery, out-of-order compensation, and the reconciliation-poll-job arriving for the same logical event all hit the early-return branch.

  **Non-negative clamp per invariant 28.** Subtractions (refund / dispute-loss / inbound-refund) clamp at zero: `GREATEST(current_value - delta, 0)`. When a clamp happens, emit a `negative_aggregate_clamp` warning alert carrying `chargeId`, `dimension`, `windowKey`, attempted-delta, pre-clamp value. The clamp event signals derived-view drift that needs investigation; the parent `agent_charges` row remains the source of truth.

  **Half-open window keys per invariant 42.** All `windowKey` derivation uses `chargeRouterServicePure.deriveWindowKey(timestamp, dimension, 'UTC')` — half-open `[start, end)` semantics. Boundary charges are unambiguously assigned. No bespoke date math in this service.

  **Inbound-refund row pattern (invariant 41).** When the source row is `kind = 'inbound_refund'` (created by the `issue_refund` skill in Chunk 6), `upsertAgentSpend` subtracts the row's `amount_minor` from the parent's window aggregate; the original outbound `succeeded` row is NOT mutated. The aggregator reads `parent_charge_id` to locate the parent's window key. Dispute-loss path (`succeeded → refunded` on the original row) is preserved per spec §4 and is the only same-row mutation that subtracts.

- `server/config/spendAlertConfig.ts` — **NEW** alert-threshold registry per invariant 39:
  - `negativeAggregateClamp`: critical, no threshold (always alerts).
  - `webhookDeliveryDelayMs`: warning when `Date.now() - stripeEventTimestamp > 10 * 60 * 1000`.
  - `chargeRetryAttempts`: warning when `count(retries WHERE intent_id = $i) > 3`.
  - `advisoryLockWaitMs`: warning when `withOrgTx`'s lock-acquisition probe exceeds 1000 ms.
  - `spendThroughputAnomaly`: warning when 1-min `proposed → terminal` rate < 50 % of 7-day rolling baseline; critical when < 20 % for >5 minutes.

  Defaults are tunable per environment via env-var overrides. The alert dispatch path uses the existing platform alert primitive (Slack / email / on-call rotation — implementer confirms against the existing `alerting` infra).
- `server/services/spendingBudgetService.ts` + `spendingBudgetServicePure.ts` — CRUD for `spending_budgets` and `spending_policies`. Pure layer: limit-calculation helpers, policy-version-increment logic, promotion state machine (used by Chunk 15), `validateMerchantAllowlist(allowlist)` (length check ≤ `MERCHANT_ALLOWLIST_MAX_ENTRIES` per invariant 32 — also dedupes and rejects entries that fail `normaliseMerchantDescriptor`). Impure: `create()`, `update()`, `getById()`, `listForOrg()`, `listForSubaccount()`, plus the `spend_approver` default-grant logic. The default-grant runs atomically with the budget INSERT inside a single transaction: enumerates current role-holders (org-admin if org-scoped, sub-account-admin if sub-account-scoped) and inserts a permission grant per user. Partial-failure: roll back the whole transaction. **Allowlist validation runs at every CRUD boundary** (`create`, `update`, and any policy-update path that touches `merchant_allowlist`); >250 entries → 400 with `validation_error: 'allowlist_too_large'`.
- `server/routes/spendingBudgets.ts` — CRUD + `POST /:id/promote-to-live`. **Stub** the promote route to return HTTP 501 with `{ reason: 'promotion_flow_pending' }` until Chunk 15 lands. UI surfaces as "promote to live: not yet available" until then.
- `server/routes/spendingPolicies.ts` — `GET`/`PATCH /spending-budgets/:id/policy`. PATCH increments `version` and writes audit-event row.
- `server/routes/agentCharges.ts` — read-only ledger queries: `GET /agent-charges?status=&intent_id=&from=&to=&limit=&cursor=`, `GET /agent-charges/:id`, `GET /agent-charges/aggregates?dimension=agent_spend_subaccount|agent_spend_org|agent_spend_run`. Supports settled-spend filters and the "in-flight reserved" auxiliary calculation per spec §7.6.
- `server/routes/approvalChannels.ts` — CRUD for `subaccount_approval_channels`, `org_approval_channels`, and `org_subaccount_channel_grants`.

Modifies:
- `server/services/costAggregateService.ts` — comment-only update marking the new entityType values are owned by `agentSpendAggregateService`. No logic change.
- `server/lib/permissions.ts` — `spend_approver` default-grant rule documented (the implementation is in `spendingBudgetService.create()`).

**Contracts.**

All routes follow the standard route conventions: `asyncHandler`, `authenticate`, `requirePermission(...)` per spec §11.3, `resolveSubaccount(req.params.subaccountId, req.orgId!)` for any `:subaccountId` route, no direct `db` access in routes.

**Settled-vs-in-flight read rule (spec §7.6).** Aggregate reads from `cost_aggregates` reflect SETTLED spend only. The dashboard MUST label aggregate displays as "settled spend" and surface a separate "in-flight reserved" figure (computed live from `agent_charges` non-terminal pre-execution rows: `pending_approval`, `approved`, `executed`).

**Unique-constraint HTTP mapping (spec §9.5).**
- `agent_charges.idempotency_key` UNIQUE → 200 (idempotent hit; return existing row).
- `spending_budgets (organisation_id, agent_id)` UNIQUE WHERE agent_id IS NOT NULL → 409.
- `spending_budgets (organisation_id, subaccount_id, currency)` UNIQUE WHERE agent_id IS NULL AND subaccount_id IS NOT NULL → 409.
- `spending_policies.spending_budget_id` UNIQUE → 409.
- `spending_budget_approvers (spending_budget_id, user_id)` UNIQUE → 409.

**Error handling.**
- Service layer catches Postgres `23505` and converts to the mapped HTTP status with a structured error message — never let `23505` bubble as 500.
- Default-grant transaction fails (e.g. permission-system rejects a user) → roll back budget creation; surface error to the caller with `failure_reason = 'default_grant_failed'`.

**Test considerations.**
- `agentSpendAggregateServicePure.test.ts` — direction-aware accounting: outbound `succeeded` adds; inbound-refund subtracts from parent; outbound `→ refunded` subtracts from window. Settled vs in-flight not commingled. **Idempotency per (chargeId, terminal_state):** invoke the writer twice for the same charge and same terminal state → second call is a no-op, aggregate is unchanged. **Non-negative clamp:** subtraction taking the aggregate below zero clamps at zero AND records a `negative_aggregate_clamp` event in the test fixture's alert sink.
- `spendingBudgetServicePure.test.ts` — default-grant computation (org-admin enumeration, sub-account-admin enumeration); policy-version-increment math; promotion state machine. `validateMerchantAllowlist` covers boundary cases: empty (allowed); 250 entries (allowed); 251 entries (rejected); duplicate entries (rejected); whitespace-only entry (rejected).
- `agentChargesRoutePure.test.ts` (light) — query-parameter parsing, filter validation.

**Dependencies.** Chunks 1, 2, 5, 9.

**Acceptance criteria.**
- `agentSpendAggregateService` is a separate file from `costAggregateService` and is NEVER called from `costAggregateService.upsertAggregates`.
- `agentSpendAggregateService.upsertAgentSpend` is idempotent per `(chargeId, terminal_state)` tuple via the `last_aggregated_state` guard column (invariant 27).
- Aggregate subtractions clamp at zero with `negative_aggregate_clamp` warning alert (invariant 28).
- All `windowKey` derivation uses `deriveWindowKey` with half-open `[start, end)` semantics (invariant 42).
- Inbound-refund rows (`kind = 'inbound_refund'`, created by `issue_refund`) drive the subtract path; original outbound `succeeded` rows are NOT mutated (invariant 41).
- `server/config/spendAlertConfig.ts` exists with thresholds for `negative_aggregate_clamp`, webhook delay, retry count, lock-wait, and `spend_throughput_anomaly` (invariant 39).
- Allowlist validation enforces `MERCHANT_ALLOWLIST_MAX_ENTRIES = 250` cap on every CRUD path; >250 → 400 (invariant 32).
- All CRUD routes for `spending_budgets`, `spending_policies`, `agent_charges` (read), and `approval_channels` exist with correct route guards and `resolveSubaccount` calls.
- `POST /spending-budgets/:id/promote-to-live` returns HTTP 501 in this chunk.
- `spend_approver` default-grant runs atomically with budget INSERT.
- 23505 violations are mapped to named HTTP statuses (200 idempotent or 409); never 500.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx server/services/__tests__/agentSpendAggregateServicePure.test.ts`
- `npx tsx server/services/__tests__/spendingBudgetServicePure.test.ts`

---

### Chunk 14 — Admin UI

**Goal.** Eight client surfaces (per spec §17 Chunk 14 + §18.1). Backed by Chunk 13 routes; Chunk 15 lands the live promote-to-live flow.

**Files to create or modify.**

Creates:
- `client/src/pages/SpendingBudgetsListPage.tsx` — list + create + per-budget link to detail.
- `client/src/pages/SpendingBudgetDetailPage.tsx` — Spending Budget editor: name, currency (immutable), monthly-spend alert threshold, per-policy mode toggle (shadow/live with the "Promote to live" button — stubbed message until Chunk 15), per-policy limits, allowlist editor, approval threshold.
- `client/src/pages/SpendLedgerPage.tsx` — Spend Ledger dashboard: charges table with filters (status, merchant, amount, mode), retry grouping (by `intent_id`, collapsible parent + per-attempt children), top block reasons panel (aggregates `failure_reason` for `status IN ('blocked', 'denied')` over last 7d, sorted by count desc), settled-spend display with "in-flight reserved" auxiliary figure.
- `client/src/components/spend/EmptyAllowlistBanner.tsx` — prominent banner on Spending Budget create / detail when `merchant_allowlist` is empty; copy: `"Empty allowlist — every charge will block. Click 'Load conservative defaults' to populate working values, or add merchants manually."` Persists until allowlist has at least one entry.
- `client/src/components/spend/ConservativeDefaultsButton.tsx` — one-click loader that POSTs to a service endpoint populating per_txn=$20, daily=$100, monthly=$500, threshold=0, and the descriptor list per spec §14 (NAMECHEAP, OPENAI, ANTHROPIC, CLOUDFLARE, TWILIO, STRIPE).
- `client/src/components/spend/RetryGroupRow.tsx` — collapsible row grouping by `intent_id` with most recent attempt first; toggle to disable grouping.
- `client/src/components/spend/TopBlockReasonsPanel.tsx`.
- `client/src/components/spend/KillSwitchPanel.tsx` — three-level kill switch UI surfaces (per-policy, per-sub-account, per-org); confirmation modal warning that re-enablement is not in v1 (per spec §15).
- `client/src/pages/SubaccountApprovalChannelsPage.tsx` — sub-account admin manages own channels.
- `client/src/pages/OrgApprovalChannelsPage.tsx` — org admin manages org channels + grant management screen.
- `client/src/components/approval/GrantManagementSection.tsx` — org admin adds/revokes org channels to sub-account fan-out.
- Permissions-driven nav surfaces — Spending Budgets and Spend Ledger entries appear in the admin sidebar only when the caller has `spend_approver` (visibility) or admin (full edit).

Modifies:
- `client/src/pages/ReviewQueuePage.tsx` — already extended in Chunk 8 with `renderSpendPayload`. No change here.
- `client/src/components/dashboard/PendingApprovalCard.tsx` — already extended in Chunk 8 with the spend lane.

**Contracts.**

All client surfaces consume the routes from Chunk 13. Pure UI logic (formatting, filter computation, retry grouping) extracted into `*Pure.ts` files alongside each component for unit-testable rendering math.

**State management:** standard Automation OS pattern — `lazy()` page components with `Suspense`; permissions-driven nav via `/api/my-permissions` and `/api/subaccounts/:id/my-permissions`; WebSocket rooms (`subaccount:{id}` for live charge updates, the existing room reused) for real-time table refresh.

**Currency formatting.** Use `client/src/lib/formatMoney.ts` with currency-aware rendering. The `formatMoney.micro: true` opt-in handles sub-cent values for compute costs; spend amounts use the standard 2dp default for USD/EUR/GBP, 0dp for JPY/KRW, 3dp for BHD/KWD per ISO 4217. Implementer may need to extend `formatMoney.ts` if currency-aware exponent rendering isn't already supported — verify before forking; the existing helper handles fractional dollars but the exponent map may need to land here.

**Error handling.**
- Loading state: skeleton table + "Loading…" indicators on every list/detail page.
- Empty state: budget list empty → "Create your first Spending Budget" CTA; ledger empty → "No charges yet" + link to docs.
- Error state: 4xx/5xx from routes → toast + retry button; persistent failure surfaces a banner.
- Permission-denied state: surface read-only views; hide mutation buttons.

**Test considerations.**
- Per-component pure tests for rendering math: `EmptyAllowlistBannerPure.test.ts`, `RetryGroupingPure.test.ts`, `TopBlockReasonsAggregationPure.test.ts`, `formatSpendCardPure.test.ts` (already in Chunk 8).
- React component shells are thin; no component-level tests authored (per testing posture — `frontend_tests: none_for_now`).

**Dependencies.** Chunks 1, 13. Soft prereq: Chunk 5 (so the routes return real data; until Chunk 5, the UI fetches against an empty ledger).

**Acceptance criteria.**
- All eight UI surfaces exist and render the correct loading / empty / error / data states.
- Empty-allowlist banner persists until allowlist has at least one entry.
- "Promote to live" button shows the "not yet available" message until Chunk 15 merges.
- Permissions-driven visibility on every nav entry, every mutation button.
- Currency-aware formatting per ISO 4217 exponent.
- Sortable/filterable tables per `architecture.md` Architecture Rules § Client.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx client/src/components/spend/__tests__/RetryGroupingPure.test.ts`
- `npx tsx client/src/components/spend/__tests__/TopBlockReasonsAggregationPure.test.ts`

---

### Chunk 15 — Shadow-to-Live Promotion Flow

**Goal.** Replace Chunk 13's 501 stub with the live promotion flow. HITL-gated; first approval flips `spending_policies.mode` and increments `version`.

**Files to create or modify.**

Creates:
- `server/skills/promote_spending_policy_to_live.md` — system-only HITL-gated skill (or registered as a non-skill action depending on the existing registration pattern; implementer to confirm against `actionRegistry.ts`).
- `client/src/components/spend/PromotePolicyConfirmationModal.tsx` — modal that explains the consequence of promotion ("All future charges on this policy will move real money") + Confirm/Cancel.

Modifies:
- `server/routes/spendingBudgets.ts` — replace the 501 stub at `POST /:id/promote-to-live`. The handler delegates to `spendingBudgetService.requestPromotion` which (a) takes a per-`spending_policy_id` advisory lock, (b) checks for an existing pending promotion action (per invariant 29), (c) creates a new `actions` row with `actionType: 'promote_spending_policy_to_live'`, `gateLevel: 'review'`, `metadata_json.category: 'spend_promotion'`. The action fans out via `approvalChannelService` to all `spend_approver` users for the budget's scope.
- `server/services/spendingBudgetService.ts` — add `requestPromotion(budgetId, requesterId)` AND `promoteToLive(budgetId, approvalActionId)`. **`requestPromotion` enforces invariant 29 (one active promotion per `spending_policy_id`):** under advisory lock keyed on `spending_policy_id`, SELECT for an existing `actions` row matching `actionType = 'promote_spending_policy_to_live'` AND `status = 'pending_approval'` AND `metadata_json->>'spendingBudgetId' = $1`; if found → return `{ outcome: 'promotion_already_pending', actionId: <existing id> }` and DO NOT create a duplicate. `promoteToLive` re-validates the current policy version, flips `spending_policies.mode = 'live'`, increments `spending_policies.version` by 1, audit-logs the promotion. Optional belt-and-braces: partial unique index on `actions` (implementer's choice; service-layer guard is mandatory regardless).
- `server/services/approvalChannelService.ts` (or wherever HITL resolution lands) — extend `resolveApproval` to handle the new `'promote_spending_policy_to_live'` action type by calling `spendingBudgetService.promoteToLive`.
- `client/src/pages/SpendingBudgetDetailPage.tsx` — replace the "not yet available" stub for "Promote to live" with the real button + confirmation modal + post-submit "Promotion request pending approval" state.

**Contracts.**

Promotion HITL action carries `metadata_json: { category: 'spend_promotion', spendingBudgetId, currentVersion }`. The version is checked at approval time — drift (someone updated the policy between submit and approval) → auto-deny with `reason = 'policy_changed'`.

**Past shadow charges remain `shadow_settled`.** Only future charges use live mode.

**Error handling.**
- Approval-side policy-version drift → auto-deny with `reason = 'policy_changed'`. Operator must re-promote.
- All approval channels fail to dispatch → action marked `failed` with `failure_reason = 'channel_dispatch_failed'`; critical alert.

**Test considerations.**
- `promotePolicyPure.test.ts` — version-increment math; drift-detection logic; mode flip atomicity.

**Dependencies.** Chunks 1, 9, 13, 14.

**Acceptance criteria.**
- `POST /spending-budgets/:id/promote-to-live` no longer returns 501; creates the HITL action; fans out to approvers.
- **Only one active promotion per `spending_policy_id` at a time** (invariant 29). Concurrent calls under contention return the SAME `actionId` for the in-flight request; no duplicate HITL surfaces; service-layer guard enforced under advisory lock.
- First approval: flips mode, increments version atomically, audit-logged.
- UI displays "Promotion request pending approval" between submit and approval; subsequent submit attempts while a promotion is pending render the existing pending state rather than creating a new request.
- Past shadow rows untouched.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx tsx server/services/__tests__/promotePolicyPure.test.ts`

---

### Chunk 16 — Default Templates and Onboarding

**Goal.** Ship the per-org shadow retention configuration UI and the SPT onboarding wizard hookup. The conservative-defaults one-click button already shipped in Chunk 14; this chunk makes its values configurable per org and wires the SPT OAuth flow.

**Files to create or modify.**

Creates:
- `client/src/pages/SptOnboardingPage.tsx` — SPT OAuth flow integration with the existing `integrationConnections` OAuth UI. Walks the operator through: Stripe Connect (or platform-level token issuance, per spec) → connection landing on `integration_connections` with `providerType = 'stripe_agent'` → confirmation. Reuses `useOAuthPopup` hook.
- `client/src/components/spend/ShadowRetentionConfigSection.tsx` — admin-only edit for `organisations.shadow_charge_retention_days` (default 90).

Modifies:
- `server/routes/organisations.ts` (or wherever per-org settings are edited) — add PATCH for `shadow_charge_retention_days` (admin-only; range [1, 365]).
- `server/jobs/shadowChargeRetentionJob.ts` — **NEW** background job (declared in spec §18.1 / §17 Chunk 16 / §14). Scans `agent_charges WHERE status = 'shadow_settled' AND settled_at + organisations.shadow_charge_retention_days * INTERVAL '1 day' < NOW()` and DELETEs matching rows. The retention job is the only DB path that may delete `agent_charges` rows. **MUST set `app.spend_caller = 'retention_purge'`** before each DELETE (the trigger has a special-case for the retention job; implement in Chunk 2 trigger SQL alongside the carve-out gate).
- `server/services/queueService.ts` — register the retention job as a daily cron (e.g. 03:30 UTC, in line with the `llm-ledger-archive` cadence at 03:45).
- Onboarding flow (e.g. `client/src/pages/OnboardingPage.tsx`) — add the SPT onboarding step gated on the org enabling agentic commerce.

**Contracts.**

`shadow_charge_retention_days` is per-org. Default 90. Range [1, 365]. The retention job runs against the per-org value.

**Error handling.**
- Retention job DELETE fails for a row (e.g. trigger reject because the row is no longer `shadow_settled`) → log + continue. Per-row failures don't abort the job.
- SPT onboarding OAuth callback failure → user-friendly error + retry; integration_connection row not created until OAuth completes.

**Test considerations.**
- `shadowChargeRetentionJobPure.test.ts` — cutoff math per org; per-row decision (settled vs not).

**Dependencies.** Chunks 1, 13, 14.

**Acceptance criteria.**
- SPT onboarding wizard walks the operator from "no connection" to `integration_connections` row with `providerType = 'stripe_agent'`.
- Retention job runs daily and DELETEs `shadow_settled` rows past the per-org window. The trigger permits the retention job's DELETEs via the `app.spend_caller = 'retention_purge'` GUC; all other DELETEs are rejected.
- Admin can edit `shadow_charge_retention_days` per org (range [1, 365]).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx tsx server/jobs/__tests__/shadowChargeRetentionJobPure.test.ts`

---

## 8. UX Considerations

The frontend surfaces in this build serve operators (org admins and sub-account admins) and approvers (`spend_approver` role). They are not consumer-facing, but per `docs/frontend-design-principles.md`, "consumer-simple on enterprise-grade backend" still applies — every surface answers a single primary question without forcing the operator to assemble multiple panels of information mentally.

### 8.1 Primary tasks per surface

| Surface | Primary task | Audience |
|---|---|---|
| Spending Budgets list | "What budgets exist and which are in shadow vs live?" | Operator (admin) |
| Spending Budget detail | "Configure this budget's policy, limits, allowlist, threshold, kill switch" | Operator (admin) |
| Spend Ledger | "What did our agents try to spend? What got blocked? Where do we tune the policy?" | Operator (admin + spend_approver) |
| Subaccount approval channels | "Who approves spend for this sub-account?" | Sub-account admin |
| Org approval channels + grants | "Which org channels see approvals from which sub-accounts?" | Org admin |
| Kill Switch | "Stop spend now — this budget / sub-account / org" | Org/sub-account admin |
| SPT onboarding | "Connect Stripe so agents can spend" | Org/sub-account admin |
| Promote-to-live | "I'm satisfied with shadow evidence; flip this policy to live" | spend_approver (via approval) |

Each primary task gets one screen; if a screen is doing two primary tasks, split it.

### 8.2 Loading, empty, error states

All eight surfaces ship the four states (loading, empty, error, data) per the standard Automation OS pattern. Specific notes:

- **Loading:** skeleton table for ledger; "Loading…" indicator for detail pages; spinner for OAuth callback.
- **Empty:**
  - Spending Budgets list empty → "Create your first Spending Budget" CTA.
  - Spend Ledger empty → "No charges yet — once an agent runs a spend skill, attempts will appear here." Plus link to docs / capabilities.
  - Approval channels empty → "Add an in-app channel to receive approval requests."
- **Error:**
  - Route 4xx/5xx → toast (auto-dismiss 5s) + retry button on tables.
  - Persistent failure (3 retries fail) → page-level banner with support link.
  - OAuth callback failure → friendly message + restart-flow button.
- **Permission-denied:**
  - User without `spend_approver` lands on Spend Ledger → see a read-only view (no Approve/Deny buttons; no kill switch surface; no policy edit).
  - User without admin → no nav entry for Spending Budgets create/edit; existing budgets visible read-only if user has `spend_approver`.

### 8.3 Empty-allowlist banner (high-priority UX)

The conservative defaults set `merchant_allowlist: []` — empty. Without copy guiding the operator, an empty allowlist reads as "system broken" rather than "system safely locked." The Empty-Allowlist Banner (Chunk 14) is high-priority UX and persists until the allowlist has at least one entry. Copy is locked at the spec level (§14):

> Empty allowlist — every charge will block. Click 'Load conservative defaults' to populate working values, or add merchants manually.

### 8.4 Permission gating

Every nav entry and every mutation button is gated on `/api/my-permissions` (or `/api/subaccounts/:id/my-permissions` for sub-account scope). Standard pattern from `architecture.md` Architecture Rules § Client. Specific permission keys consumed:

| UI control | Permission gate |
|---|---|
| Nav: Spending Budgets | `spend_approver` (read) or `admin` (full) |
| Nav: Spend Ledger | `spend_approver` |
| Create/Edit budget | `admin` |
| Promote to live | `spend_approver` (initiates HITL action; requires `spend_approver` to approve) |
| Kill Switch (per-policy / per-subaccount / per-org) | `admin` for the relevant scope |
| Approval channel CRUD (subaccount) | sub-account admin |
| Approval channel CRUD (org) | org admin |
| Grant management | org admin |
| SPT onboarding | admin for the relevant scope |

### 8.5 Real-time update requirements

WebSocket rooms reused (no new room kinds):

- **Subaccount room (`subaccount:{id}`)** — receives `agent_charges` insert/update events for charges scoped to that sub-account. Spend Ledger and Pending Approval Card subscribe.
- **Org room (`org:{id}`, if it exists; otherwise per-subaccount fan-out)** — for org-level budget changes.

Backstop polling: 15s when connected; 5s when disconnected. Standard Automation OS pattern.

### 8.6 Retry grouping (Chunk 14 specific)

The Spend Ledger groups rows by `intent_id` so an operator looking for "did this spend ever succeed?" reads the parent row (most recent attempt's status + count). Operators auditing retries expand the group. Default-collapsed; toggle to disable grouping for flat audit. The grouping pure helper lives in `client/src/components/spend/RetryGroupingPure.ts` and is unit-tested.

### 8.7 Cross-currency display

V1 ships per-budget single-currency display only. Each budget's amounts render in its own currency. Cross-currency aggregation is deferred (spec §20). The Spend Ledger page header shows "Charges in <currency>" and the table values use ISO-aware formatting.

### 8.8 Accessibility and keyboard

Standard patterns from existing surfaces (e.g. `LiveDataPicker`'s ↑/↓/Enter/Esc keyboard nav). Approve/Deny buttons must be reachable via Tab; retry-grouping expand/collapse via Enter or Space.

---

## 9. Risks and Mitigations

### 9.1 Rollout friction around the Compute Budget rename (Chunk 1)

**Risk.** The rename touches schema, services, types, events, and UI strings. A missed reference (e.g. an event-name string that lives in a worker file or a migration comment) leaves the codebase in a half-renamed state where both `Budget` and `Compute Budget` appear — exactly the ambiguity the rename exists to remove.

**Mitigation.**
- Pre-rename grep — run `grep -rn "\bBudget\b" server/ client/ shared/ worker/ migrations/` and triage every match into "rename / keep (because qualified) / dead code." Build a checklist before opening the PR.
- Post-rename grep — same grep should return only the qualified `Compute Budget` and `Spending Budget` (the latter exists from Chunk 2 onwards but Chunk 1 PR is rebased onto Chunk 1 only, so `Spending Budget` should be zero).
- Reviewer checklist explicitly asks: "After this PR, is there any `\bBudget\b` not qualified by 'Compute' or 'Spending'?" If yes → re-do.
- The merge gate is hard — Chunk 2 cannot open a PR until Chunk 1 merges. Builders enforce this manually via `tasks/current-focus.md`.

### 9.2 Shadow-to-live promotion gating

**Risk.** A legacy shadow charge has `mode = 'shadow'` and was approved under the shadow policy. After a promote-to-live, future identical-intent charges create new rows with `mode = 'live'` and new idempotency keys. If a builder erroneously thinks "shadow promotion should retroactively re-issue past charges as live," the design contract breaks (the spec is explicit: past shadow rows remain `shadow_settled`; only future charges use live mode).

**Mitigation.**
- The idempotency-key shape encodes mode as a prefix (`charge:live:` vs `charge:shadow:`) — past shadow keys cannot collide with future live keys (spec §9.1).
- `shadow_settled` is truly-terminal — the trigger rejects any update to it.
- Reviewer checklist for Chunk 15: confirm `promoteToLive` does NOT iterate past charges; it only flips `spending_policies.mode` and increments `version`.

### 9.3 SPT revocation race

**Risk.** A user revokes the SPT (per-sub-account or per-org kill switch) between the propose-time gate (which read `connectionStatus = 'active'`) and the execute-time call (which would read `connectionStatus = 'revoked'`). Without the execute-time double-check, the Stripe call would fire against a token whose owner has just revoked authorisation.

**Mitigation.**
- Spec §15 + invariant 7 require the double-check. Chunk 5's `executeApproved` re-reads `spending_budgets.disabled_at` AND the SPT's `connectionStatus` immediately before the Stripe call OR before sending the `agent-spend-response` payload to the worker.
- Late-firing kill switch produces `approved → blocked` with `failure_reason = 'kill_switch_late'`; no `executed` row written; no SPT exposed to the worker.
- Chunk 5 acceptance criterion explicitly requires the re-check; reviewer verifies.
- Worker-path SPT exposure: the worker drops the SPT variable post-call (operational discipline per invariant 3); v1 accepts the residual risk; future hardening (server-minted single-use chargeToken) deferred per spec §20.

### 9.4 pg-boss roundtrip timeout (worker → main app)

**Risk.** A worker emits `agent-spend-request` and the main-app handler crashes mid-process — the immediate response never arrives. The worker times out at 30s and abandons; the orphaned row sits in the ledger.

**Mitigation.**
- The execution-window timeout job (Chunk 5) reconciles orphaned rows to `failed` with `reason = 'roundtrip_timeout'` once `expires_at` passes. The worker MUST NOT write to `agent_charges` (invariant 1 — main app reserves all ledger writes).
- The 30-second deadline is the IMMEDIATE-response deadline only; HITL approval and merchant form-fill latency are uncoupled.
- If Stripe later webhooks `succeeded` for the `provider_charge_id` the worker had submitted before crashing, the `failed → succeeded` post-terminal override applies (§4 carve-out). Stripe's idempotency-key header ensures the worker's pre-crash charge is collapsed to a single outcome at Stripe.

### 9.5 `cost_aggregates` retrofit ordering

**Risk.** The `cost_aggregates` retrofit migration (`organisation_id NOT NULL` + canonical RLS policy) ships in Chunk 2 alongside the new tables. If the backfill runs slowly on a large existing aggregate table, the migration could time out before completing the backfill, leaving the column in an inconsistent state.

**Mitigation.**
- The backfill runs INSIDE the migration before the `NOT NULL` constraint is applied. Implementer chooses a chunked backfill if the table is large (>1M rows on the target environment) — chunk size tunable. Migration header documents the chunk size and the row count cap.
- Backfill failure (a row whose `entityType` doesn't resolve to an `organisation_id`) → migration aborts with structured error. Reverse via the down file. Implementer inspects the offending rows out of band before re-running.
- `entityType` values that have NO per-tenant scope (`platform`, `provider`) need explicit handling — either a sentinel `organisation_id` or a partial RLS policy that excludes them. Decision left to the implementer (architect would have framed the choice; implementer picks).
- Reviewer checklist for Chunk 2: confirm every row has `organisation_id IS NOT NULL` post-migration; confirm RLS policy doesn't break existing read paths (`cost_aggregates` is read by admin P&L surfaces — see `systemPnlService.ts`).

### 9.6 Trigger drift between application and DB layers

**Risk.** The `agent_charges` state-machine guard exists in TWO places: `shared/stateMachineGuards.ts::assertValidAgentChargeTransition` (application) and the `agent_charges_validate_update` trigger (DB). If they drift, an application UPDATE that the app guard accepts may be rejected by the DB trigger (or vice-versa, though the DB trigger is the stricter belt-and-braces layer).

**Mitigation.**
- Both must mirror the spec §4 transitions table EXACTLY. Pure tests in `shared/__tests__/stateMachineGuardsPure.test.ts` exercise every transition.
- Reviewer checklist for any future PR touching either: confirm both layers were updated together, with the same transition set.
- If a future build needs to add a state, BOTH layers update in the same PR. The migration adds the new state to the trigger's CASE; the application guard adds it to the closed enum.

### 9.7 Webhook precedence ambiguity on the worker_hosted_form path

**Risk.** Two writers race for the same `executed` row: Stripe's webhook (authoritative) and the worker's `agent-spend-completion` message. If both arrive within milliseconds, an application-level read-then-write would have a race window.

**Mitigation.**
- Invariant 20 + §10 invariant 22: the trigger enforces monotonicity; the application layer relies on this rather than double-checking.
- The `agent-spend-completion` handler attempts the UPDATE and catches the trigger rejection — logs `worker_completion_after_terminal` and drops silently. No error to the worker.
- Reviewer checklist for Chunk 11: confirm the handler does NOT pre-read state; it attempts the UPDATE and handles rejection. A pre-read pattern reintroduces the race window.

### 9.8 Cross-tenant SPT or webhook spoofing

**Risk.** A webhook with a valid signature for connection A but carrying a `provider_charge_id` that belongs to connection B's tenant would, without the second binding, allow cross-tenant transitions.

**Mitigation.**
- Two bindings per spec §7.5:
  1. Webhook signature against per-connection `webhookSecret` (connection-level integrity).
  2. `provider_charge_id` match against `agent_charges` row in the connection's resolved tenant (row-level integrity).
- On lookup failure (no row in tenant) OR ID mismatch (row found but wrong org/subaccount) → `reconciliation_mismatch` critical alert + block.
- Adversarial-reviewer checklist: walk the webhook route. Confirm both bindings; confirm tenant context comes from the verified connection row, not from the webhook payload.

### 9.9 Telemetry cascades from `agent_execution_events`

**Risk.** Every charge attempt emits one cross-reference event on `agent_execution_events`. Bursts of denied charges (e.g. a misconfigured agent trying many merchants) could spike the events table and trigger the `run.event_limit_reached` cap (`AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN`).

**Mitigation.**
- Spend cross-reference is a single `skill.completed`-class event per attempt — same event volume as any other skill call. Burst rates that exceed the per-run cap are already a problem for the agent (the agent is misbehaving); the existing cap logic catches them.
- No special handling required; spec defers any spend-specific event-volume tuning.

### 9.10a Lock contention under same-budget high-frequency agents

**Risk.** A future PR "optimises" by bundling the propose-gate-execute sequence into a single `withOrgTx` block, putting the Stripe API call inside the advisory-lock-held transaction. Under low-traffic test conditions this looks fine. Under production traffic where multiple agents on the same budget contend for the lock, every transaction now stalls on Stripe latency (300-800ms typical, 5-30s worst-case under Stripe degradation), and same-budget throughput collapses from "thousands per second" to "tens per second."

**Mitigation.**
- Invariant 35 (external calls outside advisory-lock scope) makes this an explicit rule, not implicit pattern recognition. The reviewer checklist says: walk every `withOrgTx` block in `chargeRouterService` and confirm no `await stripeAdapter.*`, `await pgBoss.send`, `await fetch(...)`, or any other I/O sits between BEGIN and COMMIT.
- Chunk 5's sequence diagram explicitly labels step 5 (`executeApproved`) as "runs OUTSIDE any DB transaction; advisory lock NOT held."
- Invariant 39 / `spendAlertConfig.ts` includes `advisoryLockWaitMs > 1000` as a warning trigger — surfaces lock-contention regressions before they become production incidents.

### 9.10b Dispute path remains a same-row mutation (deferred design simplification)

**Risk.** Invariant 41 locks operator-initiated refunds as append-only (new `inbound_refund` row, parent stays `succeeded`). The dispute-loss path (`succeeded → disputed → refunded` on the original row) is preserved for v1 because Stripe's chargeback model targets the original charge object directly. A future spec revision could reframe dispute-loss as an `inbound_chargeback` row with the parent staying `succeeded`, eliminating the last same-row terminal mutation. Until then, the canonical-terminal-state table retains the mutation path, and Chunk 13's aggregator branches on direction (outbound `succeeded → refunded` subtracts via the same-row path; inbound-refund subtracts via the new-row path).

**Mitigation.**
- The trigger and `assertValidAgentChargeTransition` already enforce monotonicity on the same-row dispute path; concurrent dispute events cannot regress the row.
- Invariant 33 (terminal precedence) ensures late-arriving dispute events on already-refunded rows drop silently rather than re-applying.
- If the operator workload exhibits significant dispute-loss volume, revisit the spec to unify under the append-only model.

### 9.10 Load-bearing assumptions to monitor in production

- `EXECUTION_TIMEOUT_MINUTES = 30` works for every spend-skill latency profile. Spec §20 lists per-skill timeout overrides as a deferred enhancement; the trigger to revisit is "specific v1 skill produces evidence that 30 min is too short."
- `approval_expires_hours = 24` works for HITL responsiveness. If approvals routinely expire at the boundary, the value might be too low.
- `webhookDedupeStore` retention period covers the realistic Stripe retry window (Stripe retries failed deliveries for up to 3 days). If the dedupe TTL is shorter, duplicate processing becomes possible. Reviewer checklist for Chunk 12: confirm the dedupe store TTL is at least 3 days.
- The conservative-defaults template (per_txn=$20, daily=$100, monthly=$500) is a starting point only. Operators MUST tune these for real workloads; the empty-allowlist banner is the forcing function.

---

## 10. Executor Notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- The plan is structured for sequential implementation with two parallelisation windows (Chunks 4↔5, Chunks 13↔14). Single-builder wall-clock estimate is 4 weeks; with parallelism on those windows, 2.5–3 weeks. The Chunk 1 merge gate is hard — Chunk 2 cannot open until Chunk 1 merges.
- The spec is the source of truth for every architectural decision. When this plan's wording conflicts with the spec, the spec wins. Specifically, the spec's §10 invariants and §4 canonical terminal-state reference are the load-bearing rule sets; the Invariants Block in this plan mirrors them and any divergence between the two is a bug in the plan, not a license to deviate from the spec.
- After each chunk's implementation, run the chunk's listed verification commands locally (lint, typecheck, build:server / build:client where relevant, and the targeted unit test files). CI runs the full gate battery on PR open — that is where regressions across the codebase get caught. Do not pre-empt CI's job locally.
- Pre-existing violations to fix in Chunk 1: `server/services/budgetService.ts` does not have a `*Pure.ts` companion despite carrying non-trivial decision logic. Chunk 1 must extract `computeBudgetServicePure.ts` as part of the rename. See §3.6.
- `app.spend_caller` is a NEW Postgres GUC (set via `SET LOCAL` inside `withOrgTx`) used by the `agent_charges` trigger to gate three special cases: the `failed → succeeded` post-terminal carve-out (caller must be `'stripeAgentWebhookService'`); the `executed`-row `provider_charge_id` non-status update (caller must be `'worker_completion'` or `'stripe_webhook'`); the retention purge (caller must be `'retention_purge'`). Chunk 2 declares this in the migration header and updates `architecture.md §1560` in the same commit.
- `CHARGE_KEY_VERSION` lives in `server/config/spendConstants.ts` (initial `'v1'`); it MUST satisfy `/^v\d+$/` at module load. Any change to the idempotency key shape must bump the version in the same commit (mirror of `IDEMPOTENCY_KEY_VERSION` rule from `architecture.md` line 3001).
- `KNOWLEDGE.md` entries to inherit:
  - Webhook event dedupe row MUST commit AFTER side effects, not before (KNOWLEDGE.md 2026-05-03). Apply to `webhookDedupeStore` usage in Chunk 12.
  - Side-effect after the decision-row commit, only on the winner code path (KNOWLEDGE.md, multiple entries). Apply to `chargeRouterService.resolveApproval` in Chunk 5 — do not fire `agentSpendAggregateService.upsertAgentSpend` from the losing approval response.
  - Suppression-is-success pattern (KNOWLEDGE.md 1075). Apply to `agent-spend-completion` handler when the worker loses the precedence race against the webhook — return success with `{ suppressed: true, reason: 'worker_completion_after_terminal' }`, not failure.
- Plan-level docs to update in the same commits as their corresponding chunks (per CLAUDE.md §11 doc-sync rule):
  - Chunk 1 → `architecture.md` Compute Budget references; `docs/capabilities.md` if any capability metadata mentions Budget unqualified.
  - Chunk 2 → `architecture.md` § Row-Level Security canonical session variables (add `app.spend_caller` mention); `architecture.md` § Migrations recent-migrations list.
  - Chunk 3 → `architecture.md` integration-providers section (add `'stripe_agent'`).
  - Chunk 5 → `architecture.md` "Key files per domain" table (new "Modify the charge router" entry); `architecture.md` Architecture Rules § Server (charge router rule).
  - Chunk 6 → `docs/capabilities.md` (add the five new spend skills); `architecture.md` skill-system section.
  - Chunk 12 → `architecture.md` webhook routes section.
  - Chunk 13 → `architecture.md` "Key files per domain" table (Spending Budget routes).
  - Chunk 14 → `client/src/lib/formatMoney.ts` (if exponent-aware rendering is added); `architecture.md` Client Patterns.
- This plan does NOT include a Phase 0 baseline run, a Programme-end gate sweep, or any dressed-up gate run. CI runs the complete suite as a pre-merge gate. Stay disciplined: lint + typecheck + build + targeted tests authored in the chunk, nothing more.
