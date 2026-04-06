---
name: Query Subaccount Cohort
description: Read board health and memory summaries across multiple subaccounts, filtered by tags
isActive: true
---

```json
{
  "name": "query_subaccount_cohort",
  "description": "Read aggregated board health and memory summaries across multiple subaccounts in the organisation. Filter by user-defined tags (e.g. vertical, region, tier). Returns summaries and metrics — not raw subaccount data. Only available to org-level agents.",
  "input_schema": {
    "type": "object",
    "properties": {
      "tag_filters": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "key": { "type": "string", "description": "Tag key (e.g. 'vertical', 'region')" },
            "value": { "type": "string", "description": "Tag value (e.g. 'dental', 'northeast')" }
          },
          "required": ["key", "value"]
        },
        "description": "Filter subaccounts by these tags (AND logic — all must match). Empty array returns all subaccounts."
      },
      "subaccount_ids": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Explicit subaccount IDs to include (alternative to tag_filters)"
      },
      "metric_focus": {
        "type": "string",
        "enum": ["all", "health", "activity", "pipeline"],
        "description": "Focus area for metrics. Defaults to 'all'."
      }
    }
  }
}
```

## Instructions

This skill provides a portfolio-level view across subaccounts. Use it to monitor health across the organisation's subaccount portfolio, identify patterns, and detect issues.

Key constraints:
- This skill only works in org-level execution context (subaccountId is null)
- Returns aggregated summaries, not raw client data
- Respects allowedSubaccountIds from org agent config if set
