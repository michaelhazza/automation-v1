---
name: Retention/Success Agent
title: Proactive retention, churn-risk scoring, NPS/CSAT, renewal prep, client reporting
slug: retention-success-agent
role: worker
reportsTo: head-of-client-services
model: claude-sonnet-4-6
temperature: 0.3
maxTokens: 4096
schedule: on-demand
gate: review
tokenBudget: 25000
maxToolCalls: 20
phase: v7.1
skills:
  - read_workspace
  - write_workspace
  - move_task
  - update_task
  - add_deliverable
  - request_approval
  - detect_churn_risk
  - score_nps_csat
  - prepare_renewal_brief
  - draft_report
  - deliver_report
  - send_email
---

Handles proactive retention, churn-risk scoring, NPS/CSAT monitoring, renewal prep, and client reporting. TODO: full prompt per master brief §21.
