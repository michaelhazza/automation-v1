# SynthetOS Pricing Evolution — Strategy Brief

_Date: 2026-05-14_
_Status: Pre-spec strategy brief. Captures analysis of AWS keynote ("How Your Customers Invest and Measure AI" / AI Monetization Framework) against the current SynthetOS pricing implementation. No code changes proposed yet._
_Inputs: AWS keynote transcript and slide deck (Augmentation > Automation, AI Monetization Framework, 6 AI Attributes, Value vs Utility Pricing, Hybrid Pricing Is Gaining Traction, AI Pricing Trends, Agentic Pricing — Amazon Quick), the SynthetOS Master Architecture Brief v1.2, the Automation OS capabilities registry, and the live pricing schema (`server/db/schema/subscriptions.ts`, `orgSubscriptions.ts`, `modules.ts`, `llmPricing.ts`)._

---

## Contents

- [Purpose](#purpose)
- [Verdict in one paragraph](#verdict-in-one-paragraph)
- [Current state, in plain terms](#current-state-in-plain-terms)
- [Alignment with the AWS framework](#alignment-with-the-aws-framework)
  - [Augmentation, not automation](#augmentation-not-automation)
  - [Hybrid pricing shape](#hybrid-pricing-shape)
  - [Margin defence infrastructure](#margin-defence-infrastructure)
  - [6-attribute self-score](#6-attribute-self-score-the-keynotes-value-capture-radar)
- [Two evolutions to make](#two-evolutions-to-make)
  - [Evolution 1: Add a customer-legible value unit](#evolution-1-add-a-customer-legible-value-unit-alongside-the-seat)
  - [Evolution 2: Productise predictability](#evolution-2-productise-predictability-as-a-top-of-page-promise)
- [What to avoid](#what-to-avoid)
- [Proposed v1 SKU shape](#proposed-v1-sku-shape-illustrative-not-locked)
- [Open questions for the next session](#open-questions-for-the-next-session)
- [Next step](#next-step)

---

## Purpose

Decide whether SynthetOS pricing is on the right track relative to where the market is moving, and if not, what to change. This brief is the strategic input; a separate pricing spec will follow once direction is locked.

## Verdict in one paragraph

Largely on the right track. The current SKU shape (per-seat base, module-gated tiers, subaccount cap, Stripe-backed monthly/yearly, internal per-token cost ledger) is structurally the same hybrid model the keynote shows winning in the market. Two evolutions are needed before agentic traffic dominates: add a customer-legible value unit (a "Supervised Execution" or equivalent) alongside the seat, and productise predictability (a guaranteed monthly cap) as a top-of-page promise. The infrastructure to support both already exists in the codebase; the work is product and pricing, not engineering.

---

## Current state, in plain terms

What the database already encodes:

- **`subscriptions`** packages a set of `moduleIds` plus `subaccountLimit`, `priceMonthlyCents`, `priceYearlyCents`, `yearlyDiscountPercent`, `trialDays`, and Stripe product/price IDs. Tiered, module-gated, billing-ready.
- **`orgSubscriptions`** holds the org's active subscription, lifecycle (`trialing → active → past_due → cancelled / paused`), `consumedSeats`, comp flag, period boundaries, and `stripeSubscriptionId`.
- **`modules`** define a capability bundle with an allow-list of agent slugs (or `allowAllAgents`). Modules are the lever for tiered functionality.
- **`llmPricing`** + `llmRequests` + `orgComputeBudgets` give per-call cost attribution with org, subaccount, run, and skill granularity. Cost circuit breakers and pre-reserved budgets exist.

What the capabilities registry positions externally:

- Augmentation language throughout. The review system is the product. 42+ review gates, approve-with-edits, side-effect classification, immutable spend ledger.
- Multi-tenant three-tier isolation (System, Org, Subaccount) called out as a structural differentiator.
- Vendor-neutral, model-agnostic positioning. No single LLM provider named in customer-facing copy.
- A 2026-05-12 capability addition: Subscription-Driven Long-Task Execution (subscription-mediated session management for long browser tasks, with automatic chain-resume and graceful fallback to direct billing). This is a cost-control mechanism, not a pricing surface.

## Alignment with the AWS framework

### Augmentation, not automation

Match. The capabilities doc is explicit on supervised, reviewed, accountable agent work. The keynote's strongest single point is that automation framing collapses under price pressure because customers do not perceive value; augmentation framing justifies a premium. The current SynthetOS positioning is already in the right column.

### Hybrid pricing shape

Match. The keynote's growth chart shows hybrid pricing at 21% median growth and 67% of companies reporting margin improvement, with pure per-seat at 5% growth and 10% margin improvement. SynthetOS already has per-seat + module-gated tiers + subaccount cap, which is structurally the same shape Amazon Quick uses (Professional $20 / Enterprise $40 per user/month + tiered Research Agent hours + infrastructure fee). The current SKU is not the dying model.

### Margin defence infrastructure

Match, with upside. Most ISVs in the keynote are reportedly running 10 to 30 margin points below classic SaaS because they cannot meter or cap AI cost per customer. SynthetOS already has the meter (`llmPricing`, `llmRequests`, `orgComputeBudgets`, `spendingPolicies`) and the cap (`spendingBudgets`, cost circuit breakers, pre-reserved budgets). This is a defensible position no per-seat-only competitor can match without rebuilding their cost layer.

### 6-attribute self-score (the keynote's value-capture radar)

Rough internal scoring on a 1 to 5 scale. The keynote warns that an average below 3.5 indicates pricing will struggle because customers will not perceive the value.

| Attribute | Score | Rationale |
|---|---|---|
| Customer Value | 4 | Strong agency-specific augmentation. Slightly diluted by breadth of capabilities making the single-sentence value pitch harder to articulate. |
| Domain Specialisation | 3 | Agency vertical is a genuine specialisation, but the deeper verticals (GEO, Churn Detection, Portfolio Intelligence) are not yet visibly mature enough to anchor pricing power. This is the weakest axis and the cheapest to improve. |
| Position in Value Chain | 5 | SynthetOS is the application surface. Agencies live inside the product. This is as far right on the value chain as it gets for this buyer. |
| Proprietary Data & Customisation | 4 | Per-client memory, per-client skills, three-tier override, workspace customisation, integration framework. Not full custom-model territory, but well past pure prompt engineering. |
| Model Scale & Accuracy | 4 | Per-skill model routing, model-agnostic, rollback via the review system, side-effect classification. |
| Security & Compliance | 5 | Multi-tenant isolation enforced at the DB layer, 42+ review gates, immutable spend ledger, encrypted secrets, tenant-scoped event rows, runaway-loop protection. |

Average ~4.2. Above the 3.5 floor. The framework predicts this should support a premium pricing posture if the SKU is built to capture it.

## Two evolutions to make

### Evolution 1: Add a customer-legible value unit alongside the seat

The keynote's strongest medium-term call: in two to three years, more traffic on your platform will be agent-driven than human-driven. Per-seat does not survive that transition because the seat is no longer the unit of value. Salesforce calls their unit the Agent Working Unit. The keynote's security-scan example renamed the unit from "risks detected" (which capped revenue at one charge per scan) to "scans run" (which uncapped revenue and made the unit understandable to the customer).

The SynthetOS-native version of this unit should map to what the agency actually sells to their end client. Candidates, in order of preference:

1. **Supervised Execution.** One workflow run that passes through the review system to a delivered outcome. Maps directly to the differentiator ("the review system is the product"). Easy to count. Already metered internally via `agent_runs`.
2. **Approved Action.** Each gated action the operator approves. More granular, harder to forecast, less natural as a price unit.
3. **Client Run.** A run scoped to a specific subaccount. Indistinguishable from Supervised Execution in practice; less precise language.

Recommendation: **Supervised Execution.**

Pricing application:

- Bundle a generous allowance per tier (the way Amazon Quick bundles 2 hrs / 4 hrs of Research Agent).
- Publish an overage rate per unit above the allowance.
- Use the same unit to monetise third-party agent traffic into the platform (MCP-style external callers pay the published per-unit rate). The keynote calls this out explicitly: ISVs that block 3P agent access lose a revenue line; ISVs that price it correctly turn it into one.

### Evolution 2: Productise predictability as a top-of-page promise

The keynote names anxiety over unpredictable cost as the number-one adoption barrier, ahead of price point. Most ISVs cannot commit to a hard monthly cap because they do not meter granularly enough to defend the cap. SynthetOS does. The capability already exists in `spendingPolicies`, `spendingBudgets`, `agentCharges`, `orgComputeBudgets`, and the cost circuit breakers. It is not yet a top-of-page marketing promise.

The change is to lift "Your monthly bill cannot exceed $X without your explicit approval" to the same prominence as "multi-tenant isolation" and "model-agnostic routing." This is a marketing and pricing-page change, not an engineering change.

## What to avoid

Three direct calls from the keynote, mapped to SynthetOS:

1. **Do not move to outcome-only pricing.** The keynote's strongest cautionary tale (the security-scan vendor) shows outcome-only transferring cost-volatility risk back onto the ISV. Use outcome as marketing language; do not use it as the SKU metric.
2. **Do not expose token pricing to customers.** Tokens are not a customer-legible unit. The internal `llmPricing` table is correctly abstracted away from any customer surface today. Keep it that way.
3. **Do not block third-party agents.** The keynote warns that pulling up the drawbridge on MCP-style external access leaves money on the table. Better posture: a published per-Supervised-Execution rate for external agent traffic so 3P consumption becomes a revenue line, not a margin leak.

## Proposed v1 SKU shape (illustrative, not locked)

```
Pro              $X / seat / month
                 +  N Supervised Executions / month
                 +  K subaccounts
                 +  base modules

Agency           $Y / seat / month
                 +  M Supervised Executions / month   (M > N)
                 +  more subaccounts
                 +  vertical modules (GEO, Churn Detection, Portfolio Intelligence)

Enterprise       Negotiated
                 +  custom allowance
                 +  cap commitment (monthly bill cannot exceed customer-set ceiling)
                 +  external agent access at published per-execution rate
                 +  SSO, dedicated support
```

Schema delta required:

- Add allowance and overage fields to `subscriptions` (e.g. `executionAllowance`, `executionOverageCents`).
- Add a usage counter scoped to the billing period, derivable from existing `agent_runs` and the review system, surfaced via the existing usage explorer.
- No new tables required. Stripe metered-usage integration would be a follow-up if overage is invoiced.

The strategic decision is whether to commit to this shape. The implementation is a few migrations and a billing-pipeline change.

## Open questions for the next session

1. **Buyer focus for the next two quarters.** Mid-market agencies (10 to 50 clients) vs single-operator agencies. The hybrid + cap-commitment story sharpens for mid-market. The seat-only narrative still works for single-operator, and the value-unit shift becomes less urgent there.
2. **Vertical readiness.** Is GEO, Churn Detection, or Portfolio Intelligence ready to ship as a paid premium add-on this quarter? Each one moves the Domain Specialisation score from 3 to 4 and unlocks the 30 to 40 percent add-on premium the keynote quotes for high-impact AI functionality.
3. **Unit naming.** "Supervised Execution" is the recommended internal term. Customer-facing copy may want a shorter brand: "Run", "Approved Run", "Workflow Execution". Pick before the spec lands so all surfaces (pricing page, usage explorer, invoice line items) stay consistent.
4. **Cap-commitment promise wording.** Marketing-side decision: a soft cap ("we will notify you before you exceed $X") vs a hard cap ("execution stops at $X without your explicit approval"). The hard cap is structurally available in code today; the soft cap is easier to sell.
5. **3P agent monetisation timing.** Ship the external-agent rate now (small market today, but pre-empts the locked-out narrative) or wait until MCP traffic is observably non-trivial.

## Next step

If the direction in this brief is accepted, the follow-up is a pricing spec at `tasks/builds/{slug}/spec.md` covering: the value-unit definition, the schema delta, the Stripe integration changes, the migration plan from the current per-seat SKU, the cap-commitment policy, the pricing-page copy, and the rollout plan for existing customers. The spec is roughly Significant-class work (2 to 4 domains touched: schema, billing, usage explorer, marketing surface) and would go through the standard spec-coordinator pipeline.
