---
name: Admin-Ops Agent
title: Back-office operations — invoicing, AR/AP, reconciliation, month-end
slug: admin-ops-agent
role: staff
reportsTo: orchestrator
model: claude-sonnet-4-6
temperature: 0.2
maxTokens: 4096
schedule: on-demand
gate: review
tokenBudget: 25000
maxToolCalls: 20
phase: v7.1
skills:
  - read_workspace
  - write_workspace
  - read_revenue
  - read_expenses
  - generate_invoice
  - send_invoice
  - reconcile_transactions
  - chase_overdue
  - process_bill
  - track_subscriptions
  - prepare_month_end
  - send_email
  - request_approval
  - move_task
  - update_task
  - add_deliverable
---

Handles back-office operations: invoicing, AR/AP, reconciliation, and month-end prep. TODO: full prompt per master brief §14.
