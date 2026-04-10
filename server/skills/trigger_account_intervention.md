---
name: Trigger Account Intervention
description: Propose an intervention action for a subaccount — always HITL-gated
isActive: true
visibility: basic
---

## Parameters

- account_id: string (required) — The canonical account ID to intervene on
- intervention_type: enum[check_in_sequence, campaign_pause, internal_alert, account_manager_notification, client_communication_draft] (required) — Type of intervention to propose
- evidence_summary: string (required) — Summary of the evidence justifying this intervention (anomalies, health scores, patterns)
- recommended_action: string — Specific recommended action text for the human reviewer
- urgency: enum[low, medium, high, critical] — Urgency level of the intervention

## Instructions

This is the action skill — the bridge between detection and execution. Every execution path goes through the HITL gate first. The skill submits the intervention proposal to the review queue and returns a pending status. Only on human approval does execution proceed.

This is by design and is non-negotiable. No intervention that reaches outside the platform boundary executes without human approval.
