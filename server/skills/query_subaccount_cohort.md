---
name: Query Subaccount Cohort
description: Read board health and memory summaries across multiple subaccounts, filtered by tags
isActive: true
visibility: basic
---

## Parameters

- tag_filters: string — JSON array of objects, each with keys: "key" (string), "value" (string). Filter subaccounts by these tags (AND logic — all must match). Empty array returns all subaccounts.
- subaccount_ids: string — JSON array of string values. Explicit subaccount IDs to include (alternative to tag_filters)
- metric_focus: enum[all, health, activity, pipeline] — Focus area for metrics. Defaults to 'all'.

## Instructions

This skill provides a portfolio-level view across subaccounts. Use it to monitor health across the organisation's subaccount portfolio, identify patterns, and detect issues.

Key constraints:
- This skill only works in org-level execution context (subaccountId is null)
- Returns aggregated summaries, not raw client data
- Respects allowedSubaccountIds from org agent config if set
