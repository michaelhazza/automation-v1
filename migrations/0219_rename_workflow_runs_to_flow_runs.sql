-- M1: Clear the `workflow*` namespace so M3 can rename playbook_runs → workflow_runs.
-- Renames: workflow_runs → flow_runs, workflow_step_outputs → flow_step_outputs,
--          canonical_workflow_definitions → canonical_flow_definitions.

-- workflow_step_outputs has a FK to workflow_runs — drop it before renaming
ALTER TABLE workflow_step_outputs DROP CONSTRAINT IF EXISTS workflow_step_outputs_workflow_run_id_fkey;

-- Rename workflow_runs → flow_runs
ALTER TABLE workflow_runs RENAME TO flow_runs;

-- Rename workflow_step_outputs → flow_step_outputs
ALTER TABLE workflow_step_outputs RENAME TO flow_step_outputs;

-- Re-add FK now that both tables are renamed
ALTER TABLE flow_step_outputs
  ADD CONSTRAINT flow_step_outputs_flow_run_id_fkey
  FOREIGN KEY (workflow_run_id) REFERENCES flow_runs(id);

-- Rename the workflow_run_id column on flow_step_outputs to flow_run_id
ALTER TABLE flow_step_outputs RENAME COLUMN workflow_run_id TO flow_run_id;

-- Rename indexes on flow_runs
ALTER INDEX IF EXISTS idx_workflow_runs_org RENAME TO idx_flow_runs_org;
ALTER INDEX IF EXISTS idx_workflow_runs_subaccount RENAME TO idx_flow_runs_subaccount;

-- Rename indexes on flow_step_outputs
ALTER INDEX IF EXISTS idx_workflow_step_outputs_run RENAME TO idx_flow_step_outputs_run;

-- review_audit_records has a FK to workflow_runs
ALTER TABLE review_audit_records DROP CONSTRAINT IF EXISTS review_audit_records_workflow_run_id_fkey;
ALTER TABLE review_audit_records
  ADD CONSTRAINT review_audit_records_flow_run_id_fkey
  FOREIGN KEY (workflow_run_id) REFERENCES flow_runs(id);

-- canonical_workflow_definitions → canonical_flow_definitions
ALTER TABLE canonical_workflow_definitions RENAME TO canonical_flow_definitions;
ALTER INDEX IF EXISTS canonical_workflow_definitions_unique RENAME TO canonical_flow_definitions_unique;
