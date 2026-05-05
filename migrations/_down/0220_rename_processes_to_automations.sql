-- Down M2: reverse automations → processes rename and remove capability-contract columns.

-- Remove §5.4a columns
ALTER TABLE automations DROP COLUMN IF EXISTS side_effects;
ALTER TABLE automations DROP COLUMN IF EXISTS idempotent;

-- Restore tasks FK
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_automation_id_fkey;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_process_id_fkey
  FOREIGN KEY (process_id) REFERENCES processes(id);

-- Restore executions FKs
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_automation_id_fkey;
ALTER TABLE executions
  ADD CONSTRAINT executions_process_id_fkey
  FOREIGN KEY (process_id) REFERENCES processes(id);
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_automation_engine_id_fkey;
ALTER TABLE executions
  ADD CONSTRAINT executions_workflow_engine_id_fkey
  FOREIGN KEY (workflow_engine_id) REFERENCES workflow_engines(id);

-- Restore automation_connection_mappings → process_connection_mappings
ALTER TABLE automation_connection_mappings DROP CONSTRAINT IF EXISTS automation_connection_mappings_automation_id_fkey;
ALTER TABLE automation_connection_mappings RENAME TO process_connection_mappings;
ALTER INDEX IF EXISTS acm_subaccount_automation_key_unique RENAME TO pcm_subaccount_process_key_unique;
ALTER INDEX IF EXISTS acm_subaccount_automation_idx RENAME TO pcm_subaccount_process_idx;
ALTER INDEX IF EXISTS acm_connection_idx RENAME TO pcm_connection_idx;
ALTER INDEX IF EXISTS acm_org_idx RENAME TO pcm_org_idx;
ALTER TABLE process_connection_mappings
  ADD CONSTRAINT process_connection_mappings_process_id_fkey
  FOREIGN KEY (process_id) REFERENCES processes(id);

-- Restore subaccount_automation_links → subaccount_process_links
ALTER TABLE subaccount_automation_links DROP CONSTRAINT IF EXISTS subaccount_automation_links_automation_id_fkey;
ALTER TABLE subaccount_automation_links RENAME TO subaccount_process_links;
ALTER INDEX IF EXISTS subaccount_automation_links_subaccount_automation_unique_idx RENAME TO subaccount_process_links_subaccount_process_unique_idx;
ALTER INDEX IF EXISTS subaccount_automation_links_subaccount_idx RENAME TO subaccount_process_links_subaccount_idx;
ALTER INDEX IF EXISTS subaccount_automation_links_automation_idx RENAME TO subaccount_process_links_process_idx;
ALTER INDEX IF EXISTS subaccount_automation_links_category_idx RENAME TO subaccount_process_links_category_idx;
ALTER TABLE subaccount_process_links
  ADD CONSTRAINT subaccount_process_links_process_id_fkey
  FOREIGN KEY (process_id) REFERENCES processes(id);

-- Restore automations → processes
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_workflow_engine_id_fkey;
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_org_category_id_fkey;
ALTER TABLE automations RENAME TO processes;
ALTER INDEX IF EXISTS automations_org_status_idx RENAME TO processes_org_status_idx;
ALTER INDEX IF EXISTS automations_org_cat_status_idx RENAME TO processes_org_cat_status_idx;
ALTER INDEX IF EXISTS automations_engine_idx RENAME TO processes_engine_idx;
ALTER INDEX IF EXISTS automations_org_id_idx RENAME TO processes_org_id_idx;
ALTER INDEX IF EXISTS automations_org_category_idx RENAME TO processes_org_category_idx;
ALTER INDEX IF EXISTS automations_subaccount_idx RENAME TO processes_subaccount_idx;
ALTER INDEX IF EXISTS automations_status_idx RENAME TO processes_status_idx;
ALTER INDEX IF EXISTS automations_scope_status_idx RENAME TO processes_scope_status_idx;
ALTER INDEX IF EXISTS automations_parent_automation_idx RENAME TO processes_parent_process_idx;
ALTER INDEX IF EXISTS automations_system_automation_idx RENAME TO processes_system_process_idx;
ALTER INDEX IF EXISTS automations_engine_webhook_unique_idx RENAME TO processes_engine_webhook_unique_idx;
ALTER TABLE processes
  ADD CONSTRAINT processes_workflow_engine_id_fkey
  FOREIGN KEY (workflow_engine_id) REFERENCES workflow_engines(id);
ALTER TABLE processes
  ADD CONSTRAINT processes_org_category_id_fkey
  FOREIGN KEY (org_category_id) REFERENCES process_categories(id);

-- Restore automation_engines → workflow_engines
ALTER TABLE automation_engines RENAME TO workflow_engines;
ALTER INDEX IF EXISTS automation_engines_org_status_idx RENAME TO workflow_engines_org_status_idx;
ALTER INDEX IF EXISTS automation_engines_org_id_idx RENAME TO workflow_engines_org_id_idx;
ALTER INDEX IF EXISTS automation_engines_status_idx RENAME TO workflow_engines_status_idx;
ALTER INDEX IF EXISTS automation_engines_scope_status_idx RENAME TO workflow_engines_scope_status_idx;
ALTER INDEX IF EXISTS automation_engines_subaccount_idx RENAME TO workflow_engines_subaccount_idx;

-- Restore automation_categories → process_categories
ALTER TABLE automation_categories RENAME TO process_categories;
ALTER INDEX IF EXISTS automation_categories_org_id_idx RENAME TO process_categories_org_id_idx;
ALTER INDEX IF EXISTS automation_categories_deleted_at_idx RENAME TO process_categories_deleted_at_idx;
ALTER INDEX IF EXISTS automation_categories_org_name_unique_idx RENAME TO process_categories_org_name_unique_idx;
