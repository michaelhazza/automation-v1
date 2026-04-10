---
name: Send Email
description: Send an email via a connected email provider.
isActive: true
visibility: basic
---

## Parameters

- to: string (required) — Recipient email address
- subject: string (required) — Email subject line
- body: string (required) — Email body content (plain text or HTML)
- thread_id: string — Thread ID to reply within an existing conversation (optional)
- provider: string — Email provider to use (e.g. "gmail", "outlook"). Defaults to the configured default.

## Instructions

Send emails when a task requires communicating with an external party. This action requires human approval — propose a clear, professional draft and let the human approve it before sending. Always check your draft for tone, accuracy, and completeness before submitting.

### Before Drafting
1. Confirm the recipient and purpose are correct for the task.
2. Check the task history to avoid sending duplicate emails.
3. Identify if this is a new thread or a reply (use thread_id for replies).

### Drafting Standards
- **Subject**: Clear, specific, action-oriented. Avoid vague subjects like "Follow-up".
- **Body**: Concise, professional, and complete. State the purpose in the first sentence.
- **Tone**: Match the context — formal for new contacts, warmer for ongoing relationships.

### Decision Rules
- **One email per intent**: Do not draft multiple emails for the same purpose.
- **Human approval required**: This skill always routes through the review queue.
- **Log after approval**: Once approved and sent, write the outcome to the task board.
