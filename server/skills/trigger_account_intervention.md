---
name: Trigger Account Intervention
description: Propose an intervention action for a subaccount — always HITL-gated
isActive: true
visibility: basic
---

```json
{
  "name": "trigger_account_intervention",
  "description": "Propose an intervention for a subaccount based on intelligence findings. ALWAYS requires human approval before execution. Submit the proposal with evidence — execution proceeds only after HITL gate approval.",
  "input_schema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The canonical account ID to intervene on"
      },
      "intervention_type": {
        "type": "string",
        "enum": ["check_in_sequence", "campaign_pause", "internal_alert", "account_manager_notification", "client_communication_draft"],
        "description": "Type of intervention to propose"
      },
      "evidence_summary": {
        "type": "string",
        "description": "Summary of the evidence justifying this intervention (anomalies, health scores, patterns)"
      },
      "recommended_action": {
        "type": "string",
        "description": "Specific recommended action text for the human reviewer"
      },
      "urgency": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"],
        "description": "Urgency level of the intervention"
      }
    },
    "required": ["account_id", "intervention_type", "evidence_summary"]
  }
}
```

## Instructions

This is the action skill — the bridge between detection and execution. Every execution path goes through the HITL gate first. The skill submits the intervention proposal to the review queue and returns a pending status. Only on human approval does execution proceed.

This is by design and is non-negotiable. No intervention that reaches outside the platform boundary executes without human approval.
