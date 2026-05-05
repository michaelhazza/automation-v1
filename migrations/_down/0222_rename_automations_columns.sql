-- Reverses 0222_rename_automations_columns.sql
-- automation_engine_id → workflow_engine_id
-- parent_automation_id → parent_process_id
-- system_automation_id → system_process_id

DROP INDEX IF EXISTS automations_engine_webhook_unique_idx;

ALTER TABLE automations RENAME COLUMN automation_engine_id TO workflow_engine_id;
ALTER TABLE automations RENAME COLUMN parent_automation_id TO parent_process_id;
ALTER TABLE automations RENAME COLUMN system_automation_id TO system_process_id;

ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_automation_engine_id_fkey;
ALTER TABLE automations
  ADD CONSTRAINT automations_workflow_engine_id_fkey
  FOREIGN KEY (workflow_engine_id) REFERENCES automation_engines(id);

CREATE UNIQUE INDEX automations_engine_webhook_unique_idx
  ON automations (workflow_engine_id, webhook_path)
  WHERE workflow_engine_id IS NOT NULL AND deleted_at IS NULL;
