---
name: Scan Skill Latency
description: Computes per-skill p95 latency for the last 7 days and compares against cross-tenant peer medians. Requires the peer-medians materialised view to be populated. Returns one row per skill where this sub-account's p95 exceeds 4x the peer p95.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ skill_slug: string, this_p95_ms: number, peer_p95_ms: number, peer_p50_ms: number, n_tenants: number, ratio_vs_peer_p95: number, median_version: number }>` where:

- `skill_slug` — The skill identifier (e.g. `web_search`).
- `this_p95_ms` — This sub-account's p95 latency in milliseconds over the last 7 days.
- `peer_p95_ms` — Cross-tenant peer p95 latency from the materialised view.
- `peer_p50_ms` — Cross-tenant peer p50 latency from the materialised view.
- `n_tenants` — Number of tenants contributing to the peer baseline.
- `ratio_vs_peer_p95` — `this_p95_ms / peer_p95_ms` (4 decimal places).
- `median_version` — Peer-medians view version used for this query.

Returns an empty array when the peer-medians view is not yet populated (partial mode) or no skills exceed the 4x threshold.

## Instructions

This skill is read-only but requires an admin connection to access the `optimiser_skill_peer_medians` materialised view, which is REVOKE'd from the default role (it is a cross-tenant aggregate). The orchestrator wraps this skill call in `withAdminConnectionGuarded`. If the view is empty, this skill is skipped and the run continues in partial mode. Findings are evaluated using the `optimiser.skill.slow` evaluator (ratio >= 4 = warn).

No side effects.
