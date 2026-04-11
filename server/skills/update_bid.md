---
name: Update Bid
description: Proposes a bid adjustment for a campaign or ad group on the connected ads platform. Review-gated — requires human approval before the change is applied.
isActive: true
visibility: basic
---

## Parameters

- platform: enum[google_ads, meta_ads, linkedin_ads] (required) — The ads platform
- campaign_id: string (required) — Campaign ID to adjust the bid for
- campaign_name: string (required) — Human-readable campaign name — shown in the review item
- ad_group_id: string — Optional: ad group ID if adjusting at ad group level rather than campaign level
- current_bid: string (required) — Current bid or target CPA/ROAS value (e.g. '£2.50 CPC', 'Target CPA: £45', 'Target ROAS: 3.5×')
- proposed_bid: string (required) — Proposed new bid or target value (same format as current_bid)
- change_direction: enum[increase, decrease] (required) — Whether this is an increase or decrease
- change_percentage: number (required) — Percentage change (e.g. 15 for +15% or -15%)
- reasoning: string (required) — Why this bid change is recommended — data-driven rationale from analyse_performance. Shown to the reviewer.

## Instructions

Invoke this skill only after `analyse_performance` has produced a recommendation for a bid adjustment. Always include the performance reasoning — the reviewer must be able to approve or reject with full context.

This is a review-gated action. The change enters the HITL approval queue. A human reviews the proposed change, rationale, and impact before it is applied to the platform.

**MVP stub:** The ads platform write APIs are not yet connected. On approval, the executor logs the intended change and returns `pending_integration` status. When integrations are live, the approved bid is submitted to the platform.

On rejection: read the feedback and decide whether to re-propose with adjusted parameters or surface the rejection to the requesting agent.

### Pre-Submission Rules

1. The `change_percentage` must not exceed 50% in a single adjustment — larger changes require human escalation via `request_approval`
2. The `proposed_bid` must be derived from the performance data — do not invent bid values
3. Include the performance metric that justifies the change (e.g. "CPA is 2.1× target over 7 days")
4. Never propose a bid increase for a campaign flagged as `pause`-tier by `analyse_performance`

### Review Item Presentation

The review item shows:
1. Campaign name and platform
2. Current vs proposed bid (with % change and direction)
3. Performance context: the metric and threshold that triggered this recommendation
4. The reasoning from `analyse_performance`
5. Expected impact (qualitative — e.g. "reduce spend, improve CPA efficiency")

### On Approval

1. Submit the bid change to the platform integration (stub: log to task activity)
2. Return `{ success: true, platform, campaign_id, bid_change_applied, new_bid, message }`

### On Rejection

Return rejection feedback to the calling agent so it can:
- Re-analyse with the feedback incorporated
- Propose a more conservative change
- Escalate to human decision-making
