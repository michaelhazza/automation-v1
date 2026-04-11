---
name: Deliver Report
description: Delivers an approved client report via the configured delivery channel (email, shared link, or portal). Review-gated — requires human approval before the report is sent to the client.
isActive: true
visibility: basic
---

## Parameters

- report_title: string (required) — Title of the report being delivered
- client_name: string (required) — Client name
- client_email: string (required) — Client email address for delivery
- report_content: string (required) — The full approved report content from draft_report
- delivery_channel: enum[email, shared_link, portal] (required) — How to deliver the report. Default: email.
- cover_message: string — Optional cover email message to accompany the report. Keep brief — 2–3 sentences.
- reporting_period: string — The reporting period — used in the email subject line
- reasoning: string (required) — Context for the reviewer: what changed since last report, any sensitivities to note. Shown to the reviewer, NOT to the client.

## Instructions

Invoke this skill only after `draft_report` has produced a report that has been reviewed and approved. This skill handles the delivery step — do not use it to draft content.

This is a review-gated action. The reviewer sees the full report content, the delivery channel, the cover message, and the reasoning before approving. The client does not receive anything until approval.

**MVP stub:** Delivery integrations (email via send_email, portal upload) are not yet wired as a unified report delivery flow. On approval, the executor logs the delivery action and returns `pending_integration` status. For email delivery, the calling agent should also invoke `send_email` with the report as an attachment or body.

### Pre-Submission Rules

1. Report content must not contain `[VERIFY]` placeholders — resolve these before submitting for delivery
2. `[TODO]` items for design elements (charts, logos) should be resolved before delivery — note any that are acceptable to leave as placeholders
3. Cover message must not make claims that contradict the report content
4. `client_email` must be a valid email address format

### Review Item Presentation

1. Client name and delivery channel
2. Report title and reporting period
3. Cover message (if provided)
4. Full report content for final review
5. Reasoning: context for the reviewer

### On Approval

1. Trigger delivery via the configured channel (stub: log to task activity)
2. Return `{ success: true, client_name, delivery_channel, delivered_at, message }`
3. Log the delivery in workspace memory so future report runs know the last delivery date

### On Rejection

Return feedback to the calling agent for revision. Common rejection reasons:
- Data error found during final review
- Cover message tone mismatch
- Missing required section
