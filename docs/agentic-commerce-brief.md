# Agentic Commerce — development brief

**Status:** Draft for stakeholder review
**Owner:** TBD
**Source branch:** `claude/stripe-agent-payments-9Og9n`
**Suggested build slug:** `agentic-commerce`
**Classification:** Phase 1 = Standard, Phase 2 = Major

This is a brief, not a spec. It frames the problem, the two phased unlocks, what they enable in human terms, and the constraints. Specs are written after this brief is approved.

---

## 1. Why this exists

Until 2026-Q2, AI agents could plan, draft, and execute every step of an operator workflow up to one boundary: the moment money changes hands. Buying a domain, paying for an API, settling an invoice, renewing a license — all required a human in the loop.

Stripe's 2026 keynote (Agentic Commerce Suite, Agent Toolkit, Shared Payment Tokens, Stripe MCP server, Machine Payments Protocol) closes that gap. Agents can now hold scoped spending authority, transact against pre-authorised merchants, and produce a complete audit trail without ever touching raw card credentials.

In Automation OS today:
- `server/adapters/stripeAdapter.ts` only supports `create_checkout` and `get_payment_status`. That is the pre-agent model: the agent hands a checkout URL to a human, who completes the payment.
- `docs/capabilities.md` registers Stripe purely as a **data connector** — read-only ingestion of payment and subscription data.
- Skills like `chase_overdue` and `send_invoice` *talk about* money but never *move* money.
- We already ship the primitives that the agentic commerce model needs: org/subaccount-scoped integration connections with encrypted secrets (`integrationConnections`), an approval/HITL queue (`hitlService`, `briefApprovalService`), a curated MCP server catalogue (`mcpPresets.ts`), a cost-aggregation surface (`costAggregateService`), and the three-tier agent model with scoped permissions.

We are one structural addition away from agents that can actually transact. This brief proposes that addition in two phases, smallest first.

---

## 2. Phase 1 — Stripe MCP server as a preset

### Scope
Register Stripe's official MCP server (`@stripe/mcp-server`) in `server/config/mcpPresets.ts` under the `finance` category, wired to the existing `integrationConnections` flow with a Stripe restricted API key. Per-org or per-subaccount, following the same connection pattern as Slack and HubSpot.

### What changes in code
- One new entry in `MCP_PRESETS` (slug, command, args, credential provider, tool highlights).
- A `credentialProvider` of `stripe_restricted_key`, reusing the existing `api_key` `authType` on `integrationConnections`.
- A short setup-notes block in the preset (operators paste a Stripe restricted key with the right resource scopes).

### What it does NOT include
No spending policy. No Shared Payment Tokens. No automatic charges from agents. Phase 1 only enables agents to **read** Stripe data and execute Stripe actions that are already safe under the operator's existing API-key permissions (e.g. issuing invoices, refunding within key scope, looking up customers).

### Effort
1–2 days, single chunk, Standard task. Direct implementation followed by `pr-reviewer`.

### Human-readable benefits

**For the operator**
- Stripe shows up alongside Gmail, Slack, HubSpot in the integration picker. Click, paste restricted key, done.
- Agents can answer Stripe-shaped questions in real time ("what was Acme's MRR last month?", "how many failed charges this week?") without waiting for the next ingestion cycle.
- No new admin surface to learn — same connection management as every other MCP integration.

**For agents**
- Agents can look up customers, list subscriptions, draft invoices, issue refunds **within the API key's own scope** without needing a custom skill written for each task.
- Reduces the number of bespoke skills we need to maintain — Stripe's MCP server covers most of the ground that `analyse_financials`, `reconcile_transactions`, and parts of `chase_overdue` cover today.

### Examples

**Example A — Real-time financial Q&A**
> Operator: "How much did Acme spend with us in March?"
> Agent (using Stripe MCP): pulls customer ID, sums charges in March, returns answer with link to each charge in Stripe dashboard. Today this requires the operator to either wait for the nightly Stripe sync or open Stripe themselves.

**Example B — Bespoke refund inside policy**
> Operator: "Refund Acme's last charge, they were double-billed."
> Agent: looks up the charge, refunds it, posts a confirmation message in Slack with the Stripe receipt URL.

**Example C — Subscription audit**
> Scheduled task: agent runs every Monday, lists all subscriptions in `past_due` for >7 days, drafts a follow-up email per customer, queues each to HITL.

## 3. Phase 2 — Agent spending primitive (SPT-backed)

