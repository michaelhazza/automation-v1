---
name: Generate Portfolio Report
description: Generate a structured intelligence briefing across the entire portfolio
isActive: true
---

```json
{
  "name": "generate_portfolio_report",
  "description": "Generate a structured portfolio intelligence briefing covering: overall health summary, accounts needing attention, negative trends, positive patterns, and priority actions. Formatted for email or Slack delivery.",
  "input_schema": {
    "type": "object",
    "properties": {
      "reporting_period_days": {
        "type": "integer",
        "description": "Number of days to cover in the report. Default 7."
      },
      "format": {
        "type": "string",
        "enum": ["email", "slack", "structured"],
        "description": "Output format. Default 'structured'."
      },
      "verbosity": {
        "type": "string",
        "enum": ["brief", "standard", "detailed"],
        "description": "Report detail level. Default 'standard'."
      }
    }
  }
}
```

## Instructions

Generate a comprehensive portfolio briefing by reading health snapshots, anomaly events, and org insights. The report should be actionable — highlight what needs attention and suggest priority actions.

Structure:
1. Portfolio Overview (total accounts, average health, trend)
2. Accounts Requiring Attention (declining health, active anomalies)
3. Positive Signals (improving accounts, strong patterns)
4. Cross-Portfolio Patterns (insights from org memory)
5. Recommended Priority Actions
