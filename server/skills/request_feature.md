---
name: Request Feature
description: File a structured feature request against the platform. Writes a durable feature_requests row and fires best-effort Slack/email notifications and a Synthetos-internal task for HITL triage.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- category: string (required) — `'new_capability'` (Path D — platform does not support), `'system_promotion_candidate'` (Path C — broadly useful pattern), or `'infrastructure_alert'` (Integration Reference is broken / parser errors)
- summary: string (required) — short title (≤200 chars)
- user_intent: string (required) — verbatim user task text
- required_capabilities: array (required) — `[{kind, slug}]` list from the Orchestrator's decomposition pipeline
- missing_capabilities: array (required) — subset of `required_capabilities` the platform does not have
- orchestrator_reasoning: string (optional) — paragraph explaining the classification
- source_task_id: string (optional) — originating task, when filed from the task board
- orgId: string (required) — must match caller's organisation
- subaccountId: string (optional)
- requested_by_user_id: string (required) — user the request is attributed to

## Instructions

Use `request_feature` in exactly two situations:

1. **Path D (unsupported)** — `check_capability_gap` returned `verdict: 'unsupported'` with at least one capability the platform does not provide. File with `category: 'new_capability'` and set `missing_capabilities` to the capabilities that are not available.
2. **Path C (system-promotion candidate)** — the platform supports the requested pattern for this org, but the pattern looks broadly useful (matches `broadly_useful_patterns` in the Integration Reference for the relevant integrations). File with `category: 'system_promotion_candidate'` alongside the Config Assistant handoff. User's flow is not blocked by this filing.

### Dedupe
Requests are deduplicated per-org over a 30-day window on `sha256(category + '|' + sorted canonical slugs)`. When a duplicate is detected:
- The existing row's `dedupe_group_count` is incremented.
- No new row is written, no notifications are re-fired, and no new Synthetos-internal task is created.
- The skill returns `deduped: true` so the caller knows no fresh signal went out.

Canonical slugs are the post-normalisation forms from the Integration Reference taxonomy — so `inbox_read` and `email_read` (aliases of the same canonical) collapse to the same hash.

### Notifications
Three channels are fired in parallel on the first write of a dedupe group:
- **Slack** — incoming webhook via `SYNTHETOS_INTERNAL_SLACK_WEBHOOK` env var. Skipped when unset.
- **Email** — `feature_request_email_address` system setting. Skipped when unset.
- **Synthetos-internal task** — `synthetos_internal_subaccount_id` system setting. Skipped when unset.

All three are best-effort. The durable record is always the `feature_requests` row.

### Permissions
`feature_request_submit`. System and org agents can file. Subaccount agents cannot (to prevent spam from client-facing flows). The Orchestrator, running at org scope, always has permission.
