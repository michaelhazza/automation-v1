# Agentic Commerce — development brief (v3)

**Status:** Structural precision pass complete — ready for spec-coordinator (use with addendum v3)
**Owner:** TBD
**Source branch:** claude/stripe-agent-payments-9Og9n (recommend renaming to claude/agentic-commerce-spending)
**Suggested build slug:** agentic-commerce
**Classification:** Major task

**Changes from v1:** Phase 1 and Phase 2 collapsed into a single build. Shadow mode promoted to a day-one deliverable. Codebase exploration section added (Section 8) for Claude Code to resolve before spec freezes. Three product decisions resolved (Section 7). Failure modes, kill-switch surface, and cost-attribution model added.

**Changes from v2:** Applied vocabulary lock (Spending Budget, Spending Policy, Charge Router, Spend Ledger, Kill Switch) per addendum Section B. Added core domain model and charge lifecycle state machine to Section 2. Tightened shadow-mode execution semantics, kill-switch in-flight behaviour, failure-mode rules, and source-of-truth split. Added Section 10: system invariants, execution contract, and integration boundaries. Flagged net-new subsystems in Section 8. The addendum (v3) remains the authoritative resolution document for all stakeholder-decided questions; this brief is updated to be structurally precise enough for spec-coordinator to translate without inventing structure.

This is a brief, not a spec. It frames the problem, the unlock, what it enables in human terms, and the constraints. The spec is written after this brief is approved and after Claude Code completes the codebase exploration in Section 8.

---

## 1. Why this exists

Until 2026 Q2, AI agents could plan, draft, and execute every step of an operator workflow up to one boundary: the moment money changes hands. Buying a domain, paying for an API, settling an invoice, renewing a license. All required a human in the loop.

Stripe's 2026 keynote (Agentic Commerce Suite, Agent Toolkit, Shared Payment Tokens, Stripe MCP server, Machine Payments Protocol) closes that gap. Agents can now hold scoped spending authority, transact against pre-authorised merchants, and produce a complete audit trail without ever touching raw card credentials.

In Automation OS today:

`server/adapters/stripeAdapter.ts` only supports `create_checkout` and `get_payment_status`. That is the pre-agent model: the agent hands a checkout URL to a human, who completes the payment.

`docs/capabilities.md` registers Stripe purely as a data connector. Read-only ingestion of payment and subscription data.

Skills like `chase_overdue` and `send_invoice` talk about money but never move money.

We already ship the primitives that the agentic commerce model needs: org and sub-account-scoped integration connections with encrypted secrets (`integrationConnections`), an approval and HITL queue (`hitlService`, `briefApprovalService`), a curated MCP server catalogue (`mcpPresets.ts`), a cost-aggregation surface (`costAggregateService`), and the three-tier agent model with scoped permissions.

We are one structural addition away from agents that can actually transact. This brief proposes that addition as a single build.

---

## 2. What we are building

A single primitive that gives agents real spending authority, with policy enforcement, shadow-mode validation, full audit, and one-tap revocation. Built on Stripe Shared Payment Tokens (SPT), the Stripe Agent Toolkit, and the Stripe MCP server.

The primitive has six parts:

**Spending Budget.** The operator-facing umbrella concept. Attached to an agent (primary) with an optional sub-account override. Contains a Spending Policy — the rules object holding Spending Limits, Merchant Allowlist, Approval Threshold, and Spending Mode. Stored as two related rows (`spending_budgets`, `spending_policies`), versioned, editable via the agent config UI. The Spending Budget is the accounting container; the Spending Policy is the rules object inside it.

**SPT vault.** Per-sub-account store of Stripe-issued Shared Payment Tokens, scoped to the Spending Budget. Tokens never expose card numbers, expire, and are revocable from a single admin screen. Stored in `integrationConnections` with `providerType: 'stripe_agent'`.

**Charge Router.** Server-side service that every spend-enabled skill calls. Lives exclusively in the main app. Enforces the Spending Policy, splits auto-execute from needs-approval, routes over-threshold Charges into the HITL queue, writes a Spend Ledger row per attempt, and respects the Spending Mode. Workers authorise spend via a pg-boss request-reply round-trip — they never call Stripe directly.

