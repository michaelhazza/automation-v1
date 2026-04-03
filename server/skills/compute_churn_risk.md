---
name: Compute Churn Risk
description: Evaluate churn risk signals for a subaccount and produce a risk score with intervention recommendation
isActive: true
---

```json
{
  "name": "compute_churn_risk",
  "description": "Evaluate behavioural signals for a subaccount and produce a churn risk score (0-100) with primary risk drivers and recommended intervention type.",
  "input_schema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The canonical account ID to evaluate"
      }
    },
    "required": ["account_id"]
  }
}
```

## Instructions

Uses a heuristic scoring model with configurable weights. Evaluates: declining health score trajectory, consecutive missed milestones, pipeline stagnation duration, conversation engagement decline, and revenue trend. The architecture supports future ML model replacement without interface changes.

Risk levels:
- 0-25: Low risk
- 26-50: Moderate — early warning
- 51-75: High — active intervention recommended
- 76-100: Critical — urgent escalation
