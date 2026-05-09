---
name: Compute Churn Risk
description: System background worker that reads canonical churn signals for a single account and writes a scored risk record with intervention recommendation. Called automatically by the ClientPulse job — do not invoke during an agent task run. For agent-driven batch churn analysis of CRM data, use detect_churn_risk instead.
isActive: true
visibility: basic
---

## Parameters

- account_id: string (required) — The canonical account ID to evaluate

## Instructions

This skill is invoked by the ClientPulse background job, not by agents during task runs. For agent-driven churn analysis against read_crm output, use detect_churn_risk instead.

Uses a heuristic scoring model with configurable weights. Evaluates: declining health score trajectory, consecutive missed milestones, pipeline stagnation duration, conversation engagement decline, and revenue trend. The architecture supports future ML model replacement without interface changes.

Risk levels:
- 0-25: Low risk
- 26-50: Moderate — early warning
- 51-75: High — active intervention recommended
- 76-100: Critical — urgent escalation