**Spend Ledger.** Append-only per-tenant ledger. Every Charge — allowed, denied, executed, failed, or shadow — writes a row. Feeds the existing cost-aggregation surface so operators see agent spend alongside compute cost. Stripe is the financial source of truth for charge state; the Spend Ledger is the system source of truth for agent intent and audit trail. They reconcile via webhook.

**Shadow mode.** Per-policy Spending Mode, default `shadow`, opt-in to `live`. Every charge attempt runs the full policy check, allowlist match, threshold compare, and HITL routing in both modes. At execution: shadow mode writes a `shadow_settled` ledger row instead of calling Stripe, then returns a successful execution result to the caller. The workflow continues as if the charge succeeded; no external side effect is produced. Operators verify the full workflow end-to-end before spending real money. Promotion from shadow to live is per-policy, not global, and is HITL-gated. Shadow-mode executions must produce identical decision paths and workflow outcomes to live mode, differing only in external side effects. Shadow mode is not an approximation — it is the live execution path with the Stripe call replaced by a ledger write. This guarantees that the shadow audit trail is trustworthy evidence for the promotion decision. From the caller's perspective, shadow and live execution return identical response shapes and status semantics — no workflow or skill may branch on whether execution was shadow or live.

**Kill Switch.** Three-level revocation: per-policy, per-sub-account, per-org. Single-screen action, audit-logged, immediately effective. New Charges are blocked from the moment of activation. In-flight Charges already submitted to Stripe resolve normally and are not reversed. Charges pending HITL approval are auto-cancelled. No retries are permitted after the Kill Switch fires.

### Core domain model

Entity relationships, authoritatively:

```
Agent          → SpendingBudget          (optional; one per agent)
SpendingBudget → SpendingPolicy          (one-to-one; contains the rules)
SpendingBudget → Charges                 (one-to-many; every money-movement attempt)
Charge         → ApprovalRequest         (zero or one; fires when over Approval Threshold)
SubAccount     → SPTConnection           (one per sub-account; stored in integrationConnections)
SubAccount     → ApprovalChannels        (owned by subaccount; org may add grant channels)
```

Key distinctions:
- **Spending Budget** is the accounting container (limits, mode, currency, balance tracking).
- **Spending Policy** is the rules object inside it (allowlist, thresholds, gate behaviour).
- **Charge** is the unit of record — every attempt regardless of outcome.
- **Spend Ledger** is the table of all Charges. System source of truth. Distinct from Stripe's payment record.
- **SPTConnection** is the Stripe-issued credential stored as `accessToken` in `integrationConnections` (`providerType: 'stripe_agent'`).

### Charge lifecycle

States and transitions:
- `proposed`: entry state for every charge attempt — Charge Router writes this row first, before any policy evaluation
- `proposed → blocked`: policy denied (terminal — allowlist miss, limit exceeded, Kill Switch active)
- `proposed → pending_approval`: over Approval Threshold, waiting for HITL
- `pending_approval → approved`: operator approved
- `pending_approval → denied`: operator rejected (terminal)
- `proposed → approved`: under threshold, auto-approved
- `approved → executed`: Stripe API call made (live mode)
- `approved → shadow_settled`: no Stripe call, success returned to caller (shadow mode, terminal)
- `executed → succeeded`: Stripe webhook confirms payment
- `executed → failed`: Stripe error, SPT expired, or timeout (terminal)
- `succeeded → refunded`: refund issued (terminal)
- `succeeded → disputed`: chargeback opened

Rules:
- `blocked` and `denied` are terminal. No retry without a new charge attempt.
- `failed` is terminal for the row. The workflow surfaces the failed-but-charged state to HITL; no auto-retry, no auto-refund.
- Status transitions are enforced by append-only DB triggers on `agent_charges` (addendum Section M).
- Stripe webhooks drive the `executed → succeeded/failed/refunded/disputed` transitions post-execution.
- Retried Charges share the same `intent_id` as the original attempt, grouping all attempts under one Spend Intent. See Section 11.1.

### What it does NOT include

Machine Payments Protocol (AI-to-AI commerce). Defer until we have real Phase 1 usage data.

