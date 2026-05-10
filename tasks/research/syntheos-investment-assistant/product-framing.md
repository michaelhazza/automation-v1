# Syntheos as Personal Wealth Intelligence Layer — Product Framing

> Captured: 2026-05-10. Source: positioning discussion in chat (Syntheos investment-assistant exploration). Locks the framing decision so it isn't lost. Companion to `synthesis.md`.

---

## One-paragraph positioning

Syntheos is the **personal financial intelligence layer that sits across the member's entire wealth picture** — their goals (Freedom Planner), their traditional finances (Freedom Finance), their crypto (CryptoTracker), and any other sources they connect (brokerage, real estate, business income, exchange APIs). It is not a trading bot. It is not a robo-adviser. It is a member's plain-English thinking partner about their own money: it explains what's happening, decides what should change, commissions the actions to the right downstream system, and produces the one-page monthly memo that makes "15 minutes a month" an honest promise.

## Naming options (pick later)

- **Freedom Brain** — on-brand for Breakout, ties to Freedom Planner / Freedom Finance lineage.
- **Syntheos** — keep as the umbrella platform name; describe role as "your wealth intelligence layer."
- **Wealth Brain** — generic but immediately understood.
- **Personal CFO** — corporate but accurate; might fit Operator-tier marketing.

## What it is NOT

