---
name: Analyse Performance
description: Analyses campaign performance data to surface insights, identify underperformers, flag anomalies, and produce actionable recommendations. Methodology skill — takes structured campaign data as input and returns a structured analysis.
isActive: true
visibility: basic
---

```json
{
  "name": "analyse_performance",
  "description": "Analyse campaign performance data from read_campaigns to surface insights, identify underperformers, and produce ranked recommendations. Returns a structured analysis with trend observations, anomaly flags, and prioritised actions (bid adjustments, budget reallocations, copy tests, or pauses).",
  "input_schema": {
    "type": "object",
    "properties": {
      "campaign_data": {
        "type": "string",
        "description": "Structured campaign data output from read_campaigns — include all metrics, spend, and status fields"
      },
      "performance_targets": {
        "type": "string",
        "description": "Target KPIs from workspace memory: target CPA, target ROAS, CTR benchmarks, budget ceilings per campaign"
      },
      "analysis_period": {
        "type": "string",
        "description": "Human-readable period being analysed (e.g. 'last 7 days', 'Q1 2026') for report headers"
      },
      "workspace_context": {
        "type": "string",
        "description": "Workspace memory: active campaigns, recent changes (bids, copy, budget), known seasonality"
      }
    },
    "required": ["campaign_data"]
  }
}
```

## Instructions

Invoke this skill after `read_campaigns` returns data. Pass the raw campaign data directly — do not summarise before passing. The analysis drives downstream actions (`update_bid`, `update_copy`, `pause_campaign`, `increase_budget`).

If `campaign_data` contains a stub response (integration not configured), return a structured stub-aware analysis noting that no data is available — do not fabricate performance insights.

Do not make bid or budget recommendations that would exceed the ceilings in `performance_targets`. If targets are not provided, note this in the caveats section and apply conservative defaults.

## Methodology

### Analysis Framework

For each campaign in the data:

1. **Status check**: Is the campaign active, paused, or in draft? Flag any campaigns that should be active but are paused.

2. **Spend pacing**: Is the campaign on track to spend its budget by period end? Flag underspend (< 80% of expected daily pace) and overspend (> 110%).

3. **CTR analysis**: Compare to benchmark. Flag CTR < 1% on display/social, < 3% on search as underperforming.

4. **Conversion efficiency**: Compare CPA to target. Flag campaigns where CPA > 1.5× target as high-priority review. Flag campaigns where ROAS < target threshold.

5. **Anomaly detection**: Sudden drops or spikes (> 20% day-over-day change) in impressions, CTR, or conversion rate. Flag these for investigation before making changes.

### Recommendation Tiers

| Tier | Trigger | Recommended Action |
|---|---|---|
| `pause` | CPA > 3× target AND no conversions in 7 days | `pause_campaign` |
| `reduce_bid` | CPA > 1.5× target, conversions exist but inefficient | `update_bid` (reduce) |
| `increase_budget` | ROAS > 2× target, spend capped below daily budget | `increase_budget` |
| `test_copy` | CTR < benchmark for 5+ days | `draft_ad_copy` + `update_copy` |
| `monitor` | Within target range, no anomalies | No action — continue monitoring |

### Output Format

```
PERFORMANCE ANALYSIS

Period: [analysis_period]
Campaigns Analysed: [count]
Generated At: [ISO timestamp]

## Executive Summary
[2-3 sentences: overall health, biggest opportunity, biggest risk]

## Campaign Breakdown

### [Campaign Name] (ID: [id])
Status: [active | paused | ...]
Spend: [amount] / [budget] ([% of budget])
CTR: [%] vs benchmark [%] → [above/below/at benchmark]
CPA: [amount] vs target [amount] → [on-target/over/under]
ROAS: [value] vs target [value]
Recommendation: [tier] — [specific action]

[Repeat for each campaign]

## Anomalies
- [Campaign]: [metric] changed [+/-N%] day-over-day — investigate before adjusting
- [No anomalies detected]

## Ranked Actions
1. [Highest priority] — [campaign name] — [action type] — [rationale]
2. ...

## Caveats
- [Any missing data, stub responses, or assumptions]
- [Any targets not provided — conservative defaults applied]
```

### Quality Checklist

Before returning:
- Every recommendation is grounded in the campaign data — no fabricated metrics
- Anomaly flags are based on data thresholds, not assumptions
- Recommendations stay within stated budget ceilings
- Stub data response is handled gracefully (no invented insights)
- CPA and ROAS calculations are consistent with the input data
