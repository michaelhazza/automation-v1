---
name: Read Expenses
description: Retrieves expense data from the connected accounting system for a specified period. Returns categorised expense figures for downstream financial analysis.
isActive: true
visibility: basic
---

```json
{
  "name": "read_expenses",
  "description": "Retrieve expense data from the connected accounting system for a specified period. Returns total expenses broken down by category, with optional period-over-period comparison. Used by the Finance Agent alongside read_revenue before running financial analysis.",
  "input_schema": {
    "type": "object",
    "properties": {
      "date_from": {
        "type": "string",
        "description": "Start date in ISO 8601 format (YYYY-MM-DD)"
      },
      "date_to": {
        "type": "string",
        "description": "End date in ISO 8601 format (YYYY-MM-DD). Defaults to today."
      },
      "categories": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Optional list of expense categories to filter by (e.g. ['payroll', 'marketing', 'infrastructure']). If omitted, returns all categories."
      },
      "include_comparison": {
        "type": "boolean",
        "description": "Whether to include period-over-period comparison. Default false."
      },
      "currency": {
        "type": "string",
        "description": "ISO 4217 currency code. Defaults to workspace default currency."
      }
    },
    "required": ["date_from"]
  }
}
```

## Instructions

Invoke this skill alongside `read_revenue` before calling `analyse_financials`. Both data sets should cover the same date range.

**MVP stub:** Accounting system integration not yet connected. Returns structured stub response.

## Methodology

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