### Scope
Give agents the ability to **initiate** payments — not just inside a Stripe key's existing scope, but as authorised economic actors with their own spending authority. Built on Stripe Shared Payment Tokens (SPT) and the Stripe Agent Toolkit.

The primitive has four parts:

1. **Spending policy** — a structured object attached to an agent or a skill: `{ maxPerTxn, maxPerDay, maxPerMonth, merchantAllowlist, currency, requiresApprovalAbove }`. Stored in the database, versioned, editable via the existing agent config UI.
2. **SPT vault** — per-tenant store of Stripe-issued payment tokens, scoped to the policy. Tokens never expose card numbers; they expire; they are revocable from a single admin screen. Stored alongside other secrets in `integrationConnections` with a new `providerType` (e.g. `stripe_agent`).
3. **Charge router** — a server-side service every payment-issuing skill calls. It enforces the policy, splits "auto-execute" from "needs approval," routes over-threshold charges into the existing HITL queue, and writes a full audit row per attempt (allowed / denied / approved / executed / failed).
4. **Spend ledger** — every authorised charge writes to a per-tenant ledger that feeds the existing cost-aggregation surface so operators see agent spend in the same place they see workflow cost today.

### What changes in code (directional, not exhaustive)
- New `spending_policies` table, RLS-scoped per org/subaccount, agent-linked.
- New `agent_charges` ledger table.
- New `providerType: 'stripe_agent'` on `integrationConnections`, with SPT material in `secretsRef`.
- New service `chargeRouterService` enforcing the policy + writing the ledger.
- New skill primitives: `purchase_resource`, `pay_invoice`, `subscribe_to_service`, `top_up_balance` — each a thin shell over `chargeRouterService`.
- HITL templates for "agent spend approval" with merchant, amount, justification, and a one-tap approve/deny.
- Stripe Agent Toolkit + Stripe MCP server wired into the agent execution loop (the Phase 1 preset is the entry point).

### What it does NOT include
- Machine Payments Protocol (AI-to-AI) — defer until we have real Phase 2 usage data.
- A skills marketplace where one tenant pays another tenant's agent — interesting but speculative.
- Stripe Tempo / Metronome — orthogonal billing infrastructure, not relevant to operator-facing agent capability.
- Customer-facing checkout flows powered by SPT — Phase 2 is operator-side spending only.

### Effort
2–3 weeks across multiple chunks. Major task. Mandatory pipeline: `spec-coordinator`, `architect`, chunked build, full review pass (`spec-conformance`, `pr-reviewer`, `adversarial-reviewer`, `dual-reviewer` if local), `finalisation-coordinator`.

### Human-readable benefits

**For the operator**
- The "agent stops at the cash register" pain point disappears for everything inside policy.
- A single dashboard shows: which agents have spending authority, what their limits are, what they've spent this month, who they paid.
- Approvals only fire for things the operator actually wants to see — a $4 domain renewal goes through silently; a $400 SaaS subscription pings them in Slack.
- One-click revocation. Pull the SPT and the agent immediately loses spending authority across every skill, no code change required.

**For agents**
- Skills become "verbs" again. `pay_invoice` actually pays the invoice. `subscribe_to_service` actually subscribes. The intent and the action are the same primitive.
- Agents can complete end-to-end workflows that previously broke: provision a domain, set up DNS, buy the SSL certificate, deploy. Today step 3 needs a human; tomorrow it does not.

**For the business**
- Lets us position Automation OS as the first operator-facing platform with native agentic-commerce capability, not "Stripe-integrated," but **"agent-spending-native."**
- Aligns with the `agent-as-employee` framing already in the runbook: an employee that can be issued a corporate card with limits is a meaningfully different employee.

### Examples

**Example D — Domain purchase inside an onboarding workflow**
> Workflow: "Onboard new customer."
> Agent step 4: "Customer needs a `.com` matching their brand."
> Agent: queries registrar MCP, finds available domain at $12/yr, checks spending policy ($50/txn auto-approve, registrar in allowlist), buys the domain via SPT, records charge in ledger, posts confirmation in workflow output.
> No human involved. The operator sees a single line in the workflow log: "Purchased acme-corp.com from Namecheap, $12.00, ledger ID 4f2e."

**Example E — API top-up**
> Scheduled task: "Keep OpenAI API credits above $100."
> Agent: checks balance, balance is $42, policy allows $200 top-ups to OpenAI, tops up $200, notifies finance Slack channel with receipt.

