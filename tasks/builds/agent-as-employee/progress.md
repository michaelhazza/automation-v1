# Agent-as-employee — build progress

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Plan:** `docs/superpowers/plans/2026-04-29-agents-as-employees.md`
**Branch:** `feat/agents-are-employees`

## Status

- [ ] Phase A — schema + manifest + permissions + system-agent rename
- [ ] Phase B — native adapter + canonical pipeline + onboard flow
- [ ] Phase C — Google adapter
- [ ] Phase D — org chart + activity + seats
- [ ] Phase E — migration runbook

## Migration numbering

Plan spec references `0240` / `0241` / `0242`. Verified latest committed migration at pre-flight: `0253_rate_limit_buckets.sql`. Actual trio: **`0254` / `0255` / `0256`**.

## Reader audit (connector_configs)

Pending — to be completed during Task A4.

## Runtime sanity log

Pending — to be completed during Task A4.

## Decisions / deviations from spec

- `audit_events.workspace_actor_id` (new column) uses `workspace_actor_id` name, NOT `actor_id` per spec §5 wording. The existing `actor_id uuid` column is the polymorphic principal field and cannot be repurposed — see Task A5 Step 1 for rationale.

## Open questions

(none yet)
