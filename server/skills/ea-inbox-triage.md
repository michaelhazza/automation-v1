---
slug: ea.inbox_triage
name: EA Inbox Triage
description: Reviews the user's email inbox and surfaces high-priority items, drafts reply suggestions for review-gated approval, and flags items needing same-day action.
actionType: ea.inbox_triage
riskTier: 3
defaultGate: review
requiredIntegration: gmail
topics:
  - email
---

## Purpose

Read the owner's Gmail inbox, classify high-priority messages, propose draft replies for human approval, and surface time-sensitive items. No message is ever sent without explicit approval via the EA draft approval flow.

Emit `workflow.started` at entry. Emit exactly one of `workflow.completed`, `workflow.failed`, or `workflow.partial` at terminal.

## Steps

1. Read recent unread messages using the `read_inbox` action (provider: `gmail`). Use `since` set to the last triage run timestamp to avoid reprocessing old messages.
2. For each high-priority message (identified by sender urgency signals, subject keywords, or explicit VIP sender list), propose a draft reply via `eaDraftService.createDraftWithProposal` with `kind: 'gmail_reply'`. Each call creates one `actions` proposal row and one `ea_drafts` row with `send_state = 'idle'`.
3. Identify time-sensitive items: meeting invites needing an RSVP response and messages with same-day deadlines. Surface these as flagged items in the triage summary.
4. Return a triage summary: total messages reviewed, draft replies proposed (count), flagged items requiring same-day action (list with message subject and sender).

## Write-action constraint

Any send is review-gated. All proposed drafts land in `ea_drafts` with `send_state = 'idle'` and await approval via `POST /api/ea-drafts/:id/approve`. This workflow never calls the Gmail send API directly.

## Error paths

- Some messages fail to parse: emit `workflow.partial` with `parsedCount` and `failedCount`; continue processing remaining messages.
- Wrong credential resolved (owner mismatch): emit `credential.owner_mismatch` event; halt and emit `workflow.failed`.
- Gmail credential expired or revoked: emit `workflow.failed` with note `gmail_credential_expired`.
