-- W1-6: Rename automations table columns to drop legacy process/workflow naming.
-- workflow_engine_id   → automation_engine_id
-- parent_process_id   → parent_automation_id
-- system_process_id   → system_automation_id

-- Drop the unique partial index (references workflow_engine_id by name in its WHERE clause)
DROP INDEX IF EXISTS automations_engine_webhook_unique_idx;

-- Rename columns
ALTER TABLE automations RENAME COLUMN workflow_engine_id TO automation_engine_id;
ALTER TABLE automations RENAME COLUMN parent_process_id TO parent_automation_id;
ALTER TABLE automations RENAME COLUMN system_process_id TO system_automation_id;

-- Drop and re-add FK so it reflects the new column name in system catalogs
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_workflow_engine_id_fkey;
ALTER TABLE automations
  ADD CONSTRAINT automations_automation_engine_id_fkey
  FOREIGN KEY (automation_engine_id) REFERENCES automation_engines(id);

-- Recreate the partial unique index on the renamed column
CREATE UNIQUE INDEX automations_engine_webhook_unique_idx
  ON automations (automation_engine_id, webhook_path)
  WHERE automation_engine_id IS NOT NULL AND deleted_at IS NULL;