**Example F — Over-threshold purchase**
> Workflow: "Find and purchase the cheapest acceptable Salesforce license for the new sales hire."
> Agent: identifies tier ($165/mo), over the $100/txn auto-approve threshold, posts to HITL queue with merchant, amount, justification ("New hire Jane Doe needs Salesforce Sales Cloud Pro per onboarding checklist"), operator taps approve in Slack, agent executes the purchase, continues onboarding.

**Example G — Refund issued by the agent that took the payment**
> Customer writes in: "I was double-charged."
> Agent: looks up charge, confirms duplicate, refunds via SPT (within refund policy), emails customer the confirmation, logs the refund in the ledger and the support thread.

**Example H — End-to-end "buy and ship a thank-you gift"**
> Operator: "Send Acme's CEO a $50 thank-you gift, their birthday is Friday."
> Agent: checks gifting policy ($50 cap, allowlist includes Goldbelly + Harry & David), picks a gift, enters Acme CEO's address from CRM, places the order via SPT, confirms ETA, drops a line in the CRM activity feed.

## 4. Constraints and risks (both phases)

- **Tenant isolation.** SPT credentials are tenant-scoped. A bug that lets one tenant's agent use another tenant's SPT is a critical incident. Phase 2's spec must call out RLS coverage explicitly.
- **Audit non-negotiable.** Every charge attempt — allowed, denied, approved, executed, failed — writes to the ledger. No code path may charge without a ledger row. The adversarial-reviewer pass should validate this.
- **Webhook reconciliation.** Stripe's webhook stream remains the source of truth for charge state. Local ledger entries must reconcile against webhooks; any divergence triggers an alert.
- **Idempotency.** Every chargeRouter call carries an idempotency key derived from `(skillRunId, intent)`. A retried skill run must not double-charge.
- **Don't double-count with existing data ingestion.** The existing Stripe data connector ingests charges for analytics. Phase 2's ledger is the authoritative record of *agent-initiated* charges; the data connector continues for everything else. Reporting needs a clear story for which view shows what.
- **Rate limits.** Stripe's per-account rate limits apply to SPT operations. Per-tenant queueing if we approach limits during high-volume workflows.
- **Operator trust runway.** Even with policies and approvals, operators will need a "shadow mode" where the agent simulates the charge without executing. Worth building into Phase 2 from day one.

---

## 5. Out of scope (explicitly deferred)

- Machine Payments Protocol (MPP) and AI-to-AI commerce.
- Stripe Tempo, Metronome, and any usage-based billing infrastructure for *our* customers.
- Customer-facing SPT issuance (e.g. issuing payment tokens to an end-customer's chatbot).
- A skills marketplace with revenue share.
- Multi-currency policy logic beyond a single declared currency per policy.

## 6. Open questions for stakeholder review

1. **Policy scope default.** Should new agents inherit a zero-spend policy by default and require explicit opt-in, or inherit a conservative default (e.g. $20/txn, $100/day, allowlist of safe registrars + cloud providers)?
2. **Org vs subaccount SPT.** Do we issue one SPT per org and let subaccounts share it under sub-policies, or one SPT per subaccount? The latter is cleaner for isolation; the former is cheaper to set up.
3. **Approval routing.** Reuse the existing HITL queue, or build a dedicated "spend approvals" surface? Reuse is faster and consistent; dedicated reduces noise for non-financial reviewers.
4. **Reporting integration.** Does agent spend show up inside the existing cost dashboard as a new cost type, or does it get its own "agent spending" view? (Probably both, but call it.)
5. **Phase 1 standalone value.** If Phase 2 slips, is Phase 1 worth shipping on its own? (Recommendation: yes — it removes meaningful operator friction immediately and gives us production telemetry on Stripe MCP usage before Phase 2 design locks.)

---

## 7. Next steps

1. Stakeholder review of this brief — approve / amend / reject.
2. If approved:
   - **Phase 1:** open a Standard task on this branch, register the Stripe MCP preset, ship behind a feature flag, gather usage signal for 1–2 weeks before Phase 2 design freezes.
   - **Phase 2:** open a new session, run `spec-coordinator` against this brief (Section 3 is the input). Spec, architect, chunked build, full review pipeline, finalisation. Target a separate feature branch (`claude/agentic-commerce-spending`).
3. Update `docs/capabilities.md` once Phase 1 ships to reflect Stripe's expanded role (no longer "data connector only").
4. Update `docs/agent-as-employee-runbook.md` once Phase 2 ships to add the spending-policy setup section.