A skills marketplace where one tenant pays another tenant's agent. Interesting but speculative.

Stripe Tempo or Metronome. Orthogonal billing infrastructure, not relevant to operator-facing agent capability.

Customer-facing checkout flows powered by SPT. This build is operator-side spending only.

Multi-currency policy logic beyond a single declared currency per policy.

Tax handling for agent-purchased goods on behalf of clients. Declared single-purchaser-entity model in v1, formal tax routing deferred.

### Effort

3 to 4 weeks across multiple chunks, with shadow mode adding meaningful surface compared to v1's two-phase plan. Major task. Mandatory pipeline: spec-coordinator (after Section 8 exploration completes), architect, chunked build, full review pass (spec-conformance, pr-reviewer, adversarial-reviewer, dual-reviewer if local), finalisation-coordinator.

---

## 3. Why a single build instead of two phases

The v1 brief proposed shipping a Stripe MCP preset first (Phase 1) and then the spending primitive (Phase 2). Reconsidered:

The MCP preset alone is not differentiating. Anyone in the GoHighLevel partner ecosystem can register Stripe's MCP server within a day. Shipping it as a standalone milestone gives us no defensible positioning.

The spending primitive depends on Stripe MCP server and Agent Toolkit anyway. We pull both in as part of the spending build. Splitting the work creates two reviews, two integration-test passes, and two production-readiness gates for what is structurally one capability.

The differentiation in the GoHighLevel agency segment lives entirely in the policy, shadow mode, ledger, and kill-switch surfaces, not in the MCP plumbing. Marketing and onboarding only have a story when those surfaces ship together.

The Stripe MCP preset still ships, just as one of the components inside this build rather than as an isolated milestone.

---

## 4. Human-readable benefits

### For the operator

The agent stops at the cash register pain point disappears for everything inside policy.

A single dashboard shows which agents have spending authority, what their limits are, what they have spent this month, who they paid, and whether they are in shadow or live mode.

Approvals only fire for things the operator actually wants to see. A $4 domain renewal goes through silently. A $400 SaaS subscription pings them in Slack.

Shadow mode lets operators run the agent live for two to four weeks before flipping any agent to actual spending. Every charge that would have happened is recorded with full reasoning. Trust is earned with data, not promised in a sales call.

One-click revocation at three levels (policy, sub-account, org). Pull the SPT and the agent immediately loses spending authority across every skill, no code change required.

### For agents

Skills become verbs again. `pay_invoice` actually pays the invoice. `subscribe_to_service` actually subscribes. `purchase_resource` actually purchases. The intent and the action are the same primitive.

Agents can complete end-to-end workflows that previously broke. Provision a domain, set up DNS, buy the SSL certificate, deploy. Today step 3 needs a human. Tomorrow it does not.

### For the business

Lets us position Automation OS as the first GoHighLevel-ecosystem operator platform with native agentic commerce capability. Not "Stripe-integrated," but "agent-spending-native with governance from day one."

Aligns with the agent-as-employee framing already in the runbook. An employee that can be issued a corporate card with limits, shadow training, and one-tap revocation is a meaningfully different employee.

Per-sub-account spend attribution feeds the white-labeled client ROI dashboard with real cost-of-delivery numbers, addressing one of the strongest moat surfaces from the GoHighLevel pain-point research.

---

## 5. Examples (operator-facing)

**Onboarding chain for a new sub-account.** A new client onboarding involves the agency manually buying a domain, registering A2P 10DLC, purchasing a dedicated IP if volume warrants, setting up Stripe Connect, provisioning Twilio. The Onboarding Agent, with a spending policy of $200 per transaction and an allowlist of Namecheap, Twilio, Stripe, and Mailgun, runs this entire chain in one autonomous pass, with HITL only firing for the dedicated IP purchase if it crosses threshold.

**API top-up.** Scheduled task: keep OpenAI API credits above $100. Agent checks balance, balance is $42, policy allows $200 top-ups to OpenAI, tops up $200, notifies finance Slack channel with receipt.

**Over-threshold purchase with HITL.** Workflow: find and purchase the cheapest acceptable Salesforce license for the new sales hire. Agent identifies tier ($165/mo), over the $100/txn auto-approve threshold, posts to HITL queue with merchant, amount, justification, operator taps approve in Slack, agent executes the purchase, continues onboarding.

