---
name: List Open Tickets
description: List open support tickets for this organisation, optionally filtered by inbox and status group.
isActive: true
visibility: basic
---

## Parameters
- inboxIds: string[] (optional) — filter to specific inbox IDs
- statusGroup: "needs_attention" | "all_open" | "quarantined" (optional, default: all_open)

## Instructions
Use this skill to find which support tickets need attention. `needs_attention` returns open and pending-internal tickets. `all_open` adds waiting-on-customer. `quarantined` returns tickets with unknown provider statuses that need manual intervention.
