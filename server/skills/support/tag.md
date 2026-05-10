---
name: Tag Ticket
description: Add or remove tags on a support ticket.
isActive: true
visibility: basic
---

## Parameters
- ticketId: string — canonical ticket UUID
- addTags: string[] (optional) — tags to add
- removeTags: string[] (optional) — tags to remove

## Instructions
Modify the tag set on a ticket. Tags help with routing, reporting, and search. Changes are applied to the provider immediately and reflected in the canonical store on the next ingestion cycle.
