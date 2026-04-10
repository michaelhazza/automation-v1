---
name: Read Revenue
description: Retrieves revenue data from the connected accounting or billing system for a specified period. Returns structured revenue figures for downstream financial analysis.
isActive: true
visibility: basic
---

```json
{
  "name": "read_revenue",
  "description": "Retrieve revenue data from the connected accounting or billing system for a specified period. Returns total revenue, breakdown by product/service line, and period-over-period comparison. Used by the Finance Agent before running financial analysis.",
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
      "breakdown_by": {
        "type": "string",
        "enum": ["product", "customer", "channel", "geography", "none"],
        "description": "How to break down the revenue data. Default 'none' returns total only."
      },
      "include_comparison": {
        "type": "boolean",
        "description": "Whether to include period-over-period comparison (same period last year/quarter). Default false."
      },
      "currency": {
        "type": "string",
        "description": "ISO 4217 currency code (e.g. GBP, USD). Defaults to workspace default currency."
      }
    },
    "required": ["date_from"]
  }
}
```

## Instructions

Invoke this skill at the start of any Finance Agent run that requires revenue data. Pass the results to `analyse_financials` along with expense data.

**MVP stub:** The accounting/billing system integration is not yet connected. Returns a structured stub response so downstream skills handle data unavailability gracefully.

Validate date range before returning. `date_from` must not be in the future. `date_to` must be >= `date_from`.

## Methodology

### Data Schema

```
REVENUE DATA

Period: [date_from] to [date_to]
Currency: [currency]
Breakdown: [breakdown_by]
Retrieved At: [ISO timestamp]

Total Revenue: [amount]
Recurring Revenue: [amount or null]
One-time Revenue: [amount or null]

Breakdown: [if breakdown_by != 'none']
  - [dimension]: [amount] ([% of total])

Period Comparison: [if include_comparison=true]
  Prior Period: [date range]
  Prior Revenue: [amount]
  Change: [+/- amount] ([+/- %])
```

### Stub Response

```
REVENUE DATA

Status: stub — accounting/billing integration not configured
Period: [date_from] to [date_to]

Note: Connect the accounting integration in workspace settings to enable
live revenue retrieval. Downstream analyse_financials will note data unavailability.
```
