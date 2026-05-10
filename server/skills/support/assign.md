---
name: Assign Ticket
description: Assign a support ticket to a specific agent or unassign it.
isActive: true
visibility: basic
---

## Parameters
- ticketId: string — canonical ticket UUID
- assigneeAgentExternalId: string | null — external agent ID from the provider, or null to unassign

## Instructions
Assign the ticket to a support agent. Use null to unassign. The assignee must be a valid agent in the connected helpdesk provider — use the agent's external ID (not the canonical UUID).
