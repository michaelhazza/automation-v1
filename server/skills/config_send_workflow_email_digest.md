---
name: Config Send Workflow Email Digest
description: Send a markdown email digest to a list of recipients. Deduplicated per run to prevent double-sends.
isActive: true
visibility: none
---

## Parameters

- runId: string (required) — The Workflow run ID issuing this email (used for dedup)
- to: string[] (required) — Recipient email addresses (max 5)
- subject: string (required) — Email subject line
- bodyMarkdown: string (required) — Email body in Markdown

## Instructions

Sends a Workflow email digest to a list of recipients via the configured email provider.
This is an internal Workflow step action — it is NOT for use by the Configuration
Assistant agent directly.

Deduplication: the skill is keyed on `(runId, sorted recipients)` using a pg advisory
lock. Retries within the same run will never double-send.

### When to use

Only callable from `action_call` steps in Workflow templates where `sideEffectType`
is declared as `irreversible` (email cannot be unsent). Never call this from a
human-initiated Configuration Assistant session.
