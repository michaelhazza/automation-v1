---
name: Scan Skill Latency
description: Queries agent_execution_events for skill completion events and computes per-skill p95 latency, then compares to cross-tenant peer medians from the optimiser_skill_peer_medians view. Used by the optimiser to detect skills running more than 4x slower than peers.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — UUID of the sub-account to scan.
- organisationId: string (required) — UUID of the organisation owning the sub-account.

## Output

Returns an array of `SkillLatencyRow`:
- `skill_slug` — the skill identifier.
- `latency_p95_ms` — integer p95 latency for this sub-account over 7 days.
- `peer_p95_ms` — integer p95 latency across all tenants (from the peer-median view).
- `ratio` — ratio to 4 decimal places (latency_p95_ms / peer_p95_ms).

Returns `[]` when:
- No matching events exist in the 7-day window.
- The peer-median view has no entry for a skill (skill used by fewer than 5 sub-accounts).
- The peer-median view is stale (last refresh more than 24 hours ago).

## Evaluator

Output is processed by the `skillSlow` evaluator (`server/services/optimiser/recommendations/skillSlow.ts`).

## Rules

- Query window: agent_execution_events.event_timestamp >= now() - interval '7 days'.
- Peer-median source: `optimiser_skill_peer_medians` materialised view (cross-tenant p95 per skill slug).
- Staleness guard: emits recommendations.scan_skipped.peer_view_stale and returns [] when view is stale (last refresh > 24 hours ago).
- Returns raw data only. Ratio threshold evaluation is done by the evaluator.