**Compliance-driven spend.** When the Compliance Messaging Agent detects a sub-account approaching Mailgun's complaint-rate threshold, it purchases additional warm-up capacity, registers a fresh sending domain, or buys a dedicated IP. All inside policy.

**Churn intervention with budget.** Portfolio Health Agent detects a sub-account with logins down 60% week-over-week. Authorises a $50 retention gift inside an allowlist, schedules a check-in call, queues the gift for HITL approval with full context including usage data and last positive interaction.

**Refund issued by the agent that took the payment.** Customer writes in: I was double-charged. Agent looks up charge, confirms duplicate, refunds via SPT (within refund policy), emails customer the confirmation, logs the refund in the ledger and the support thread.

**End-to-end thank-you gift.** Operator: send Acme's CEO a $50 thank-you gift, their birthday is Friday. Agent checks gifting policy, picks a gift inside allowlist, enters Acme CEO's address from CRM, places the order via SPT, confirms ETA, drops a line in the CRM activity feed.

**Two weeks of shadow mode before going live.** Operator enables the Onboarding Agent's spending policy in shadow mode. Over two weeks, the agent runs 14 onboarding chains, each producing a full audit trail of what it would have spent ($1,847 total across 14 clients, 0 over-threshold, 3 declined for allowlist mismatch). Operator reviews, adjusts the allowlist, flips to live.

---

## 6. Constraints and risks

**Tenant isolation.** SPT credentials are tenant-scoped. A bug that lets one tenant's agent use another tenant's SPT is a critical incident. Spec must call out RLS coverage explicitly.

**Audit non-negotiable.** Every charge attempt (allowed, denied, approved, executed, failed, shadow) writes to the ledger. No code path may charge without a ledger row. Adversarial-reviewer pass should validate this.

**Webhook reconciliation.** Two sources of truth with different authorities. Stripe is the financial source of truth: Stripe's webhook stream is authoritative for whether money actually moved and for the final payment state of a Charge. The Spend Ledger is the system source of truth: it is authoritative for agent intent, policy decisions, and audit history, and records every attempt regardless of Stripe outcome. Reconciliation flows one way — Stripe outcome updates ledger charge status; the ledger's intent record is immutable. Divergence between optimistic ledger state and webhook outcome triggers an alert. Stripe webhook outcomes always override non-terminal or ambiguous ledger states — if a webhook arrives for a Charge the ledger considers `failed` (e.g., via timeout path), Stripe's determination takes precedence and the ledger is updated accordingly.

**Idempotency.** Every Charge Router call carries an idempotency key. A key derived only from `(skillRunId, intent)` is insufficient for multi-charge skill runs. The locked key shape includes `skillRunId`, `toolCallId`, `intent`, and an args hash; see addendum Section K for the full shape. A retried skill run must not double-charge. Enforced at DB level via UNIQUE constraint on `agent_charges`.

**Don't double-count with existing data ingestion.** The existing Stripe data connector ingests charges for analytics. The new ledger is the authoritative record of agent-initiated charges. The data connector continues for everything else. Reporting needs a clear story for which view shows what.

**Rate limits.** Stripe's per-account rate limits apply to SPT operations. Per-tenant queueing if we approach limits during high-volume workflows.

**Failure-mode semantics.** Three explicit rules:
- Charge success is optimistic at execution time. The Charge Router writes `executed` and returns success to the caller; Stripe webhook confirmation is required to settle `executed → succeeded`. Divergence between optimistic state and webhook outcome triggers reconciliation.
- Reconciliation may mutate charge status post-execution. This is expected; the ledger reflects Stripe's final state.
- When a workflow fails after a successful charge, the system surfaces the failed-but-charged state to HITL with three options: refund, manually retry the failed steps, or accept partial state. No automatic refund-on-rollback in v1 — automatic refunds introduce their own failure modes (refund fails, double-charge on retry, partial-refund acceptance).

