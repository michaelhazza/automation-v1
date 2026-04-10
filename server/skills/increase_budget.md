---
name: Increase Budget
description: Proposes a budget increase for a high-performing campaign. Block-gated — always requires explicit human approval before execution.
isActive: true
visibility: none
---

```json
{
  "name": "increase_budget",
  "description": "Propose a budget increase for a high-performing campaign on the connected ads platform. This is a block-gated action — it ALWAYS enters the approval queue and is NEVER executed automatically. A human must explicitly approve before spend limits are raised.",
  "input_schema": {
    "type": "object",
    "properties": {
      "platform": {
        "type": "string",
        "enum": ["google_ads", "meta_ads", "linkedin_ads"],
        "description": "The ads platform"
      },
      "campaign_id": {
        "type": "string",
        "description": "Campaign ID to increase budget for"
      },
      "campaign_name": {
        "type": "string",
        "description": "Human-readable campaign name — shown in the review item"
      },
      "current_daily_budget": {
        "type": "string",
        "description": "Current daily budget (e.g. '£50/day')"
      },
      "proposed_daily_budget": {
        "type": "string",
        "description": "Proposed new daily budget"
      },
      "change_percentage": {
        "type": "number",
        "description": "Percentage increase (e.g. 20 for +20%)"
      },
      "performance_evidence": {
        "type": "string",
        "description": "Data from analyse_performance justifying the increase: ROAS, CPA, spend cap frequency, conversion volume"
      },
      "reasoning": {
        "type": "string",
        "description": "Full reasoning for the budget increase recommendation — shown to the reviewer"
      }
    },
    "required": ["platform", "campaign_id", "campaign_name", "current_daily_budget", "proposed_daily_budget", "change_percentage", "performance_evidence", "reasoning"]
  }
}
```

## Instructions

Invoke this skill only when `analyse_performance` returns an `increase_budget` recommendation. The campaign must be hitting its daily budget cap and delivering ROAS or CPA above target.

**This skill is block-gated.** Budget increases directly affect spend. A human must approve every increase — the action will never execute automatically.

**MVP stub:** Platform write APIs not yet connected. On approval, logs the intended change and returns `pending_integration` status.

## Methodology

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
