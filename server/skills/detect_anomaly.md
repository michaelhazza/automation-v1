---
name: Detect Anomaly
description: Compare current metrics against historical baseline and flag significant deviations
isActive: true
visibility: basic
---

```json
{
  "name": "detect_anomaly",
  "description": "Compare a current metric value for a subaccount against its historical baseline and identify statistically significant deviations. Writes an AnomalyEvent record if anomaly detected.",
  "input_schema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The canonical account ID to check"
      },
      "metric_name": {
        "type": "string",
        "description": "The metric to check (e.g. 'health_score', 'contact_growth', 'pipeline_value')"
      },
      "current_value": {
        "type": "number",
        "description": "The current value of the metric"
      }
    },
    "required": ["account_id", "metric_name", "current_value"]
  }
}
```

## Instructions

Compares the current value against a rolling baseline from historical snapshots. Baselines are per-account — each account is compared to its own history, not to portfolio averages. The sensitivity threshold is configurable per organisation.
