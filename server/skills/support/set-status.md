---
name: Set Ticket Status
description: Change the status of a support ticket via the connected helpdesk provider.
isActive: true
visibility: basic
---

## Parameters
- ticketId: string — canonical ticket UUID
- status: string — target status (open, pending_internal, waiting_on_customer, resolved, closed)

## Instructions
Change a ticket's status. The change is applied to the provider (e.g. Teamwork Desk) immediately and will be reflected in the canonical store on the next ingestion cycle. Use `resolved` when the support outcome is complete but the ticket may still receive customer follow-up (which auto-reopens it to `open`). Use `closed` for terminal/archive — no further activity expected.
