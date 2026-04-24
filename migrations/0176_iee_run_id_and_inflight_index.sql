-- Migration 0176 — IEE Phase 0 denormalisation + in-flight index
--
-- Two independent optimisations landed together because they're both
-- small and both driven by the external review pass on the IEE Phase 0
-- delegation lifecycle.
--
-- 1. agent_runs.iee_run_id column
--    Denormalised reference to the iee_runs.id that the parent run is
--    delegated to. Populated at delegation time by
--    agentExecutionService (see server/services/agentExecutionService.ts
--    IEE branch), read by the run-detail endpoint without a JOIN or
--    separate query. Replaces the previous approach of fetching the
--    iee_runs row on every run-detail read.
--
--    - Nullable: only populated for executionMode='iee_*' runs.
--    - No FK constraint: would create a read-time dependency on the
--      iee_runs table surviving soft-delete, and the column is a
--      denormalised cache, not a referential integrity contract.
--    - Indexed for the reverse lookup ("find the parent agent_run for
--      this iee_run") used by auditing / debugging tooling.
--
-- 2. agent_runs in-flight partial index
--    External review flagged that queries filtering on
--    status IN ('pending','running','delegated') will become hot under
--    scale (live-count endpoints, dashboard polling, WebSocket
--    resyncs). A partial btree on (organisation_id) scoped to those
--    three statuses is much smaller than the general (organisation_id,
--    status) btree and Postgres picks it for the common predicate.

BEGIN;

-- 1. Denormalised iee_run_id column
ALTER TABLE agent_runs
  ADD COLUMN iee_run_id uuid;

CREATE INDEX agent_runs_iee_run_id_idx
  ON agent_runs (iee_run_id)
  WHERE iee_run_id IS NOT NULL;

-- 2. In-flight partial index
CREATE INDEX agent_runs_inflight_org_idx
  ON agent_runs (organisation_id)
  WHERE status IN ('pending', 'running', 'delegated');

COMMIT;
