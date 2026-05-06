---
name: Output Recommend
description: Surface an operator-facing recommendation in the dashboard. Any agent with this skill can write structured findings to the generic agent_recommendations primitive.
isActive: true
visibility: none
---

## Parameters

- scope_type: string (required) — `"org"` or `"subaccount"`. Scope this recommendation targets.
- scope_id: string (required) — UUID of the target scope (organisation_id for org, subaccount_id for subaccount).
- category: string (required) — Namespaced category in the form `<agent_namespace>.<area>.<finding>`. Three segments required. Must start with the calling agent's namespace (e.g. `optimiser.agent.over_budget`).
- severity: string (required) — `"info"`, `"warn"`, or `"critical"`.
- title: string (required) — Operator-facing plain English title. No internal category slugs.
- body: string (required) — One to two sentence operator-facing detail with concrete numbers.
- evidence: object (required) — Structured evidence supporting the finding. Shape is per-category (see shared/types/agentRecommendations.ts).
- action_hint: string (optional) — Deep-link URI for the primary action (e.g. `configuration-assistant://agent/<id>?focus=budget`). Omit if no specific action is recommended.
- dedupe_key: string (required) — Stable per-entity key within the category (e.g. agent_id, workflow_id, skill_slug). Same key across runs = deduplication.

## Output

Returns `{ recommendation_id: string, was_new: boolean, reason?: string }` where:
- `was_new=true` — new row inserted successfully.
- `was_new=true, reason="evicted_lower_priority"` — cap was full; a lower-priority recommendation was evicted to make room.
- `was_new=false` (no reason) — open row already exists with identical evidence. No change.
- `was_new=false, reason="updated_in_place"` — open row updated with materially different evidence.
- `was_new=false, reason="sub_threshold"` — evidence changed but the per-category material-change threshold was not met. No-op.
- `was_new=false, reason="cap_reached"` — the per-scope cap of 10 open recommendations is full and the new candidate's priority is not higher than the lowest existing. No insert.
- `was_new=false, reason="cooldown"` — a dismissed recommendation for this finding is still in its cooldown window (and the new severity is not higher). No insert.

## Decision flow

1. Cooldown check — if a dismissed row for (scope, category, dedupe_key) has `dismissed_until > now()` and the new severity is not higher than the dismissed row's severity, return `cooldown`.
2. Open-match check — if an open row exists for (scope, category, dedupe_key): hash match = no-op; hash differs + material change = update in place; hash differs + sub-threshold = no-op.
3. Cap check — count open rows for (scope, producing_agent_id). If < 10, insert new row.
4. Eviction check — if cap is full, compare new candidate priority (severity > updated_at > category > dedupe_key) against the lowest-priority open row. Higher priority = evict and insert; equal or lower = cap_reached.

## Rules

- `producing_agent_id` is derived from the calling agent's execution context. Callers cannot supply or override it.
- Non-agent invocations are rejected.
- Category must follow the three-segment namespaced format and start with the calling agent's namespace prefix.
- `action_hint` must be null/omitted or match `^[a-z][a-z0-9-]*://[^\s]+$`.

## Instructions

Call this skill at the end of a scan run after evaluating findings. Call it once per distinct finding (one call per category + dedupe_key combination). The skill handles deduplication, cooldowns, and cap enforcement — do not pre-filter based on open recommendations; always call and let the skill decide.

Sort candidates by severity (critical first) before calling sequentially. Do not call this skill concurrently within a single agent run.

Do not include category slugs, severity words, or internal identifiers in the title or body. Write for an operator who does not know your internals.
