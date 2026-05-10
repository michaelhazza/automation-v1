---
name: Classify Ticket
description: Classify a support ticket by intent, urgency, and recommended action using LLM reasoning.
isActive: true
visibility: basic
gate_level: auto
idempotency: read_only
risk_tier: 1
---

## Parameters
- ticketId: string (required) — the canonical ticket ID to classify

## Returns
- intent: account_question | billing_question | bug_report | feature_request | how_to_question | complaint | cancellation_request | sales_inquiry | other
- urgency: low | medium | high | urgent
- recommended_action: draft_reply | escalate_to_human | add_internal_note_only | close_as_no_action
- confidence: number (0 to 1)
- reasoning: string
- escalate_reason: string | null

## Instructions
Use this skill to understand what type of support request has been received and what action to take next. High confidence (>= 0.8) enables autonomous drafting. Low confidence routes to human review.
