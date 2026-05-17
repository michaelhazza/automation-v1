---
name: Propose Reply
description: Draft a public reply to a support ticket for operator review before sending.
isActive: true
visibility: basic
---

## Parameters
- ticketId: string — canonical ticket UUID
- body: string — reply body text
- proposedActions: object (optional) — additional actions to propose alongside the reply (setStatus, setAssignee, addTags, removeTags)

## Instructions
Propose a reply to a support ticket. The reply goes into a draft queue for operator review before it is dispatched to the customer. Do not use this to send internal notes — use add_internal_note for that.

### When to Propose a Reply
- Task requires responding to a customer
- You have gathered enough context to draft a complete response
- The reply resolves or advances the customer's issue

### Writing Effective Replies
1. Address the customer's issue directly
2. Be concise — no unnecessary filler text
3. Include next steps if the issue is not fully resolved