**Kill Switch edge cases.** Kill Switch blocks new Charges immediately. In-flight Charges (already submitted to Stripe, awaiting webhook) resolve normally and are not reversed. Charges in `pending_approval` state at the moment the Kill Switch fires are auto-cancelled. No retries are permitted post-kill. Every Kill Switch event is audit-logged with the triggered-by user, timestamp, and scope.

**Alert severity.** Critical: reconciliation mismatch, cross-tenant SPT access attempt, ledger inconsistency. Warning: webhook delay beyond 30 minutes, Charge in `executed` pending confirmation beyond 1 hour. Informational: Kill Switch activation (audit event; not page-worthy on its own). This distinction must inform observability design from the start to avoid alert fatigue.

**Operator trust runway.** Shadow mode is mandatory v1, defaulted on, and the only path from shadow to live is itself a HITL-gated action with audit. Without this, adoption stalls regardless of how good the technical implementation is.

---

## 7. Resolved product decisions

These were open questions in v1, now resolved.

**Policy default.** New agents have no Spending Budget by default. Spending is opt-in per agent, per Spending Budget, with shadow Spending Mode mandatory before live mode is allowed. Conservative defaults (e.g. $20/txn, $100/day) appear as templates the operator can apply, not as automatic inheritance.

**Org vs. sub-account SPT.** One SPT per sub-account. Cleaner isolation, cleaner cost attribution per the GoHighLevel research finding that agencies are hyper-sensitive to per-sub-account margin transparency. Slightly higher setup cost is recouped immediately on the reporting side.

**Approval routing.** Reuse the existing HITL queue. Faster to ship, consistent operator mental model, and the queue is already the right governance surface. Approval surface gets a `category: 'spend'` filter for operators who want a focused view.

**Portfolio Health budget model.** Spending Budget attaches to the agent first, with an optional sub-account override. Portfolio Health Agent gets a Spending Budget at the org level with a Spending Policy allowing retention gifts (e.g. $50/gift, $500/month, Merchant Allowlist of Goldbelly + Harry & David) but each gift Charge attributes to the recipient sub-account in the Spend Ledger. This solves the cross-sub-account spending need without breaking the per-sub-account isolation principle.

**Sales Autopilot Playbook v1.** Sales Autopilot Playbook does NOT get spending capability in v1. Twilio costs continue to flow through the existing agency-billed model. Adding spending to Sales Autopilot is a follow-up after this build ships, because the Sales Autopilot is itself in active development and adding two moving parts at once is unwise.

**Failure-mode handling.** Manual HITL resolution in v1. Auto-refund on workflow rollback is a follow-up.

**Shadow-to-live promotion.** A HITL-gated action. The operator clicks "promote to live" on the policy, the system creates an approval request, the operator (or a designated approver) confirms, the policy flips. Audit logged.

---

## 8. Codebase exploration required before spec freezes

This section is the explicit handoff to Claude Code. The spec cannot be written until these questions are answered with reference to the actual codebase. Each item produces either a confirmation, a recommended approach, or a flag back for stakeholder decision.

**Net-new subsystems (not extensions).** Three areas this brief initially framed as extensions to existing code are net-new, and must be sized accordingly by the architect:
- Stripe webhook ingestion for charge reconciliation does not exist today. The existing Stripe data connector does not produce a reconcilable webhook stream for agent-initiated charges. This is a new subsystem, not a modification of the existing connector.
- Worker-to-Charge-Router communication requires a new pg-boss request-reply channel. Workers have no charge-routing capability today. All spend initiated from a worker must round-trip through the main app.
- `cost_aggregates` has no RLS policy today. Adding agent-spend dimensions without retrofitting RLS leaks spend data across orgs at the read layer. The retrofit is mandatory before any new dimensions land; it is not optional (resolved in addendum Section L).

**8.1 Skill registry integration.** How does the existing SKILL.md gate model (auto / review / block) interact with spending policies? Options to evaluate: (a) new gate type `spend` that triggers policy check, (b) spend as an orthogonal dimension on every gate type, (c) policy check happens inside the skill executor regardless of gate. Recommend an approach with reference to the existing skill executor surface.

**8.2 IEE worker integration.** Does the charge router live exclusively in the main Replit app, or does the IEE need a worker variant? Specifically: when a `browser_task` is performing a vendor checkout that is not Stripe-MCP-supported, does the IEE worker call back to the main app to authorise the charge, or does it have its own scoped charge-routing capability? Map both paths and recommend.

