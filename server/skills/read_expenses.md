---
name: Read Expenses
description: Retrieves expense data from the connected accounting system for a specified period. Returns categorised expense figures for downstream financial analysis.
isActive: true
visibility: basic
---

## Parameters

- date_from: string (required) — Start date in ISO 8601 format (YYYY-MM-DD)
- date_to: string — End date in ISO 8601 format (YYYY-MM-DD). Defaults to today.
- categories: string — JSON array of string values. Optional list of expense categories to filter by (e.g. ['payroll', 'marketing', 'infrastructure']). If omitted, returns all categories.
- include_comparison: boolean — Whether to include period-over-period comparison. Default false.
- currency: string — ISO 4217 currency code. Defaults to workspace default currency.

## Instructions

Invoke this skill alongside `read_revenue` before calling `analyse_financials`. Both data sets should cover the same date range.

**MVP stub:** Accounting system integration not yet connected. Returns structured stub response.

### Data Schema

```
EXPENSE DATA

Period: [date_from] to [date_to]
Currency: [currency]
Retrieved At: [ISO timestamp]

Total Expenses: [amount]

Categories:
  - [category]: [amount] ([% of total])

Period Comparison: [if include_comparison=true]
  Prior Period: [date range]
  Prior Expenses: [amount]
  Change: [+/- amount] ([+/- %])
```

### Stub Response

```
EXPENSE DATA

Status: stub — accounting integration not configured
Period: [date_from] to [date_to]

Note: Connect the accounting integration to enable expense retrieval.
```
