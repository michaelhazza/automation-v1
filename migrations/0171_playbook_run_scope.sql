-- 0171_playbook_run_scope.sql
-- ClientPulse Phase 0.5: playbook-engine substrate refactor to allow explicit
-- scope='org' runs. Spec §13.3. Substrate-only; no org-level playbook shipped
-- in this PR. Ship gate: existing subaccount runs continue to work unchanged;
-- the schema accepts scope='org' registrations.
--
-- Three changes:
--   1. Add `scope` enum column to playbook_runs and system_playbook_templates
--      (default 'subaccount' for backwards-compatible insert paths).
--   2. Make playbook_runs.subaccount_id nullable — required for org-scope runs
--      where the "entity" is the whole organisation, not one subaccount.
--   3. Add CHECK constraint enforcing the scope invariant:
--        (scope='subaccount' AND subaccount_id IS NOT NULL)
--        OR
--        (scope='org' AND subaccount_id IS NULL)
--
-- Backfill is trivial — every existing playbook_runs row has a non-null
-- subaccount_id and implicitly belongs to scope='subaccount'; the default
-- column value handles it.

BEGIN;

-- 1. scope enum type — shared by both tables.
CREATE TYPE playbook_scope AS ENUM ('subaccount', 'org');

-- 2. Add scope column to playbook_runs with default 'subaccount'.
ALTER TABLE playbook_runs
  ADD COLUMN scope playbook_scope NOT NULL DEFAULT 'subaccount';

-- 3. Add scope column to system_playbook_templates — authors declare whether
--    the playbook operates at subaccount or org scope.
ALTER TABLE system_playbook_templates
  ADD COLUMN scope playbook_scope NOT NULL DEFAULT 'subaccount';

-- 4. Relax subaccount_id nullability.
ALTER TABLE playbook_runs
  ALTER COLUMN subaccount_id DROP NOT NULL;

-- 5. CHECK constraint enforcing the scope invariant.
ALTER TABLE playbook_runs
  ADD CONSTRAINT playbook_runs_scope_subaccount_consistency_chk
    CHECK (
      (scope = 'subaccount' AND subaccount_id IS NOT NULL)
      OR
      (scope = 'org' AND subaccount_id IS NULL)
    );

-- 6. Partial index for org-scope runs — avoids full-table scan when the
--    dashboard or scheduler filters by scope='org' for a given org.
CREATE INDEX playbook_runs_org_scope_idx
  ON playbook_runs (organisation_id, status)
  WHERE scope = 'org';

COMMIT;
