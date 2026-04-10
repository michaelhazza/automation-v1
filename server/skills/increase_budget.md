---
name: Increase Budget
description: Proposes a budget increase for a high-performing campaign. Block-gated — always requires explicit human approval before execution.
isActive: true
visibility: none
---

## Parameters

- platform: enum[google_ads, meta_ads, linkedin_ads] (required) — The ads platform
- campaign_id: string (required) — Campaign ID to increase budget for
- campaign_name: string (required) — Human-readable campaign name — shown in the review item
- current_daily_budget: string (required) — Current daily budget (e.g. '£50/day')
- proposed_daily_budget: string (required) — Proposed new daily budget
- change_percentage: number (required) — Percentage increase (e.g. 20 for +20%)
- performance_evidence: string (required) — Data from analyse_performance justifying the increase: ROAS, CPA, spend cap frequency, conversion volume
- reasoning: string (required) — Full reasoning for the budget increase recommendation — shown to the reviewer

## Instructions

Invoke this skill only when `analyse_performance` returns an `increase_budget` recommendation. The campaign must be hitting its daily budget cap and delivering ROAS or CPA above target.

**This skill is block-gated.** Budget increases directly affect spend. A human must approve every increase — the action will never execute automatically.

**MVP stub:** Platform write APIs not yet connected. On approval, logs the intended change and returns `pending_integration` status.

### Pre-Submission Rules

1. `change_percentage` must not exceed 50% in a single adjustment — larger increases require escalation
2. `performance_evidence` must show the campaign is hitting its budget cap (spend = budget for ≥ 3 of the last 7 days)
3. Include projected additional spend at the proposed budget so the reviewer can assess the financial impact

### Review Item Presentation

1. Campaign name, platform
2. Current budget → proposed budget (% increase)
3. Performance evidence: ROAS/CPA vs target, frequency of budget cap hits
4. Projected additional weekly spend at new budget
5. Full reasoning

### On Approval

1. Update campaign budget via platform integration (stub: log to task activity)
2. Return `{ success: true, platform, campaign_id, new_daily_budget, message }`

### On Rejection

Log the rejection in workspace memory so future analysis cycles have context.