- Not a trading bot (Senpi/Cryptohopper turf — we don't compete here).
- Not an alpha-generation engine (Alpha Arena showed LLMs lose money trading unsupervised).
- Not a custodian (members keep their own keys, accounts, and bank login).
- Not a robo-adviser (no performance fees, no forward return promises, no managed-money posture).
- Not a replacement for CryptoTracker / Freedom Finance / Freedom Planner — it sits *on top* of them.

## Member experience — the 15-minute monthly ritual

1. Member opens Syntheos. Sees one-page memo: where they are vs the Freedom Plan, what changed this month, what the agents recommend changing next.
2. Approves or tweaks the recommendations (one click each).
3. Optional: ask the chat any question. "Can I take three months off next year?" "Should I buy more SOL?" "How am I tracking?"
4. Closes the app. Done.

Between visits, Syntheos is running quietly: monitoring positions, harvesting yields via CryptoTracker, watching for events, journaling everything, escalating on anything out-of-band via Telegram or email.

## Canonical data model (plain English)

One unified picture per member, stitched from multiple sources:

| Layer | Holds | Source |
|---|---|---|
| **Goals** | Target income, target net worth, target retirement age, lifestyle blueprint | Freedom Planner |
| **Net worth & cash flows** | Bank balances, salary, spending, debts, savings rate | Freedom Finance (Plaid/Yodlee under the hood) |
| **Crypto positions** | Holdings, cost basis, yields, risk exposure | CryptoTracker |
| **Brokerage / equities** | Stock holdings, dividends, cap gains | SnapTrade or similar (later) |
| **Real estate / business** | Property values, rental income, business cash flow | Manual or external API (later) |
| **Plan progress** | Where you are vs where you said you'd be | Computed by Syntheos |

Every agent reasons against this single model. New data sources add adapters; the model stays canonical.

## Three-layer architecture

1. **Canonical model** — one schema, one source of truth per member. App-specific data flows in via adapters.
2. **Intelligence layer (Syntheos agents)** — Plan Tracker, Cash Flow Analyst, Risk Monitor, Cross-Portfolio Coordinator, Memo Author, Chat Concierge. They reason; they don't execute.
3. **Action layer** — agents *commission* actions to the right executor: CryptoTracker (deterministic crypto rules), Freedom Finance (savings nudges, alerts), Freedom Planner (plan adjustments), external systems where applicable.

Member talks to Syntheos. Syntheos talks to the rest. The member never has to log into five apps.

## Why this beats every alternative

- **vs Senpi / Hyperliquid bots:** they see one execution venue; we see the whole life. Different product.
- **vs Cleo / Rocket Money / generic AI finance assistants:** they don't have the Freedom Planner. They can't say "you're 3 months behind your $15k/mo target — here's what to change." We can.
- **vs deterministic CryptoTracker alone:** CryptoTracker is the executor's hand; Syntheos is the brain that decides what to do. Together they're stronger; alone, neither is the product.
- **vs a competitor trying to copy this:** they'd have to first build the Planner + the Finance app + the Tracker. Owning the upstream apps is the moat.

## Staged build path

### Stage 1 — Two-source MVP (target: 6–10 weeks, one engineer)
Sources: Freedom Planner + CryptoTracker only.
Output: Weekly portfolio memo + chat + plan-vs-reality dashboard.
No bank integration yet (avoids Plaid/SOC2 lift on day one).
Goal: prove the experience with the easiest two sources.

### Stage 2 — Three-source v1 (target: +6 weeks)
Add Freedom Finance. Now Syntheos sees full net worth and cash flow.
Adds: cross-portfolio risk view, tax-aware coordination, savings-rate-vs-plan tracking.
Goal: the full "$15k/mo trajectory" experience for members who already have capital deployed.

### Stage 3 — External integrations (target: rolling, member-driven)
Brokerage (SnapTrade), exchange APIs, real estate, manual business income.
Each integration earns trust; member chooses when to add each.

### Stage 4 — Action layer hardening
Syntheos starts commissioning actions to CryptoTracker (rule changes), Freedom Finance (savings rules), and external execution (only if the member has approved the strategy).
Approval gate stays mandatory throughout.

### Stage 5 — Optional Operator tier
Managed templates, weekly strategy briefs, priority support. Higher price point. Council-tier co-design.
Defer until Stage 1–3 are validated.

## Honest constraints

- **Bank integration is a real security lift.** Plaid + SOC2-type posture. Plan for it.
- **Trust gradient.** Members will hesitate to connect everything at once. Staged onboarding earns trust.
- **Regulatory posture.** Software + education only. No performance fees. No forward return claims. Backward-looking journals only. Lawyer call (AU FinTech specialist) before public pricing.
- **Scope discipline.** The vision sprawls easily. Stage 1 has to ship narrow and good before anything else is built.
- **Cost economics.** Multi-agent reasoning at 24/7 scale is not free. Build a real cost model before any unmetered tier.

## What we're NOT building

- Latency-sensitive arbitrage / market-making (wrong tool).
- Pure quant ML strategy generation (LLMs lose to gradient-boosted models on tabular data).
- A Senpi competitor on Hyperliquid execution (different ICP).
- A custodial product (regulatory tripwire).
- An "AI that promises returns" product (legal and reputational risk).

## How this changes the Breakout pitch

**Old:** "$15k/mo income with <15 min/mo of work."

**New (honest, deliverable):** "Once you've built your capital — through your business, your salary, your investments — Syntheos runs it on autopilot. Yield, risk, rebalancing, taxes, and the plan-vs-reality tracking all happen automatically. You spend 15 minutes a month reviewing the memo and approving the next moves. The income is real because the capital is real and the discipline is automated."

Syntheos is the back end of the $15k/mo promise, not the front end. Whatever income engine Breakout already teaches brings the capital. Syntheos compounds it disciplined-ly with almost no member time.

## Open questions

1. Naming — Freedom Brain vs Syntheos vs other?
2. Bank integration partner — Plaid (US-strong), Basiq (AU-strong), Yodlee, SnapTrade for brokerage?
3. Data residency / privacy posture — what jurisdiction does the canonical model live in, and how is it encrypted at rest?
4. Default Stage 1 sources for the MVP — Planner + CryptoTracker confirmed, or swap in Finance instead?
5. Pricing — flat subscription tier, or graduated (Founder / Operator / Council)?
6. Whether Stage 4 actioning is opt-in per action, opt-in per category, or session-based.
7. Lawyer call timeline — before Stage 1 ships or before Stage 2?

## Suggested next artefact

A 6–10-week feature spec for **Stage 1 MVP** — Freedom Planner + CryptoTracker integration, weekly memo, chat, plan-vs-reality dashboard. Written for the existing Syntheos build pipeline so an engineer can pick it up immediately.