**8.3 Playbook engine integration.** Spending steps in playbooks. Options to evaluate: (a) new step type `spend` that wraps a charge, (b) any existing skill step can spend if the underlying skill is spend-enabled, (c) hybrid. Reference the existing TypeBox step output schemas and recommend.

**8.4 Per-tenant secret storage for SPT.** Confirm whether the existing `integrationConnections` encryption-at-rest scheme supports the SPT lifecycle (rotation, expiry, revocation) without modification. If not, document what is needed.

**8.5 Stripe webhook ingestion architecture.** The existing Stripe data connector ingests charges for analytics. The new charge router needs webhook visibility for reconciliation. Options to evaluate: (a) modify the existing Stripe webhook handler to flag agent-initiated charges, (b) charge router subscribes to its own webhook stream, (c) shared webhook handler with internal routing. Recommend, with reference to whichever module currently owns Stripe webhook ingestion.

**8.6 Cost-aggregation surface integration.** Confirm `costAggregateService` can accept agent spend as a new cost dimension without folding it into existing LLM cost rollups. If schema changes are needed, document.

**8.7 HITL queue category support.** Confirm the existing `hitlService` and `briefApprovalService` support a `category: 'spend'` filter or tag, and that the HITL UI can render spend-specific approval cards (merchant, amount, justification, one-tap approve/deny). If not, document the gap.

**8.8 RLS coverage audit.** Identify every table that will gain a tenant-scoped spend-related column or row (`spending_policies`, `agent_charges`, plus any modifications to existing tables) and confirm the RLS pattern used elsewhere in the codebase applies cleanly. Flag any deviation.

**8.9 Idempotency-key conventions.** Identify how the existing skill executor and pg-boss job system handle idempotency keys today. Confirm that `(skillRunId, intent)` as an idempotency key for chargeRouter aligns with existing conventions or document the divergence.

**8.10 Existing skills that mention money.** Audit the skill registry for any existing skill that references payments, invoices, refunds, or subscriptions. List them. For each, recommend whether v1 retrofits the skill to use the new spending primitive, or whether the skill is left unchanged and a new v2 of the skill ships alongside.

**8.11 Adaptive Intelligence Routing impact.** Does the planning / execution / synthesis tier model need any awareness of spending? Specifically: should the planning phase include a spend-policy check before producing a plan that the execution phase cannot afford? Recommend.

**8.12 Audit log cross-reference.** The existing audit log surface (the one referenced as "effectively useless" in the GoHighLevel research as a cautionary tale, not a model). Confirm that the spend ledger does not become a second silo, and recommend whether the spend ledger should join the workspace memory observability layer or remain independent.

**8.13 Branch and migration audit.** Current branch is `claude/stripe-agent-payments-9Og9n`. Confirm what is on the branch already vs. main. List any uncommitted or in-progress code that this build needs to either incorporate or supersede.

**8.14 Anything else worth flagging.** The above is what the brief author could anticipate from outside the codebase. There will be things that only become visible once Claude Code has touched the relevant files. Flag any additional integration points, naming conflicts, or architectural assumptions that need stakeholder input.

---

## 9. Out of scope (explicitly deferred)

Machine Payments Protocol (MPP) and AI-to-AI commerce.

Stripe Tempo, Metronome, and any usage-based billing infrastructure for our customers.

