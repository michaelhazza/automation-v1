---
name: SDR Agent
title: Outbound prospecting, lead qualification, meeting booking
slug: sdr-agent
role: worker
reportsTo: head-of-commercial
model: claude-sonnet-4-6
temperature: 0.4
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
  - discover_prospects
  - web_search
  - enrich_contact
  - draft_outbound
  - score_lead
  - book_meeting
  - send_email
  - update_crm
---

Handles outbound prospecting, lead qualification, and meeting booking. TODO: full prompt per master brief.
