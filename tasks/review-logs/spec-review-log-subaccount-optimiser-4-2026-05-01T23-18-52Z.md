# Spec Review — subaccount-optimiser — Iteration 4

- Spec commit at start: 9c22868c
- Spec-context commit: 03cf8188
- Codex output: tasks/review-logs/_codex_iter4.txt

## Codex findings

### #1 — Missing `updated_at` column for sort and freshness copy
- Section: §6.1 / §6.2 / §6.3 / §7
- Issue: Update-in-place preserves `created_at`; list sorts by `created_at desc`; section header says "Updated this morning". No authoritative `updated_at`.
- Classification: mechanical
- Disposition: auto-apply. Add `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Set on insert + update_in_place + acknowledge + dismiss. Switch sort + section-header copy to use `updated_at`.

### #2 — `producing_agent_id` provenance unstated
- Section: §6.1 / §6.2 / §8
- Issue: `producing_agent_id` is load-bearing for the unique cap-lock key but isn't in the `output.recommend` input contract.
- Classification: mechanical
- Disposition: auto-apply. Pin: derived from calling agent's execution context inside the executor; never caller-supplied; non-agent invocations rejected with explicit error.

### #3 — `subaccount_agents` row bootstrap path unstated
- Section: §4 / §9 / §11
- Issue: Schedule writes depend on a `subaccount_agents` row existing for role `subaccount-optimiser` per sub-account, but no spec sentence names the mechanism that creates that row.
- Classification: mechanical
- Disposition: auto-apply. State the bootstrap path: the same Phase 2 backfill script that registers schedules ALSO ensures a `subaccount_agents` row exists for role `subaccount-optimiser` per sub-account where `subaccounts.optimiser_enabled = true` (idempotent insert via the existing `subaccount_agents` link semantics). Newly-created sub-accounts after Phase 2 ships hit the same code path through a hook in `subaccountService.create`.

### #4 — Read endpoint `limit` ceiling vs `mode='expanded'`
- Section: §6.3 / §6.5 / §7
- Issue: GET endpoint defaults `limit=20`, caps at 100. `mode='expanded'` says "render all visible rows". Implementation gap when `N > 100`.
- Classification: mechanical
- Disposition: auto-apply. `mode='expanded'` fetches `limit=100` and the section copy explicitly says "show all up to 100"; if hidden rows exist beyond 100 the spec defers cursor pagination to v1.1 (already-listed Deferred Item — `/suggestions` page). State the cap explicitly so it isn't a silent truncation.

### #5 — `flow_step_outputs.stepId` not listed in telemetry / Phase 1
- Section: §5 / §3 / §9 / §6.5
- Issue: `common_step_id` derives from modal `flow_step_outputs.stepId`, but `flow_step_outputs` is missing from §3 telemetry sources and Phase 1 query files.
- Classification: mechanical
- Disposition: auto-apply. Add `flow_step_outputs` to §3 (escalation source); update `escalationRate.ts` Phase 1 description to spell out the `flow_runs` ↔ `flow_step_outputs` join.

### #6 — Acknowledge / dismiss can't distinguish 404 from "already in target state"
- Section: §6.5
- Issue: A 0-row UPDATE matches both "row missing/RLS-hidden" and "already in target state". Current contract returns 200 in both cases, but the spec promises 404 in the first case.
- Classification: mechanical
- Disposition: auto-apply. Pin: route runs `WITH r AS (SELECT id, acknowledged_at FROM agent_recommendations WHERE id = $1 FOR UPDATE) UPDATE agent_recommendations SET acknowledged_at = now() WHERE id = $1 AND acknowledged_at IS NULL RETURNING id` (or the dismiss equivalent). The `r` CTE distinguishes the two cases: empty CTE = 404; non-empty CTE + 0 update rows = 200 already*; non-empty CTE + 1 update row = 200 success.

## Iteration 4 Summary

- Codex findings: 6 (all mechanical, 0 ambiguous, 0 directional)
- Rubric findings: 0
- Mechanical accepted: 6
- Mechanical rejected: 0
- Reclassified → directional: 0
- Directional: 0
- AUTO-DECIDED: 0
