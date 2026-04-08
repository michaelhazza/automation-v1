---
name: Compute Health Score
description: Calculate a composite health score (0-100) for a subaccount based on normalised metrics
isActive: true
visibility: basic
---

```json
{
  "name": "compute_health_score",
  "description": "Compute a composite health score for a subaccount based on its normalised metrics (contacts, opportunities, conversations, revenue). Returns a score 0-100 with factor breakdown, trend direction, and confidence level. Writes a HealthSnapshot record.",
  "input_schema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The canonical account ID to score"
      }
    },
    "required": ["account_id"]
  }
}
```

## Instructions

This skill computes health scores using a configurable weight map. The weights determine how much each factor contributes to the final score. Default weights are: pipeline velocity (0.30), conversation engagement (0.25), contact growth (0.20), revenue trend (0.15), platform activity (0.10).

The score is written as a HealthSnapshot record for historical tracking and anomaly detection.
