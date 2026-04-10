---
name: Analyse Financials
description: Analyses revenue and expense data to produce a structured financial summary with key ratios, trend observations, and actionable insights. Methodology skill.
isActive: true
visibility: basic
---

```json
{
  "name": "analyse_financials",
  "description": "Analyse revenue and expense data from read_revenue and read_expenses to produce a structured financial summary. Returns key ratios (gross margin, operating margin, burn rate), trend observations, anomalies, and prioritised recommendations. Used by the Finance Agent before drafting reports.",
  "input_schema": {
    "type": "object",
    "properties": {
      "revenue_data": {
        "type": "string",
        "description": "Structured revenue data from read_revenue — include all figures and period details"
      },
      "expense_data": {
        "type": "string",
        "description": "Structured expense data from read_expenses — include all categories and totals"
      },
      "financial_targets": {
        "type": "string",
        "description": "Target KPIs from workspace memory: target margins, budget ceilings, runway targets"
      },
      "analysis_period": {
        "type": "string",
        "description": "Human-readable period label (e.g. 'Q1 2026', 'March 2026')"
      },
      "workspace_context": {
        "type": "string",
        "description": "Workspace memory: business model (SaaS/services/product), funding stage, known cost drivers, seasonality"
      }
    },
    "required": ["revenue_data", "expense_data"]
  }
}
```

## Instructions

Invoke this skill after both `read_revenue` and `read_expenses` return data for the same period. If either returns a stub response, note data unavailability in the analysis and do not fabricate figures.

Do not invent financial targets if `financial_targets` is not provided — note the absence and apply no benchmark comparisons. Do not extrapolate or project beyond the data provided unless explicitly asked.

## Methodology

### Key Ratios

Compute from the input data where possible:

| Ratio | Formula | Flag if |
|---|---|---|
| Gross Margin | (Revenue - COGS) / Revenue | < 40% for SaaS, < 20% for services |
| Operating Margin | (Revenue - OpEx) / Revenue | Negative |
| Burn Rate | Total Expenses / Period Days × 30 | Runway < 12 months at current burn |
| Revenue Growth | (Current - Prior) / Prior | Negative QoQ |
| OpEx Ratio | OpEx / Revenue | > 80% |

Only compute ratios where the required data fields are present. Mark others as `null — data not available`.

### Trend Observations

For each significant metric:
- Direction (up / down / flat)
- Magnitude (%)
- Context (is this expected? seasonal? anomalous?)

### Anomaly Detection

Flag:
- Any single expense category > 30% of total expenses (concentration risk)
- Revenue decline > 10% vs prior period
- Expense growth > 20% vs prior period without corresponding revenue growth
- Gross margin compression > 5 points vs prior period

### Output Format

```
FINANCIAL ANALYSIS

Period: [analysis_period]
Generated At: [ISO timestamp]
Data Quality: [complete | partial — [list what's missing] | stub — no live data]

## Executive Summary
[3–4 sentences: financial health, biggest positive, biggest concern, one priority action]

## Key Metrics

| Metric | Value | vs Target | vs Prior Period |
|---|---|---|---|
| Revenue | [amount] | [on/over/under target or N/A] | [+/- %] |
| Total Expenses | [amount] | | [+/- %] |
| Gross Margin | [%] | | [+/- pts] |
| Operating Margin | [%] | | |
| Burn Rate | [amount/month] | | |

## Revenue Analysis
[2–3 observations on revenue composition, growth, and concentration]

## Expense Analysis
[2–3 observations on cost structure, largest categories, and trends]

## Anomalies
- [anomaly: description and magnitude]
- [None detected]

## Recommendations
1. [Highest priority action — specific, not generic]
2. [Second priority]

## Caveats
- [Data gaps, assumptions, or limitations]
```

### Quality Checklist

Before returning:
- All ratios are computed from actual data — none fabricated
- Targets marked N/A where not provided
- Anomalies based on thresholds above, not judgment
- Stub data handled: no invented figures
- Recommendations are specific and actionable