Customer-facing SPT issuance (e.g. issuing payment tokens to an end-customer's chatbot).

A skills marketplace with revenue share.

Multi-currency policy logic beyond a single declared currency per policy.

VAT and tax routing for agent-purchased goods on behalf of clients. Declared single-purchaser-entity model in v1.

Auto-refund on workflow rollback.

Sales Autopilot Playbook spending capability.

---

## 10. System invariants, execution contract, and boundaries

### 10.1 Non-negotiable invariants

These rules hold in every code path. Violations are blocking issues in adversarial-reviewer and spec-conformance passes.

- **Ledger row before charge.** The Charge Router writes a `proposed` Spend Ledger row before contacting Stripe. No code path reaches Stripe without a ledger row already written.
- **Policy check before execution.** No spend-enabled skill calls Stripe directly. All execution flows through the Charge Router.
- **Worker never charges directly.** IEE workers carry no SPT credentials. All spend is authorised by the main app via the pg-boss round-trip (addendum Section D).
- **Idempotency at DB level.** `agent_charges` has a UNIQUE constraint on the idempotency key. Duplicates resolve via `INSERT ... ON CONFLICT DO UPDATE`, not application-layer deduplication.
- **Tenant isolation.** RLS policies protect `spending_budgets`, `spending_policies`, and `agent_charges`. Cross-tenant SPT access is a critical incident.
- **Shadow charges write to the real ledger.** Shadow mode does not skip the Spend Ledger. Every shadow attempt gets a full `shadow_settled` row with policy decision, Merchant Allowlist result, and Charge Intent recorded.
- **Kill Switch is synchronous.** A fired Kill Switch blocks new Charges immediately. In-flight Charges resolve normally; pending-approval Charges auto-cancel; no retries are permitted.
- **`cost_aggregates` RLS before new dimensions.** The RLS retrofit on `cost_aggregates` ships in the same migration as the first new entityType values. No spend data lands in the table without RLS protection.
- **No silent drops.** Every proposed Charge must reach a terminal state or an explicit intermediate state (`pending_approval`, `executed`). No Charge attempt may be silently dropped. Terminal states: `blocked`, `denied`, `failed`, `shadow_settled`, `succeeded`, `refunded`, `disputed`. Non-terminal Charges (`pending_approval`, `executed`) still hold their reserved amount against limits.
- **Blocked vs denied.** Blocked = system-enforced denial (policy, limits, Kill Switch). Denied = human rejection via HITL. Distinct categories for analytics, debugging, and audit semantics.
- **Execution window.** A Charge in `approved` state must transition to `executed`, `shadow_settled`, or `failed` within a bounded execution window. If the window expires without a transition, the Charge is auto-marked `failed` with reason `execution_timeout`. This prevents permanent reserved-capacity lock and keeps the system self-healing.

### 10.2 Execution contract

Every spend follows the same four-step flow. No spend-enabled skill may implement a different path.

1. **Propose.** Skill calls Charge Router with `{ intent, amountMinor, merchant, idempotencyKey, ... }`. Router writes a `proposed` ledger row.
2. **Gate.** Router evaluates Spending Policy: checks Spending Mode, Spending Limits, Merchant Allowlist, Approval Threshold. Outcome: `approved`, `blocked`, or `pending_approval`.
3. **Execute.** Live mode + approved: call Stripe via SPT, write result. Shadow mode + approved: write `shadow_settled`, return success to caller with no external call. Blocked: write `blocked`, return denial. Pending approval: write `pending_approval`, enqueue HITL, suspend workflow.
4. **Settle.** Stripe webhook arrives. Reconciliation job transitions `executed → succeeded`, `executed → failed`, `succeeded → refunded`, or `succeeded → disputed`.

### 10.3 Integration boundaries

- **Main app vs worker.** The Charge Router lives exclusively in the main app. Workers access it via pg-boss request-reply with a 30-second deadline (addendum Section D). RLS context is established at the main-app boundary.
- **Spending Policy vs Charge Router.** The Spending Policy holds the rules. The Charge Router evaluates them. Policy is a data object; Charge Router is the enforcement service.
- **Stripe vs Spend Ledger.** Stripe is the financial source of truth (payment state). The Spend Ledger is the system source of truth (agent intent, policy decisions, audit trail). Reconciliation updates the ledger from Stripe; it does not update Stripe from the ledger.
- **Workflow engine vs Charge Router.** Spend is a workflow action. The workflow engine calls the Charge Router via the existing action execution path, not a separate path. Spend approval routing follows the same pause-resume mechanics as other HITL actions.

---

## 11. Edge-case semantics

### 11.1 Spend Intent vs Charge

A Spend Intent is the logical operation ("buy domain example.com"). A Charge is a single execution attempt. Multiple Charges may share one Spend Intent — when a Charge fails and is retried, both carry the same `intent_id`. This field lives on `agent_charges` and is the grouping key for retry chains in the UI and analytics. The idempotency key distinguishes individual attempts; `intent_id` groups them under one operation. Retries are explicit actions — a `failed` Charge is terminal; a retry is a new Charge under the same `intent_id`, initiated by either the workflow (if explicitly designed to retry) or an operator action. There are no automatic system retries.

### 11.2 Concurrency and reserved capacity

Spending Limits are enforced against settled Charges plus all in-flight approved Charges. An `approved` or `executed` Charge reserves its amount against the relevant limits until it reaches a terminal state. Two concurrent charges that would individually fit a limit but collectively exceed it — the second is blocked. This prevents race-condition overspend during high-volume runs. Limits are evaluated at the Gate step — before approval routing and before execution.

### 11.3 Approval expiry and policy revalidation

Pending approvals expire after 24 hours by default (configurable per Spending Budget). When an approval is acted on, the Charge Router re-checks the current Spending Policy before executing. If the policy has changed such that the Charge would now be blocked — limit reduced, merchant removed, Kill Switch fired — the Charge is auto-denied with reason `policy_changed`. Approval is a gate, not a blank cheque. Approval resolution is atomic — the first valid response wins; subsequent responses are ignored and recorded as superseded.

### 11.4 Merchant identity

Merchant matching uses Stripe merchant ID as the primary identifier where available. Fallback: normalised string matching against the merchant descriptor. Exact-match semantics in v1. Pattern matching and category grouping are deferred to follow-up builds.

### 11.5 Recurring charges

Every recurring Charge (subscription renewal, scheduled top-up) is evaluated against the current Spending Policy at execution time. Pre-approval does not carry forward across billing cycles. Operators who want low-friction renewals configure permissive limits and allowlists — not pre-approved subscriptions.

### 11.6 Webhook failure

If a Stripe webhook for an `executed` Charge has not arrived within 30 minutes, a reconciliation poll runs against Stripe's API. The Charge remains `executed` until confirmed. If the poll also fails, the Charge stays `executed`, surfaces in the dashboard as "pending confirmation," and an alert fires. Manual reconciliation is the resolution path. Until webhook confirmation, `executed` is treated as pending external confirmation and is not considered settled for limit release or reporting purposes.

### 11.7 Net spend and refunds

Spending Limits are enforced on net spend: settled charges minus refunds. A $50 refund against a $100 daily limit restores $50 of available capacity. Per-transaction limits are point-in-time and are not affected by subsequent refunds.

### 11.8 Ledger immutability

Spend Ledger rows are immutable except for state transitions enforced by the charge lifecycle state machine. No other field mutations are permitted. Enforced by append-only DB triggers (addendum Section M). This rule applies to both executed and shadow rows.

### 11.9 Future extension points (decisions locked, implementation deferred)

- **Spend velocity.** The Spending Policy schema must support an optional rate limit (max N charges per minute or hour). Not built in v1; schema must not preclude it.
- **Confidence gating.** Spending Policy may optionally consider agent confidence score as a gating signal — high confidence auto-executes within limits, low confidence routes to approval even under threshold. Deferred to post-v1; policy schema must not foreclose it.
- **Charge provenance.** `agent_charges` should include an optional `provenance` field (`'workflow' | 'manual' | 'scheduled' | 'retry'`) for later use in analytics, debugging, and fraud detection. Not required for v1 logic; schema must not foreclose it.

---

## 12. Next steps

Stakeholder review of this brief. Approve, amend, or reject.

If approved:

1. Hand the brief plus the Section 8 question list to Claude Code in a fresh session. Claude Code completes the codebase exploration and produces an exploration report.

2. Review the exploration report with the brief author. Resolve any escalated questions.

3. Run spec-coordinator against this brief plus the exploration report. Spec, architect, chunked build, full review pipeline, finalisation. Target the renamed feature branch `claude/agentic-commerce-spending`.

4. Update `docs/capabilities.md` once the build ships to reflect Stripe's expanded role (no longer "data connector only").

5. Update `docs/agent-as-employee-runbook.md` once the build ships to add the spending-policy setup section, including shadow-mode operator runbook.

6. Plan a follow-up for Sales Autopilot Playbook spending integration once this build is stable in production.
