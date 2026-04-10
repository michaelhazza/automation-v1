---
name: Pause Campaign
description: Proposes pausing a campaign on the connected ads platform. Block-gated — always requires explicit human approval before execution.
isActive: true
visibility: none
---

## Parameters

- platform: enum[google_ads, meta_ads, linkedin_ads] (required) — The ads platform
- campaign_id: string (required) — Campaign ID to pause
- campaign_name: string (required) — Human-readable campaign name — shown in the review item
- pause_reason: enum[underperformance, budget_exhausted, campaign_ended, manual_override] (required) — The reason for pausing
- performance_evidence: string (required) — Data from analyse_performance that justifies the pause: specific metrics, thresholds exceeded, duration of underperformance
- reasoning: string (required) — Full reasoning for the pause recommendation — shown to the reviewer alongside the performance evidence

## Instructions

Invoke this skill only when `analyse_performance` returns a `pause` recommendation. Always include the performance evidence — the reviewer must be able to verify the data before approving an irreversible action.

**This skill is block-gated.** The action enters the approval queue with `defaultGateLevel: 'block'`. It will never execute automatically regardless of agent permission settings. A human must approve every pause.

Pausing a campaign stops all spend and impression delivery immediately. This is a significant action — underscore the performance evidence clearly so the reviewer can validate it quickly.

**MVP stub:** Platform write APIs not yet connected. On approval, the executor logs the intended pause and returns `pending_integration` status.

### Pre-Submission Rules

1. `performance_evidence` must reference specific metrics and time periods — not vague assessments
2. Never propose a pause for a campaign without data from `analyse_performance`
3. Include the current daily budget in the reasoning so the reviewer understands the cost implication of leaving it running

### Review Item Presentation

1. Campaign name, platform, campaign ID
2. Pause reason
3. Performance evidence: the specific metrics that crossed the pause threshold
4. Current daily budget (cost of leaving running)
5. Full reasoning

### On Approval

1. Pause campaign via platform integration (stub: log to task activity)
2. Return `{ success: true, platform, campaign_id, paused: true, message }`

### On Rejection

The campaign continues to run. Log the rejection in workspace memory so future analysis cycles include this context (e.g. "human declined pause on [date], reason: [feedback]").
