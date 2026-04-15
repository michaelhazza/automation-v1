# Agency Billing & P&L — Dev Brief

> **Status:** Draft brief — captures product direction and architectural decisions agreed in discovery. **Not** a detailed implementation spec. A full dev spec will be written before build kicks off.
>
> **Author:** Synthetos product/engineering
> **Last updated:** 2026-04-15
> **Branch of origin:** `claude/explore-anthropic-features-nbkO8`
> **Audience:** Product, engineering, founders. Not customer-facing.
>
> **Companion docs:**
> - [`docs/capabilities.md`](./capabilities.md) — product positioning and capability registry
> - [`docs/clientpulse-dev-spec.md`](./clientpulse-dev-spec.md) — first agency-billable module
> - [`architecture.md`](../architecture.md) — three-tier model, permissions, services

---

## Purpose

Synthetos already runs the work. Today the platform tracks cost meticulously (LLM spend, IEE compute, margin config, circuit breaker, attribution chain), but the **revenue side does not exist** — agencies cannot bill their clients through Synthetos, and they cannot see whether a subaccount is profitable.

This brief defines the Agency Billing & P&L surface: the layer that turns Synthetos from a cost centre into the agency's primary money-making system. It captures the strategic framing, the architectural shape, the operational decisions that have been resolved, and the items still open for the spec phase.

---

## Table of Contents

