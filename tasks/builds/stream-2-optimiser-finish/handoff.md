# Phase 2 Handoff — stream-2-optimiser-finish

**Build slug:** `stream-2-optimiser-finish`
**Branch:** `stream-2-optimiser-finish`
**Spec:** `docs/sub-account-optimiser-spec.md`
**Plan:** `tasks/builds/stream-2-optimiser-finish/plan.md`
**Implementation plan:** `tasks/builds/stream-2-optimiser-finish/impl-plan.md`
**Handoff authored:** 2026-05-05

---

## Phase 2 Gate Outcomes

### spec-conformance
**Verdict:** CONFORMANT_AFTER_FIXES
**Log:** `tasks/review-logs/spec-conformance-log-stream-2-optimiser-finish-2026-05-04T22-07-32Z.md`
**Prior log (NON_CONFORMANT):** `tasks/review-logs/spec-conformance-log-stream-2-optimiser-finish-2026-05-04T20-49-01Z.md`

Directional gaps resolved:
- DG-1: Evidence shapes — all 8 evaluators now emit Phase 0 snake_case fields only
- DG-3: playbookEscalation action hint passes `null` for missing `common_step_id`
- DG-4: UTC comment added to `registerOptimiserSchedule`
- DG-7: Created `server/jobs/runOptimiserScanJob.ts` + `'optimiser-scan'` queue + worker registration

False positives confirmed (code was already correct):
- DG-2: `renderRecommendation` evidenceHash cache key
- DG-5: Dashboard pre-fetch probe uses `useAgentRecommendationsTotal`
- DG-8: Backfill script WHERE predicate

Still open (acknowledged, not blocking):
- DG-4: UTC timezone choice — documented in comments, schema enhancement deferred
- DG-6: Cost-gate measurement — plan-allowed CI deferral

### pr-reviewer
**Verdict:** CHANGES_REQUESTED → fixed inline

Blocking findings fixed:
- B-1: Double-execution via two queues — `registerAllActiveSchedules` now LEFT JOINs `system_agents` to exclude optimiser SAs from `AGENT_RUN_QUEUE` registration; self-heal path in `registerOptimiserSchedule` now does inline DB update instead of calling `updateSchedule()` which would re-register on wrong queue

Non-blocking findings fixed:
- N-1: Stale JSDoc invariant 13 schedule name updated to `OPTIMISER_SCAN_QUEUE`
- N-3: `agent_name: ev.agentName ?? null` → `ev.agentName` (non-null field)

Advisory findings deferred to `tasks/todo.md`:
- S-1: `agent.over_budget` threshold mismatch with spec (1.3× + 2 consecutive months)
- S-2: No test asserting Phase 0 snake_case evidence key names
- S-3: No test for `handleOptimiserScan` job handler
- S-4: `median_version` not declared in shared evidence types
- N-2: Undocumented placeholder values in evidence fields
- N-4: `subaccountAgentId` not logged in handler
- OPS: Orphan `agent-scheduled-run:<optimiser-sa-id>` schedules need one-time unschedule at deploy

### dual-reviewer
**Verdict:** REVIEW_GAP — Codex CLI unavailable in this environment (Claude Code web session)

### adversarial-reviewer
Not invoked — diff does not match the security surface (§5.1.2): no auth/permission changes, no new routes, no RLS migrations, no webhook handlers.

---

## spec_deviations

None. All implemented code aligns with spec. Open items are explicitly deferred by spec (DG-6) or documented as future enhancements (DG-4 timezone, S-1 consecutive-month threshold, S-4 median_version in types).

---

## Open Issues for Finalisation

1. **OPS** — Orphan `agent-scheduled-run:<optimiser-sa-id>` pg-boss schedules from pre-PR registrations should be unscheduled at deploy. Query and steps documented in `tasks/todo.md § OPS`.
2. **S-1** — Evaluator threshold for `agent.over_budget` doesn't match spec §3/§5. Tracked in `tasks/todo.md § S-1`. Non-blocking for merge.
3. **S-4** — `median_version` field not in shared types union. Tracked in `tasks/todo.md § S-4`.

---

## Commits on branch (above main)

See `git log main..stream-2-optimiser-finish` for the full list. Key commits:
- `50e25242` — spec-conformance CONFORMANT_AFTER_FIXES (includes DG-1/DG-3/DG-4/DG-7 fixes + jobConfig + runOptimiserScanJob.ts)
- `2504620d` — pr-reviewer B-1/N-1/N-3 fixes + advisory items to todo.md
