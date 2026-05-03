# Agentic Commerce — development brief (v2)

**Status:** Draft for stakeholder review
**Owner:** TBD
**Source branch:** claude/stripe-agent-payments-9Og9n (recommend renaming to claude/agentic-commerce-spending)
**Suggested build slug:** agentic-commerce
**Classification:** Major task

**Changes from v1:** Phase 1 and Phase 2 collapsed into a single build. Shadow mode promoted to a day-one deliverable. Codebase exploration section added (Section 8) for Claude Code to resolve before spec freezes. Three product decisions resolved (Section 9). Failure modes, kill-switch surface, and cost-attribution model added.

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

**Spending policy.** A structured object attached to an agent or a skill. `{ maxPerTxn, maxPerDay, maxPerMonth, merchantAllowlist, currency, requiresApprovalAbove, mode: 'shadow' | 'live' }`. Stored in the database, versioned, editable via the existing agent config UI.

**SPT vault.** Per-tenant store of Stripe-issued payment tokens, scoped to the policy. Tokens never expose card numbers, expire, and are revocable from a single admin screen. Stored alongside other secrets in `integrationConnections` with a new `providerType` (`stripe_agent`).

**Charge router.** Server-side service every payment-issuing skill calls. Enforces the policy, splits auto-execute from needs-approval, routes over-threshold charges into the existing HITL queue, writes a full audit row per attempt (allowed, denied, approved, executed, failed, shadow), and respects the policy mode (shadow vs. live).

**Spend ledger.** Every authorised charge writes to a per-tenant ledger that feeds the existing cost-aggregation surface so operators see agent spend in the same place they see workflow cost today. Shadow-mode charges write to the same ledger with a `shadow: true` flag.

**Shadow mode.** A per-policy mode flag (default `shadow`, opt-in to `live`). Every charge attempt runs through the full policy check, allowlist match, threshold compare, and HITL routing. At the moment of execution, shadow mode writes a `shadow_charge` ledger row instead of calling Stripe. Operators see the full audit trail of what would have happened. Flipping from shadow to live is per-policy, not global, and is itself a HITL-gated action.

**Kill switches.** Three-level revocation: per-policy (revoke this agent's spending authority), per-sub-account (revoke all agent spending in this sub-account), per-org (global stop). Each is a single-screen action, audit-logged, and immediately effective across every running agent.

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

**Webhook reconciliation.** Stripe's webhook stream remains the source of truth for charge state. Local ledger entries must reconcile against webhooks. Any divergence triggers an alert.

**Idempotency.** Every `chargeRouter` call carries an idempotency key derived from `(skillRunId, intent)`. A retried skill run must not double-charge.

**Don't double-count with existing data ingestion.** The existing Stripe data connector ingests charges for analytics. The new ledger is the authoritative record of agent-initiated charges. The data connector continues for everything else. Reporting needs a clear story for which view shows what.

**Rate limits.** Stripe's per-account rate limits apply to SPT operations. Per-tenant queueing if we approach limits during high-volume workflows.

**Failure-mode semantics.** When a workflow fails after a successful charge, the default is to surface the failed-but-charged state to HITL with three suggested actions: refund, manually retry the failed steps, or accept the partial state. No automatic refund-on-rollback in v1, because automatic refunds create their own failure modes (refund fails, partial refund accepted by Stripe, refund-then-retry charges twice). Document this behaviour explicitly so operators know to expect it.

**Operator trust runway.** Shadow mode is mandatory v1, defaulted on, and the only path from shadow to live is itself a HITL-gated action with audit. Without this, adoption stalls regardless of how good the technical implementation is.

---

## 7. Resolved product decisions

These were open questions in v1, now resolved.

**Policy default.** New agents inherit a zero-spend policy by default. Spending is opt-in per agent, per policy, with shadow mode mandatory before live mode is allowed. Conservative defaults (e.g. $20/txn, $100/day) appear as templates the operator can apply, not as automatic inheritance.

**Org vs. sub-account SPT.** One SPT per sub-account. Cleaner isolation, cleaner cost attribution per the GoHighLevel research finding that agencies are hyper-sensitive to per-sub-account margin transparency. Slightly higher setup cost is recouped immediately on the reporting side.

**Approval routing.** Reuse the existing HITL queue. Faster to ship, consistent operator mental model, and the queue is already the right governance surface. Approval surface gets a `category: 'spend'` filter for operators who want a focused view.

**Portfolio Health budget model.** Spending policy attaches to the agent first, with an optional sub-account override. Portfolio Health Agent gets a global retention-gift policy at the org level (e.g. $50/gift, $500/month, allowlist of Goldbelly + Harry & David) but each gift charge attributes to the recipient sub-account in the ledger. This solves the cross-sub-account spending need without breaking the per-sub-account isolation principle.

**Sales Autopilot Playbook v1.** Sales Autopilot Playbook does NOT get spending capability in v1. Twilio costs continue to flow through the existing agency-billed model. Adding spending to Sales Autopilot is a follow-up after this build ships, because the Sales Autopilot is itself in active development and adding two moving parts at once is unwise.

**Failure-mode handling.** Manual HITL resolution in v1. Auto-refund on workflow rollback is a follow-up.

**Shadow-to-live promotion.** A HITL-gated action. The operator clicks "promote to live" on the policy, the system creates an approval request, the operator (or a designated approver) confirms, the policy flips. Audit logged.

---

## 8. Codebase exploration required before spec freezes

This section is the explicit handoff to Claude Code. The spec cannot be written until these questions are answered with reference to the actual codebase. Each item produces either a confirmation, a recommended approach, or a flag back for stakeholder decision.

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

## 10. Next steps

Stakeholder review of this brief. Approve, amend, or reject.

If approved:

1. Hand the brief plus the Section 8 question list to Claude Code in a fresh session. Claude Code completes the codebase exploration and produces an exploration report.

2. Review the exploration report with the brief author. Resolve any escalated questions.

3. Run spec-coordinator against this brief plus the exploration report. Spec, architect, chunked build, full review pipeline, finalisation. Target the renamed feature branch `claude/agentic-commerce-spending`.

4. Update `docs/capabilities.md` once the build ships to reflect Stripe's expanded role (no longer "data connector only").

5. Update `docs/agent-as-employee-runbook.md` once the build ships to add the spending-policy setup section, including shadow-mode operator runbook.

6. Plan a follow-up for Sales Autopilot Playbook spending integration once this build is stable in production.