1. [Vision & Positioning](#1-vision--positioning)
2. [Two-Tier Billing Model](#2-two-tier-billing-model)
3. [Three Margin Layers](#3-three-margin-layers)
4. [Currency Strategy](#4-currency-strategy)
5. [Payment Architecture](#5-payment-architecture)
6. [Client Subscription Plans & Modules](#6-client-subscription-plans--modules)
7. [Card & Billing Management](#7-card--billing-management)
8. [P&L Dashboard](#8-pl-dashboard)
9. [Operational Decisions](#9-operational-decisions)
10. [MVP Scope & Boundaries](#10-mvp-scope--boundaries)
11. [Phased Roadmap](#11-phased-roadmap)
12. [Success Metrics & Open Decisions](#12-success-metrics--open-decisions)
13. [Appendix — Terminology & References](#13-appendix--terminology--references)

---

## 1. Vision & Positioning

### The shift this enables

Synthetos today is positioned, internally, as the operations system. Externally, agencies still see it as "the AI tool we run our automations on" — useful, but a cost line. Billing & P&L flips that frame.

Once the agency can:

- Bill clients directly through Synthetos
- See, per client, what they earn vs. what they spend
- Bundle the platform's modules (ClientPulse, geo-SEO, reporting, future modules) into productised offers with their own price tags

…Synthetos becomes the **revenue ledger of the agency**, not a tool sitting under it. That is the strategic shift this surface unlocks.

### Positioning principles

Three rules guide every product decision in this surface:

1. **Frame as a money-maker, not a cost report.** The primary surface is "how much you're earning per client." Cost is a sub-view, not the headline. Margin is the lead metric.
2. **Easy beats complete.** The MVP must let an agency configure and bill three real clients in under an hour, with zero engineering involvement. If a decision in this brief makes that harder, it's the wrong decision.
3. **The agency keeps the customer relationship.** Synthetos orchestrates billing; the agency owns the brand, the payment processor account, the dispute liability, and the client conversation. Synthetos is invisible to the end client unless the agency chooses otherwise.

### What "good" looks like at MVP

- An agency owner finishes onboarding the billing surface in a single sitting.
- They productise their existing service into a Client Subscription Plan with a price tag in their currency.
- They invite a client, the client lands on a hosted checkout page, enters a card, and a subscription is live.
- The agency's dashboard shows: monthly recurring revenue per client, per-client cost (LLM + IEE + module fees), per-client gross margin, portfolio rollup.
- When a client's card fails, the system handles the dunning lifecycle without the agency lifting a finger.

### What this is NOT

- Not an accounting system. Synthetos reports revenue and cost; it does not replace Xero/QuickBooks. Clean export paths are in scope; double-entry ledgers are not.
- Not a CRM. Client records exist for billing only. Pipeline, deals, conversations stay where the agency already runs them.
- Not a quoting or proposal tool. Plans are pre-defined. One-off variable invoicing comes later (Phase 2+).
- Not a tax engine. Tax handling delegates to the payment processor's tax product where enabled; agencies outside that coverage opt out and handle tax themselves.

---

## 2. Two-Tier Billing Model

Synthetos operates as a marketplace. Money flows along two distinct billing relationships, and the system must keep them cleanly separated.

### Tier 1 — Synthetos → Org (already exists)

The agency pays Synthetos for the platform itself. This is the SaaS subscription that already exists today (`subscriptions`, `orgSubscriptions`). It covers:

- The Synthetos org seat
- The pre-paid LLM credit pool (with Synthetos margin baked in)
- Access to the modules included in the agency's plan

This tier is unchanged in scope by this brief — it continues to operate as it does today. Billing & P&L extends it (margin overrides per org, platform-fee mechanism), but does not rewrite it.

### Tier 2 — Org → Client (new — this is what we are building)

The agency bills its own clients through Synthetos. Each client (a subaccount in Synthetos terms) has:

- A **Client Subscription Plan** picked from the agency's catalogue
- A **subaccount-level subscription** with its own price, currency, billing cycle, and payment method
- A subscription-state lifecycle (trialing → active → past_due → suspended → cancelled) independent of the org's own Synthetos subscription

The client pays the agency. Synthetos orchestrates the charge through the agency's connected payment account, optionally takes a platform fee on top, and reports both sides.

### Why both tiers are first-class

Earlier discussion considered pushing all subscription logic to either the org level or the subaccount level only. Both are wrong:

- **Org-only** kills the per-client P&L story — the agency cannot bill clients differently or see per-client margin.
- **Subaccount-only** kills the platform's own subscription story — Synthetos' own SaaS billing collapses into the customer's billing.

The right model is **both, distinct**, with the org tier governing platform access and credit pool, and the subaccount tier governing client-facing recurring revenue.

### Data model implications (high level)

The dev spec will detail tables. At brief level, the new surface needs:

- A catalogue of agency-defined plans (one per agency, multiple plans per agency)
- Per-subaccount subscription records linking subaccount → plan → payment method → cycle
- A revenue ledger capturing each successful charge, its currency, the platform fee taken, and the amount netted to the agency
- An FX rate table for converting between subaccount currencies and the agency's reporting currency

### Lifecycle ownership

| Surface | Owner | Notes |
|---------|-------|-------|
| Org subscription state | Synthetos | Existing flow — unchanged |
| Subaccount subscription state | Agency | New — agency configures, system enforces |
| Client payment method | Client | Stored as a token by the payment processor, not by Synthetos |
| Dunning, grace, suspension on subaccount | System (rules set by agency) | Default rules ship with the platform; agencies can adjust |
| Cancellation on subaccount | Agency or client | Both paths supported; agency-initiated requires permission |

---

## 3. Three Margin Layers

Money flows through Synthetos with three distinct margin layers stacked on top of each other. Each is owned by a different party, configured in a different surface, and reported on independently.

### Layer A — Synthetos credit margin (existing, extended)

Synthetos buys raw inference and compute (LLM tokens, IEE runtime), marks it up, and resells it as platform credits. The margin is configured per-org, with a system default.

| Property | Value |
|----------|-------|
| Owner | Synthetos |
| Default | System-wide default set by Synthetos admin |
| Override | Per-org override (agreed: this brief adds the override path; today only a single global value exists) |
| Reported to | Synthetos (full) and agency (as "platform credit cost" — they don't see the raw provider cost) |

This layer already exists on the cost side. The MVP extends it with a per-org override, configurable from the Synthetos admin surface.

### Layer B — Synthetos platform fee on Connect transactions (new mechanism, default 0%)

When the agency bills a client via Synthetos and the charge passes through the connected payment account, Synthetos can take a platform fee on top. This is the marketplace-style monetisation path.

| Property | Value |
|----------|-------|
| Owner | Synthetos |
| Default at launch | **0%** across all plans |
| Mechanism | Built into MVP — must work end-to-end on day one |
| Override | Per-org override path exists (same surface as the credit margin override) |
| Visibility | Disclosed to the agency in their billing settings; not exposed to the end client |

The mechanism ships in MVP; the value is set via configuration, not code. This lets Synthetos introduce monetisation later (e.g. premium plans with 0% platform fee, standard plans with X%) without re-engineering the surface.

### Layer C — Agency margin on client pricing (new — the headline)

The agency sets its own price per Client Subscription Plan, in its chosen currency. The gap between that price and the cost of running the subaccount (Layer A credits + Layer B platform fee + module licence fees) is the agency's gross margin.

| Property | Value |
|----------|-------|
| Owner | Agency |
| Configured in | Agency settings → Client Subscription Plans |
| Reported in | P&L dashboard — per client, per plan, portfolio rollup |
| Constraint | Must be ≥ 0 net of Layer A + B at the per-subaccount level (system warns the agency if a configured plan is loss-making at expected usage) |

### Visibility rules

- Synthetos sees **all three layers**.
- Agency sees **Layer A (as a single "platform cost" number), Layer B (as a single "platform fee" number), and Layer C (their own pricing and net margin)**. They do not see Synthetos' raw provider cost.
- End client sees **only Layer C** — the agency's price, in their currency. Synthetos and the platform fee are not exposed.

### Per-org overrides

Both Layer A (credit margin) and Layer B (platform fee) support per-org override on top of the system default. Use cases:

- A strategic agency partner gets a lower credit margin
- A high-volume agency negotiates a reduced platform fee
- A new agency on a discounted launch plan gets both reduced for a fixed term

The override surface lives in the Synthetos admin app, not in the agency-facing UI.

---

## 4. Currency Strategy

**Decision: multi-currency at MVP.** Earlier framing pushed currency to Phase 2; that framing is rejected. Retro-fitting currency into a billing surface that launched single-currency is significantly more painful than building it in from day one. The extra investment at MVP is small and well-bounded.

### Operating principles

1. **Per-subaccount currency.** Each subaccount has one billing currency, set when the subaccount subscription is created. The currency is whatever the agency chose for that client's plan.
2. **Per-agency reporting currency.** The agency picks one display currency for the P&L dashboard. All multi-currency revenue and cost is converted into the reporting currency for the rollup view.
3. **Original currency is the source of truth.** Every revenue ledger entry stores the actual transacted currency and amount. The reporting-currency value is a derived view, computed from FX at the time of the transaction.
4. **Costs are denominated in the platform's settlement currency** (USD by default — Synthetos charges credits in USD), then converted into both the subaccount's currency and the agency's reporting currency for display.

### Supported currencies at MVP

The MVP ships with the major currencies the payment processor supports natively. The first list is intentionally tight — easy to extend later, painful to walk back if we ship too many half-supported currencies on day one.

- USD, EUR, GBP, AUD, CAD, NZD, ZAR, AED, INR, SGD

Adding a currency post-MVP is a config + tax-coverage check, not new architecture.

### FX rate handling

- A daily rate snapshot is captured from a single FX source (e.g. ECB or OpenExchangeRates). Source TBD in spec.
- Each revenue ledger entry stores the FX rate used at the time of transaction. **Never** re-compute historical revenue using today's FX rate — distorts the P&L.
- Cost-side conversion uses the rate from the same daily snapshot the cost was incurred under.
- The reporting-currency view exposes both the converted total and the underlying mixed-currency breakdown. The agency can see "$45k MRR" and drill in to "$32k USD + €8k EUR + £4k GBP."

### Display rules

- Client-facing surfaces (invoices, hosted checkout) only ever display the subaccount's local currency.
- Agency-facing surfaces show the subaccount's local currency on per-client views, and the reporting currency on portfolio rollups. A toggle lets the agency switch reporting currency at any time without reloading historical data.
- The Synthetos admin surface shows USD throughout — no localisation for internal ops.

---

## 5. Payment Architecture

### Provider strategy

**Decision: integrate with one provider at MVP, behind an abstracted gateway interface.**

The first integration is Stripe Connect Standard accounts. The integration sits behind a `PaymentGateway` interface so additional providers can be added later without touching the billing surface. Providers under consideration for later phases include alternatives that better serve regions where Stripe is weak (some emerging markets, certain high-risk verticals).

This is **not** a multi-gateway router at MVP. One provider, abstracted behind an interface for future flexibility — not implemented as a runtime selector.

### Why Stripe Connect Standard

Three clean properties, each of which would be hard to give up:

1. **The agency owns the payment relationship.** They sign up directly with the processor under their own brand. KYC, tax forms, payouts, dispute liability, and statement descriptors are all theirs. Synthetos never holds funds, never appears on the client's statement.
2. **Synthetos can take a platform fee on the connected charge.** This is the Layer B mechanism — supported natively, no custom money-movement code needed.
3. **PCI scope stays minimal.** All card data is tokenized by the processor (SAQ A scope). Synthetos never sees, stores, or transmits a raw card number.

The other Connect models (Custom, Express) were considered and rejected:

- **Custom** transfers liability to Synthetos and requires us to build the entire onboarding/dispute/payout UI. Too heavy.
- **Express** keeps Synthetos partly liable and dilutes the agency-owned brand story. Wrong shape for our positioning.

### Onboarding ease

The single biggest risk in this surface is agencies bouncing during the processor's identity verification flow. Eight tactics to mitigate:

1. **Pre-flight checklist** — a single screen listing exactly what the agency will need (business registration number, bank account, ID document, etc.) before they start.
2. **Processor-hosted onboarding** — use the provider's hosted flow rather than embedding it. Lower maintenance, better UX, and the provider handles the regulatory variance.
3. **Background verification** — start the verification process the moment the agency connects, so by the time they're ready to add their first client, verification is often already complete.
4. **Test mode first** — agencies can configure plans, invite test clients, and watch a successful test charge before they ever touch live verification. Reduces "is this even worth my time?" friction.
5. **Status indicator** — a persistent, calm badge on the billing settings showing verification state ("Verifying — typically 1 business day," "Verified," "Action needed: upload document"). No surprises.
6. **Smart error surfacing** — when verification needs more info, surface exactly which document is needed and link straight to the upload, not a generic "go check your processor dashboard" message.
7. **Skip-and-return** — agencies can skip verification, continue exploring the rest of the platform, and return to it via a clear in-app prompt. Don't gate the entire experience on this single step.
8. **Time estimates everywhere** — every step shows expected duration ("about 5 minutes," "1 business day"). Removes the "how long will this take?" anxiety that causes drop-off.

### Webhook handling

Subscription state, charge outcomes, dispute events, and payout events all arrive via processor webhooks. The MVP must handle:

- Subscription lifecycle events (created, updated, cancelled, past_due, etc.)
- Invoice events (paid, payment_failed, finalized)
- Charge events (succeeded, failed, refunded, disputed)
- Connect account events (verification status, capability changes)

Webhook ingestion is idempotent (same event ID processed twice does not double-count) and non-blocking (handler queues a job, job updates state).

### Security & compliance

- **PCI:** SAQ A scope only. Never touch raw cards. Use processor's hosted elements for any card capture.
- **Webhook signing:** every webhook is signature-verified before any state change.
- **Connect account credentials:** stored as opaque tokens in the org record, scoped to the agency.
- **Refunds and disputes:** initiated through the processor's dashboard primarily; in-app surface comes Phase 2+. MVP just reflects state.

---

## 6. Client Subscription Plans & Modules

The Client Subscription Plan is the core productisation primitive. It lets the agency package what they sell into named, priced offers with predictable inclusions.

### What a Client Subscription Plan is

A reusable template defined by the agency that captures:

- **Name and description** (agency-facing internal label and client-facing public copy)
- **Price** in one currency, plus optional alternate-currency variants for the same plan
- **Billing cycle** — monthly or annual
- **Modules included** (see module cascade below)
- **Default usage caps and quotas** for the modules included
- **Trial offer** (optional — duration, card-required-yes/no)

Plans are created once, reused across many clients. A client subscribes to exactly one plan at a time. Plan changes (upgrade/downgrade) are first-class events with proration handled by the processor.

### Default plan templates

Three pre-built templates ship with the platform so a new agency is not staring at a blank page. Templates are starting points — fully editable, deletable, and not enforced.

| Template | Default price (USD) | Positioning |
|----------|---------------------|-------------|
| Essentials | $499 / mo | Entry-level — single module, basic quotas |
| Growth | $1,499 / mo | Mid-tier — primary modules included, higher quotas |
| Scale | $4,999 / mo | Premium — full module suite, generous quotas, priority support |

The template prices, names, and module mixes are the agency's choice to keep, edit, or delete. They exist solely to make first-touch productisation faster.

### Module cascade

Modules are the granular feature units (ClientPulse, geo-SEO surface, reporting agent, future modules). They are not specific to the billing surface — they exist as a platform primitive — but billing is where module access is gated and monetised.

The cascade has three levels:

1. **Synthetos plan** — defines which modules the agency has access to overall (their Synthetos org subscription).
2. **Agency's Client Plans** — the agency packages a subset of their available modules into each Client Plan offered to clients.
3. **Subaccount** — inherits the modules of whichever Client Plan it is subscribed to.

The cascade enforces the rule that an agency cannot offer a client a module the agency itself does not have access to. The UI surfaces this clearly: when the agency is editing a Client Plan, only the modules from their own Synthetos plan are selectable.

### ClientPulse is just a module

Earlier discussion considered whether ClientPulse should be a special "base subscription" with its own architecture. Decision: **no**. ClientPulse is the first module to be billed agency-to-client, but it is implemented as a standard module that happens to be in every default plan template. This keeps the architecture clean — every future agency-billable feature follows the same pattern.

### Quota enforcement

Each module declares the quotas it cares about (e.g. "report runs per month," "tracked locations," "alert subscribers"). The Client Plan sets defaults for each quota. The subaccount can have per-instance overrides if the agency negotiates differently with one client.

Quota breaches are handled by the module itself, not the billing surface. The billing surface only owns plan definition and quota propagation — not enforcement.

### Plan lifecycle events

| Event | Trigger | Behaviour |
|-------|---------|-----------|
| Plan published | Agency saves plan with status=active | Available to assign to subaccounts |
| Plan archived | Agency archives plan | Existing subscribers continue; not available to new subaccounts |
| Plan price change | Agency updates price | Existing subscribers grandfathered at original price; new subscribers get new price (configurable per change — agency can choose to migrate existing subscribers with notice period) |
| Plan deleted | Only allowed if zero subscribers, ever | Hard delete; otherwise must archive |

---

## 7. Card & Billing Management

The agency does not handle cards directly. Synthetos does not handle cards directly. The processor handles cards. This section describes how that ownership shows up in the UX.

### Card capture flow

1. Client receives an invitation link from the agency (email or in-app).
2. Link opens a hosted checkout surface — agency-branded where possible (logo, colour, business name) but rendered by the processor.
3. Client enters card details directly into the processor's PCI-compliant form. Synthetos never sees the card data.
4. On success, the processor returns a payment-method token; Synthetos stores the token reference against the subaccount subscription.
5. Subscription transitions to `active` (or `trialing` if trial offered).

### Ongoing card management

The processor's hosted Customer Portal handles every post-signup card management need: update card, view invoice history, change billing address, download receipts. The portal is entered from a "Manage billing" link on the client's subaccount surface.

This means Synthetos does not build:

- A card-edit form
- An invoice list view
- A receipt download surface
- A billing-address management form

…all of which would otherwise be significant UX surface area to design, build, and maintain compliance for.

### Trial lifecycle

Trials are a per-plan setting. When enabled:

- **Card-required vs card-optional** is per plan. Default: card required (better conversion at trial → paid).
- Trial duration is per plan. Default: 14 days.
- Trial state begins on subscription creation.
- 3 days before trial end, the system sends a notification to the client and surfaces a banner in the agency view.
- On trial end with no payment method: subscription moves to `incomplete`. Subaccount becomes read-only.
- On trial end with payment method: first invoice attempts; on success → `active`, on failure → `past_due`.

### Past_due (grace period)

When a charge fails:

- Subscription enters `past_due`.
- 7-day grace window begins.
- During grace: the subaccount remains fully functional but a banner appears for both client and agency users showing days remaining.
- Processor's smart retry logic attempts re-charge on its standard schedule.
- On day 7 with no successful charge: subscription moves to `suspended`. Subaccount becomes read-only.

### Suspended state

- Subaccount is read-only — agents do not run, scheduled tasks do not fire, no new work is queued.
- Existing data and history remain fully visible.
- A prominent banner explains the state and how to resolve.
- Only the **agency org admin** can unsuspend (after resolving payment) — clients cannot self-unsuspend without successful payment.
- Suspended state lasts 30 days. After 30 days, the subaccount is archived (still recoverable on payment for a further period TBD in spec).

### Comp ability

Both org-level and subaccount-level comp toggles exist:

- **Org-level comp** — Synthetos admin marks an org as "comped." All Synthetos→Org charges suppressed. Used for partners, internal accounts, free-tier launch deals.
- **Subaccount-level comp** — Agency marks a specific subaccount as "comped." All Org→Client charges suppressed for that subaccount. Used for the agency's own internal accounts, friends-and-family, or first-customer freebies.

Comped subaccounts still incur cost (LLM, IEE) and still appear in the P&L — they just show $0 on the revenue side and a clear "comped" tag.

### Audit log

All billing events (subscription state changes, plan switches, comp toggles, refund issuance, manual interventions) write to the existing `audit_events` table with a billing namespace. No new audit infrastructure required.

---

## 8. P&L Dashboard

The P&L dashboard is the headline surface of this entire programme. Everything else exists to make this view meaningful.

### Design principle

The dashboard leads with **revenue and margin**, not cost. The agency opens it to answer "am I making money?" — not "what did I spend?" Cost is one section among several, deliberately not the headline.

### Top-line summary (always visible)

A single row across the top of the dashboard, in the agency's reporting currency:

- **MRR** — current monthly recurring revenue (sum of active subscription monthly equivalents)
- **ARR** — annualised
- **Active clients** — count of subaccounts with active or trialing subscriptions
- **Gross margin %** — overall, this period
- **Trend arrows** — vs. previous period

### Per-client view

A table listing every subaccount with billing data:

| Column | Description |
|--------|-------------|
| Client | Subaccount name and link |
| Plan | Current Client Subscription Plan |
| State | active / trialing / past_due / suspended / cancelled |
| Currency | Subaccount's billing currency |
| MRR (local) | Monthly recurring revenue in client's currency |
| MRR (reporting) | Same, converted to agency's reporting currency |
| Cost (this period) | All-in cost — credits + platform fee + module fees, in reporting currency |
| Margin | MRR − cost, in reporting currency |
| Margin % | Margin / MRR |
| Trend | Sparkline of the last 12 periods |

Standard column-header sort and filter UX (per `architecture.md` data-table conventions). Click a client → drill into their full billing detail.

### Per-client detail view

For a single subaccount, the breakdown that lets the agency understand what's actually happening:

- Subscription history (plan changes, state transitions)
- All charges (date, amount, currency, status, processor reference)
- Cost breakdown (LLM by provider, IEE compute, module fees) for the current period and rolling 12 periods
- Margin trend chart
- Comp toggle (if permitted)
- Direct link to processor's customer detail page

### Portfolio rollup

Aggregate views the agency can slice by:

- **Plan** — MRR and margin by Client Subscription Plan
- **Module** — MRR attributable to each module (helps the agency see which products earn the most)
- **Currency** — MRR breakdown by transacted currency
- **Acquisition cohort** — MRR/margin by month of subaccount creation

### Cost view (secondary)

A standalone section, deliberately not the headline:

- Total platform cost this period (Layer A — credits)
- Total platform fee this period (Layer B)
- Total module licence fees this period
- Top 5 cost-drivers (which subaccounts spent the most)
- Trend vs. previous period

### Export

CSV export of:

- Per-client table (columns above)
- Per-client detail (subscription history + charges)
- Cost breakdown by line item

CSV is the only export format at MVP. PDF export of formatted statements comes later.

---

## 9. Operational Decisions

These are the resolved positions on the operational questions raised during discovery. They are inputs to the dev spec, not implementation details.

### Decision summary

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Annual billing | Supported at MVP. **20% discount** applied to annual plans by default; agency can override per plan. |
| 2 | Tax handling | Per-agency toggle. When enabled, processor's tax product calculates and collects. When disabled, agency handles tax themselves (invoice line-item, no in-app calculation). |
| 3 | Proration on plan change | Handled by the processor's standard proration logic. Agency can override per-plan-change to "no proration, charge full new price next cycle." |
| 4 | Audit log | Reuse existing `audit_events` table with billing namespace. No new infrastructure. |
| 5 | Permissions | New permission keys for billing actions (view P&L, edit Client Plans, comp subaccounts, view processor connection, manage org-level overrides). All gated through existing permission system. |
| 6 | Multi-currency | At MVP. Per-subaccount currency, per-agency reporting currency, FX-aware portfolio rollup. |
| 7 | Comp toggle | Both org-level (Synthetos admin) and subaccount-level (agency). Comped subaccounts still incur cost, show $0 revenue, tagged in P&L. |
| 8 | Onboarding ease | 8-tactic plan: pre-flight checklist, hosted onboarding, background verify, test mode first, status indicator, smart errors, skip-and-return, time estimates. |

### Annual billing detail

- Default discount: 20% off the equivalent monthly price × 12.
- Default is platform-wide; per-plan override allowed.
- Annual subscriptions show "annual" cycle in P&L; MRR is computed as annual price ÷ 12 for consistent rollup.
- Annual cancellation respects processor refund policy (configurable per agency: pro-rated refund, no refund, custom).
- Switching from monthly → annual mid-cycle: handled by processor proration.
- Switching from annual → monthly mid-cycle: takes effect at end of current annual term.

### Tax handling detail

- The processor's tax product handles VAT/GST/sales tax for jurisdictions it supports.
- Per-agency toggle in billing settings; default off.
- When enabled: tax displayed on invoice, collected on charge, remitted by the agency through their own filing process (Synthetos provides the data, not the filing).
- When disabled: agency is responsible for any tax obligations. UI surfaces a "tax handled externally" note on invoices.
- Tax registration numbers (VAT IDs etc.) collected per-agency and per-client where required.

### Proration detail

- Default: processor's standard proration on plan change (credit unused portion of old plan, charge prorated portion of new plan).
- Per-change override: "no proration" — current cycle ends as-is on old plan, new plan begins at next cycle.
- Visible to the client on the invoice with line-item breakdown.

### Permissions

New permission keys (registered in `server/lib/permissions.ts`):

- `billing.view_pl` — see the P&L dashboard
- `billing.manage_plans` — create, edit, archive Client Subscription Plans
- `billing.manage_subscriptions` — assign plans to subaccounts, cancel, change
- `billing.manage_processor_connection` — connect/disconnect the agency's payment processor account
- `billing.comp_subaccount` — toggle comp on a subaccount
- `billing.view_audit` — view billing-namespace audit events
- (Synthetos admin only) `system.billing.override_org_margin` — set per-org Layer A override
- (Synthetos admin only) `system.billing.override_org_platform_fee` — set per-org Layer B override

Default role assignments are defined in the dev spec.

---

## 10. MVP Scope & Boundaries

The MVP is sized to deliver a fully functional end-to-end billing surface — agency configures, client pays, agency sees P&L — without overreach. This section is the "must" / "won't" line.

### MVP must include

- Single payment provider integration (Stripe Connect Standard) behind an abstracted gateway interface
- Two-tier billing model (Synthetos→Org tier extended; Org→Client tier built)
- Three margin layers operational (Layer A per-org override, Layer B mechanism at 0% default, Layer C agency-set pricing)
- Multi-currency support (10 currencies, per-subaccount currency, per-agency reporting currency, FX-aware rollup)
- Client Subscription Plans CRUD (with three default templates)
- Module cascade enforcement (Synthetos plan → Client Plan → subaccount)
- Card capture via processor's hosted checkout
- Customer Portal link for ongoing card/invoice management
- Trial lifecycle (per-plan config, default 14-day card-required)
- Past_due → 7-day grace → suspended → 30-day archive lifecycle
- Comp toggle at both org and subaccount levels
- Annual billing with 20% default discount
- Tax handling via processor's tax product (per-agency toggle)
- Proration on plan changes (default-on, per-change override)
- Permission keys for all billing actions
- Audit log entries for all billing state changes
- P&L dashboard (top-line summary, per-client view, per-client detail, portfolio rollup, secondary cost view)
- CSV export
- Webhook ingestion for subscription, invoice, charge, and Connect events
- 8-tactic onboarding ease implementation
- Test mode end-to-end (agency can configure plans + run a test charge before going live)

### MVP must NOT include

- Multiple payment providers active simultaneously (architecture supports it; only one wired up)
- One-off / variable invoicing (everything is plan-based at MVP)
- Usage-based or metered billing (flat-fee plans only at MVP)
- Custom dunning workflows (use processor's standard retry logic)
- In-app dispute or refund management (initiated through processor dashboard)
- PDF statement export (CSV only)
- White-label of the hosted checkout surface beyond what the processor offers natively
- A quoting / proposal engine
- Accounting integrations (Xero, QuickBooks) — Phase 2+
- Multi-entity agencies (one agency = one processor connection at MVP)
- Per-subaccount additional payment methods (one card/method per subaccount at MVP)
- Cohort / cohort-LTV analysis
- Reseller / sub-agency billing chains (one level of agency-to-client only)

### Explicit boundaries

- **Scope of "client"**: a subaccount with an active Client Subscription Plan. Subaccounts without plans (internal, legacy, or comped) appear in P&L but do not count toward client metrics like ARR or churn.
- **Scope of "revenue"**: only successful, captured charges through the connected payment processor. Off-platform revenue (manual invoices, bank transfers) is out of scope at MVP — agencies that want this in their P&L must wait for the manual revenue entry feature in Phase 2.
- **Scope of "cost"**: Layer A (credits used) + Layer B (platform fee retained) + module licence fees attributable to the subaccount. External costs (the agency's own staff time, third-party tool subscriptions) are out of scope.

---

## 11. Phased Roadmap

The work splits into three phases plus an explicit "out of scope" set. Phase boundaries are about delivering value, not about engineering convenience — Phase 1 alone must be enough for an agency to bill clients and see margin.

### Phase 1 — MVP (this brief)

Everything in section 10's "MVP must include" list. The deliverable is:

- An agency can connect a payment processor account
- An agency can productise their offering into Client Subscription Plans
- An agency can invite a client; the client lands on hosted checkout, enters a card, and a subscription goes live
- The agency sees per-client revenue, cost, and margin in their reporting currency
- Multi-currency works out of the box for the 10 launch currencies
- Trial, past_due, and suspension lifecycles operate without agency intervention
- Synthetos can take a platform fee (mechanism live, value at 0% on launch day)
- All margin layers, currency conversion, and webhooks operate end-to-end in test mode and live mode

### Phase 2 — Operational depth

Extends MVP with the things agencies start asking for once they're using it for real:

- One-off / variable invoicing (custom amounts, ad-hoc charges)
- Manual revenue entry (off-platform revenue surfaces in P&L)
- Accounting integration (Xero / QuickBooks export and reconciliation hooks)
- In-app dispute and refund management surface (still backed by processor)
- PDF statement and invoice export
- Custom dunning workflows (agency-defined retry schedules, escalation paths)
- Per-subaccount additional payment methods (multiple cards, ACH, etc. where supported)
- Cohort and LTV analysis in the P&L dashboard
- Plan migration tooling (move N subaccounts from Plan X to Plan Y in bulk, with notice scheduling)

### Phase 3 — Marketplace & monetisation

The phase that turns the architecture into commercial leverage:

- Synthetos premium plans that include 0% platform fee as a benefit (Layer B becomes a real lever)
- Per-org platform fee experimentation (cohort A/B testing of fee impact on agency adoption)
- Reseller / sub-agency billing chains (sub-agencies billing under a parent agency's processor account, with margin attribution)
- Multiple payment provider integrations active simultaneously (gateway router selects per-subaccount based on currency, region, or agency preference)
- Multi-entity agency support (one agency operates multiple processor connections — useful for legal-entity splits)
- Usage-based / metered billing primitives (per-token, per-run, per-output pricing where an agency wants pass-through pricing)
- Public Plans marketplace (agencies discover / publish productised plan templates)

### Out of scope, indefinitely

Surfaces that would distract from the operations-system positioning and are better solved by purpose-built tools. We integrate with these, we do not rebuild them:

- Full accounting / double-entry ledger (use Xero, QuickBooks)
- CRM / pipeline / deal management (use HubSpot, GHL, etc.)
- Quoting / proposal generation (use PandaDoc, Better Proposals, etc.)
- Tax filing / remittance (use Stripe Tax, Avalara, TaxJar; agency files)
- Time tracking / staff cost attribution (use Harvest, Toggl)
- Customer support ticketing tied to billing (use Intercom, Zendesk)

---

## 12. Success Metrics & Open Decisions

### Success metrics

The MVP succeeds if all four are true within the first 90 days post-launch:

1. **Adoption** — at least 50% of active agencies have configured a Client Subscription Plan and connected a payment processor.
2. **Activation** — at least 30% of those agencies have at least one paying client subscription active in Synthetos.
3. **Time to first revenue** — median time from "agency starts billing setup" to "first successful client charge" is under 60 minutes.
4. **Churn from billing friction** — fewer than 5% of paid client subscriptions cancel within their first billing cycle for reasons attributable to the billing flow itself (card capture failure, unclear pricing, processor onboarding bounce). Tracked via cancellation reason capture.

Secondary metrics that inform iteration:

- Average gross margin % per agency
- Currency mix across the platform (validates whether multi-currency at MVP was the right call)
- Trial → paid conversion rate
- Past_due → recovered vs past_due → suspended ratio
- Number of plan changes per subscription per quarter (signals plan design quality)
- Platform fee revenue (will be $0 at launch by design; tracks the moment Layer B is turned on)

### Open decisions for the dev spec

These are decisions deliberately deferred from the brief to the spec phase. Each is well-bounded — the brief locks the shape, the spec picks the value or the precise behaviour.

| # | Decision | Notes |
|---|----------|-------|
| 1 | FX source provider | OpenExchangeRates vs ECB vs other. Spec picks one based on cost, coverage, SLA, and historical-rate availability. |
| 2 | FX snapshot frequency | Daily is the working assumption; spec confirms or moves to intra-day if needed for high-volume currencies. |
| 3 | Default trial length per template | Working assumption: 14 days for Essentials and Growth, 30 days for Scale. Spec confirms. |
| 4 | Suspended → archived window | Working assumption: 30 days. Spec considers whether this varies by plan tier or stays uniform. |
| 5 | Annual cancellation refund policy default | Working assumption: pro-rated refund. Spec considers whether to default to "no refund" instead. |
| 6 | Permission default role assignments | Brief defines the keys; spec defines which default roles get them. |
| 7 | Notification surface | Spec defines exactly which billing events trigger email vs in-app vs both, and the templates. |
| 8 | Connect onboarding copy | Spec writes the actual UX copy for the 8-tactic onboarding plan. |
| 9 | Reporting currency switching behaviour | Live FX recompute vs cached rollup. Spec balances accuracy vs performance. |
| 10 | Module licence fee model | How modules charge back to the agency (per-subaccount, per-use, flat-tier) — spec defines the contract that modules must implement. |
| 11 | Test-mode boundary | Spec defines exactly what test-mode subaccounts can do (assume: full feature access but no real charges, marked clearly throughout the UI). |
| 12 | Per-org override visibility | Whether agencies see "you have a custom platform fee of X%" in their settings, or whether overrides are silent. Spec decides. |

### Risks to flag at spec time

- **Connect onboarding drop-off** is the single biggest commercial risk. The 8-tactic plan addresses it; spec must validate each tactic with a real Stripe sandbox walk-through before locking the design.
- **FX volatility** can distort short-term P&L. Spec must define how the dashboard handles intra-period FX swings (probably: original-currency primary, reporting-currency secondary, with a clear "FX drift" indicator).
- **Module attribution** is a new contract. Spec must define how a module declares its cost contribution and quota consumption so the P&L can attribute correctly. This is a cross-team contract — module owners need to sign off.
- **Trial-without-card abuse** at scale. Spec considers per-agency cap on simultaneous card-optional trials.
- **Disputes / chargebacks** on Connect transactions hit the agency, not Synthetos — but if they hit at scale, the processor may suspend the connected account. Spec defines the agency-facing surface for visibility into chargeback rate.

---

## 13. Appendix — Terminology & References

### Terminology

| Term | Meaning in this brief |
|------|----------------------|
| **Agency** | The Synthetos org. The buyer of the Synthetos platform and the seller to clients. |
| **Client** | A subaccount that has an active Client Subscription Plan and pays the agency. |
| **Subaccount** | The platform primitive that scopes a client's data, agents, modules, and runs. |
| **Client Subscription Plan** | A productised, priced offer the agency defines and assigns to a client (subaccount). |
| **Module** | A first-class capability unit (ClientPulse, geo-SEO surface, reporting agent, etc.) that can be included in a Client Plan. |
| **Layer A — Credit margin** | Synthetos' margin on the credits it sells to the agency (LLM, IEE compute). |
| **Layer B — Platform fee** | Synthetos' fee on Connect transactions when an agency bills a client. Default 0% at launch. |
| **Layer C — Agency margin** | The agency's margin on what it bills its client, after Layer A and Layer B costs. |
| **Reporting currency** | The single currency the agency picks for portfolio-level P&L rollup. |
| **Subaccount currency** | The single currency a specific client is billed in. |
| **Comp** | A toggle that suppresses charges (at org or subaccount level) but preserves cost tracking. |
| **Past_due** | The 7-day grace state after a charge fails, before the subaccount is suspended. |
| **Suspended** | A read-only state for a subaccount with overdue payment. Only the agency org admin can resolve. |
| **Connect** | The payment processor's marketplace product (Stripe Connect Standard at MVP). The agency has its own connected account; Synthetos orchestrates charges through it. |
| **MRR / ARR** | Monthly / annualised recurring revenue, computed from active and trialing subscriptions. |

### References

| Doc | Why it matters here |
|-----|---------------------|
| [`docs/capabilities.md`](./capabilities.md) | Customer-facing positioning. The Billing & P&L narrative in capabilities must stay aligned with this brief. |
| [`docs/clientpulse-dev-spec.md`](./clientpulse-dev-spec.md) | First module to be billed agency-to-client. Validates the module-cascade contract. |
| [`docs/clientpulse-ghl-dev-brief.md`](./clientpulse-ghl-dev-brief.md) | ClientPulse + GHL integration brief — module-side context. |
| [`docs/improvements-roadmap.md`](./improvements-roadmap.md) | Cross-platform roadmap; spec sequencing should reconcile with this. |
| [`docs/spec-context.md`](./spec-context.md) | Framing ground truth for spec reviews. Read before invoking spec-reviewer on the eventual dev spec. |
| [`architecture.md`](../architecture.md) | Three-tier model, permissions system, services architecture. The new billing surface must obey these conventions. |
| [`server/lib/permissions.ts`](../server/lib/permissions.ts) | Where the new billing permission keys land. |
| [`server/db/schema/`](../server/db/schema/) | Where the new billing tables land (Drizzle schema). |

### Process notes

- This brief is **not** a spec. It captures direction and decisions. Implementation specifics (table schemas, route shapes, service boundaries, test plans) live in the dev spec to be written before build.
- Before the dev spec begins, run it through `spec-reviewer` per the project's spec-review pipeline.
- Before the build begins, run the spec through `architect` for an implementation plan.
- Build is expected to land in feature-coordinator-orchestrated chunks rather than a single monolithic effort.

### Changelog

- 2026-04-15 — Initial brief drafted from discovery sessions covering positioning, two-tier billing, three margin layers, currency strategy, payment architecture, plans & modules, card management, P&L dashboard, operational decisions, MVP scope, phased roadmap, success metrics, and open spec-time decisions.
