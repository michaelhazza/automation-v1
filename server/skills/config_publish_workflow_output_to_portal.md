---
name: Config Publish Workflow Output to Portal
description: Publish a Workflow step's output to the sub-account portal card. Creates or updates the portal brief for this run.
isActive: true
visibility: none
---

## Parameters

- runId: string (required) — The Workflow run ID producing this output
- WorkflowSlug: string (required) — Slug of the Workflow template
- title: string (required) — Card title shown on the portal
- bullets: string[] (required) — Headline bullet points shown on the portal card
- detailMarkdown: string (optional) — Long-form markdown shown in the run detail modal

## Instructions

Publishes a Workflow step's output to the sub-account portal card. This is an internal
Workflow step action — it is NOT for use by the Configuration Assistant agent directly.

Creates or updates a `portal_briefs` row for the given run (upsert by run ID) and marks
the Workflow run itself portal-visible. The portal card (§9.4) reads the most recent
non-retracted brief per (subaccount, WorkflowSlug).

### When to use

Only callable from `action_call` steps in Workflow templates where `sideEffectType`
is declared as `reversible` (the brief can be retracted by the admin). Never call
this from a human-initiated Configuration Assistant session.
