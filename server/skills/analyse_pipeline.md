---
name: Analyse Pipeline
description: Analyses CRM pipeline data to surface velocity metrics, stage conversion rates, stale deals, and forecast accuracy. Returns a structured pipeline health report with ranked actions.
isActive: true
visibility: basic
---

## Parameters

- pipeline_data: string (required) — Structured CRM data from read_crm — include all deal records, stages, values, and activity dates
- pipeline_targets: string — Target pipeline KPIs from workspace memory: target close rate, average sales cycle, target pipeline value
- analysis_period: string — Human-readable period being analysed
- workspace_context: string — Workspace memory: sales process stages, typical deal sizes, known seasonal patterns, team context

## Instructions

Invoke this skill after `read_crm` returns pipeline data. If the CRM returns a stub response, note data unavailability and do not fabricate pipeline metrics.

### Metrics to Compute

| Metric | Description |
|---|---|
| Total pipeline value | Sum of all open deal values |
| Weighted pipeline | Sum of (value × stage_probability) |
| Deal count by stage | Count of deals in each pipeline stage |
| Average days in stage | Mean days deals have been in current stage |
| Stale deals | Deals with no activity in > 14 days |
| Win rate | Closed-won / (Closed-won + Closed-lost) for the period |
| Average sales cycle | Mean days from creation to close for won deals |

### Stale Deal Detection

A deal is stale when:
- No activity (email, call, meeting, note) in > 14 days AND
- Close date is within 30 days, OR
- Deal has been in the same stage for > 21 days

### Output Format

```
PIPELINE ANALYSIS

Period: [analysis_period]
Generated At: [ISO timestamp]
Data Quality: [complete | stub — no live data]

## Executive Summary

[3–4 sentences: pipeline health, close date forecast, biggest risk]

## Key Metrics

| Metric | Value | Target | Status |
|---|---|---|---|
| Total Pipeline Value | [amount] | [target or N/A] | [on-track/at-risk/N/A] |
| Weighted Pipeline | [amount] | | |
| Win Rate | [%] | | |
| Avg Sales Cycle | [days] | | |

## Stage Breakdown

[Table of stage → deal count, total value, avg days in stage]

## Stale Deals ([count])

- [Deal Name] — [stage] — [days since last activity] — Owner: [name]

## Ranked Actions

1. [Follow up on specific stale deal] — [rationale]
2. [Stage coaching needed for X deals stuck in Y stage]

## Caveats

- [Data gaps, assumptions]
```

### Quality Checklist

Before returning:
- All metrics computed from actual data — none fabricated
- Stale deals identified by the criteria above, not by judgment
- Stub response handled: no invented figures
- Ranked actions reference specific deals, not generic advice
