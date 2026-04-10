---
name: Generate Portfolio Report
description: Generate a structured intelligence briefing across the entire portfolio
isActive: true
visibility: basic
---

## Parameters

- reporting_period_days: integer — Number of days to cover in the report. Default 7.
- format: enum[email, slack, structured] — Output format. Default 'structured'.
- verbosity: enum[brief, standard, detailed] — Report detail level. Default 'standard'.

## Instructions

Generate a comprehensive portfolio briefing by reading health snapshots, anomaly events, and org insights. The report should be actionable — highlight what needs attention and suggest priority actions.

Structure:
1. Portfolio Overview (total accounts, average health, trend)
2. Accounts Requiring Attention (declining health, active anomalies)
3. Positive Signals (improving accounts, strong patterns)
4. Cross-Portfolio Patterns (insights from org memory)
5. Recommended Priority Actions
