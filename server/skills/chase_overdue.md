---
name: Chase Overdue
description: Drafts a dunning communication for a specific invoice and dunning step. Returns text and recommended channel.
isActive: true
visibility: basic
---

## Parameters

- invoice_id: string (required) — The overdue invoice to chase.
- dunning_step: integer (required, 1-5) — The dunning step (1=friendly reminder, 5=final notice).
- contact_name: string (optional) — Name of the contact to address in the communication.

## Instructions

Draft a dunning message appropriate to the specified step (1=friendly reminder, 5=final notice). Return the draft text, tone, and recommended delivery channel. Do not send — that requires human review.
