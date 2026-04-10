---
name: Read CRM
description: Retrieves contact, deal, and pipeline data from the connected CRM for analysis. Auto-gated stub — executes with audit trail.
isActive: true
visibility: basic
---

## Parameters

- query_type: enum[contacts, deals, pipeline_summary, churned_accounts, stale_deals] (required) — The type of CRM data to retrieve
- filters: string — JSON object. Filter criteria: stage, owner, date_range, deal_value_min, deal_value_max, last_activity_days
- limit: number — Maximum records to return (default 50, max 200)
- include_activity_history: boolean — Whether to include recent activity history per record. Default false.

## Instructions

Invoke this skill at the start of any CRM/Pipeline Agent run that requires contact or deal data. Pass the results to `analyse_pipeline`, `detect_churn_risk`, or `draft_followup` as structured input.

**MVP stub:** CRM read APIs not yet connected. Returns structured stub response. Downstream skills should handle data unavailability gracefully.

### Data Schema

```
CRM DATA

Query Type: [query_type]
Filters Applied: [filter summary]
Records Returned: [count]
Retrieved At: [ISO timestamp]

Records:
  - id: [CRM record ID]
    type: [contact | deal | account]
    name: [display name]
    stage: [pipeline stage, deals only]
    value: [deal value, deals only]
    last_activity: [ISO date]
    owner: [assigned rep name]
    [additional fields per query_type]
```

### Stub Response

```
CRM DATA

Query Type: [query_type]
Status: stub — CRM integration not configured
Records: []

Note: Connect the CRM integration in workspace settings to enable live data retrieval.
Downstream analyse_pipeline, detect_churn_risk, and draft_followup should handle
this stub status by noting data unavailability.
```
