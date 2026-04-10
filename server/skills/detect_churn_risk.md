---
name: Detect Churn Risk
description: Analyses account health signals from CRM data to identify at-risk accounts and assign churn risk scores. Returns a prioritised list of accounts requiring intervention.
isActive: true
visibility: basic
---

## Parameters

- account_data: string (required) — CRM account/contact data from read_crm — include last activity dates, support ticket count, payment status, usage signals if available
- churn_indicators: string — Workspace memory: known churn signals for this business (e.g. 'no login in 30 days', 'support tickets > 3 in 30 days', 'missed payment')
- account_tier: string — Optional: filter to specific account tier (enterprise, mid-market, SMB)
- workspace_context: string — Workspace memory: product, customer success context, known at-risk accounts from prior analyses

## Instructions

Invoke this skill after `read_crm` returns account data. If the CRM returns stub data, note unavailability and do not fabricate risk assessments.

Do not assign HIGH risk without at least 2 supporting signals. A single missed touch point is not sufficient to classify an account as high churn risk.

### Risk Signal Categories

**Engagement signals (negative):**
- No login / product access in > 30 days
- Support tickets > 3 in the last 30 days
- Decreasing usage trend over 60 days
- No activity from the primary contact in > 21 days

**Commercial signals (negative):**
- Missed payment or overdue invoice
- Downgrade request or pricing conversation
- Contract renewal approaching (< 60 days) with no renewal discussion started

**Relationship signals (negative):**
- Champion contact departed
- No QBR or success call scheduled
- Multiple unresolved support escalations

### Risk Scoring

| Level | Criteria |
|---|---|
| `critical` | 3+ signals OR any commercial signal + 1 engagement signal |
| `high` | 2 signals from different categories |
| `medium` | 1–2 signals from the same category |
| `low` | Single engagement signal, no commercial or relationship flags |
| `healthy` | No signals present |

### Output Format

```
CHURN RISK ANALYSIS

Generated At: [ISO timestamp]
Accounts Analysed: [count]
At-Risk Accounts: [count]

## Summary

[2-3 sentences: overall retention health, highest priority account, recommended focus]

## At-Risk Accounts

### [Account Name]
Risk Level: [critical | high | medium | low]
Signals:
  - [signal: specific detail]
  - [signal: specific detail]
Recommended Intervention: [specific action — draft_followup, schedule_csm_call, escalate]

[Repeat for each at-risk account, highest risk first]

## Healthy Accounts: [count]

[List names only]

## Caveats

- [Data gaps, assumptions, stub handling]
```

### Quality Checklist

Before returning:
- Every risk level is supported by signals from the data — no judgment-based scoring
- `critical` accounts have 3+ signals or the required combination
- Recommended interventions are specific and actionable
- Stub data handled: no invented risk assessments
