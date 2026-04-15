---
name: Config Publish Playbook Output to Portal
description: Publish a playbook step's output to the sub-account portal card. Creates or updates the portal brief for this run.
isActive: true
visibility: none
---

## Parameters

- runId: string (required) — The playbook run ID producing this output
- playbookSlug: string (required) — Slug of the playbook template
- title: string (required) — Card title shown on the portal
- bullets: string[] (required) — Headline bullet points shown on the portal card
- detailMarkdown: string (optional) — Long-form markdown shown in the run detail modal

## Instructions

Publishes a playbook step's output to the sub-account portal card. This is an internal
playbook step action — it is NOT for use by the Configuration Assistant agent directly.

Creates or updates a `portal_briefs` row for the given run (upsert by run ID) and marks
the playbook run itself portal-visible. The portal card (§9.4) reads the most recent
non-retracted brief per (subaccount, playbookSlug).

### When to use

Only callable from `action_call` steps in playbook templates where `sideEffectType`
is declared as `reversible` (the brief can be retracted by the admin). Never call
this from a human-initiated Configuration Assistant session.
