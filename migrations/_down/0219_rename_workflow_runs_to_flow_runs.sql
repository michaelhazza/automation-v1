-- Down: reverse M1 — restore flow_runs → workflow_runs, flow_step_outputs → workflow_step_outputs,
--       canonical_flow_definitions → canonical_workflow_definitions.

-- Drop re-added FK on flow_step_outputs
ALTER TABLE flow_step_outputs DROP CONSTRAINT IF EXISTS flow_step_outputs_flow_run_id_fkey;

-- Rename column back
ALTER TABLE flow_step_outputs RENAME COLUMN flow_run_id TO workflow_run_id;

-- Rename tables back
ALTER TABLE flow_step_outputs RENAME TO workflow_step_outputs;
ALTER TABLE flow_runs RENAME TO workflow_runs;

-- Restore FK
ALTER TABLE workflow_step_outputs
  ADD CONSTRAINT workflow_step_outputs_workflow_run_id_fkey
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id);

-- Restore indexes
ALTER INDEX IF EXISTS idx_flow_runs_org RENAME TO idx_workflow_runs_org;
ALTER INDEX IF EXISTS idx_flow_runs_subaccount RENAME TO idx_workflow_runs_subaccount;
ALTER INDEX IF EXISTS idx_flow_step_outputs_run RENAME TO idx_workflow_step_outputs_run;

-- review_audit_records FK
ALTER TABLE review_audit_records DROP CONSTRAINT IF EXISTS review_audit_records_flow_run_id_fkey;
ALTER TABLE review_audit_records
  ADD CONSTRAINT review_audit_records_workflow_run_id_fkey
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id);

-- canonical_flow_definitions → canonical_workflow_definitions
ALTER TABLE canonical_flow_definitions RENAME TO canonical_workflow_definitions;
ALTER INDEX IF EXISTS canonical_flow_definitions_unique RENAME TO canonical_workflow_definitions_unique;
