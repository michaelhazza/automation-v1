-- M2: Rename processes → automations and add §5.4a capability-contract columns.
-- Renames: processes → automations, process_categories → automation_categories,
--          subaccount_process_links → subaccount_automation_links,
--          process_connection_mappings → automation_connection_mappings,
--          workflow_engines → automation_engines.

-- ─── automation_categories (formerly process_categories) ─────────────────────
ALTER TABLE process_categories RENAME TO automation_categories;
ALTER INDEX IF EXISTS process_categories_org_id_idx RENAME TO automation_categories_org_id_idx;
ALTER INDEX IF EXISTS process_categories_deleted_at_idx RENAME TO automation_categories_deleted_at_idx;
ALTER INDEX IF EXISTS process_categories_org_name_unique_idx RENAME TO automation_categories_org_name_unique_idx;

-- ─── automation_engines (formerly workflow_engines) ───────────────────────────
ALTER TABLE workflow_engines RENAME TO automation_engines;
ALTER INDEX IF EXISTS workflow_engines_org_status_idx RENAME TO automation_engines_org_status_idx;
ALTER INDEX IF EXISTS workflow_engines_org_id_idx RENAME TO automation_engines_org_id_idx;
ALTER INDEX IF EXISTS workflow_engines_status_idx RENAME TO automation_engines_status_idx;
ALTER INDEX IF EXISTS workflow_engines_scope_status_idx RENAME TO automation_engines_scope_status_idx;
ALTER INDEX IF EXISTS workflow_engines_subaccount_idx RENAME TO automation_engines_subaccount_idx;

-- ─── automations (formerly processes) ────────────────────────────────────────
-- Drop FKs that reference process_categories / workflow_engines before renaming
ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_workflow_engine_id_fkey;
ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_org_category_id_fkey;

-- Rename the table
ALTER TABLE processes RENAME TO automations;

-- Rename indexes
ALTER INDEX IF EXISTS processes_org_status_idx RENAME TO automations_org_status_idx;
ALTER INDEX IF EXISTS processes_org_cat_status_idx RENAME TO automations_org_cat_status_idx;
ALTER INDEX IF EXISTS processes_engine_idx RENAME TO automations_engine_idx;
ALTER INDEX IF EXISTS processes_org_id_idx RENAME TO automations_org_id_idx;
ALTER INDEX IF EXISTS processes_org_category_idx RENAME TO automations_org_category_idx;
ALTER INDEX IF EXISTS processes_subaccount_idx RENAME TO automations_subaccount_idx;
ALTER INDEX IF EXISTS processes_status_idx RENAME TO automations_status_idx;
ALTER INDEX IF EXISTS processes_scope_status_idx RENAME TO automations_scope_status_idx;
ALTER INDEX IF EXISTS processes_parent_process_idx RENAME TO automations_parent_automation_idx;
ALTER INDEX IF EXISTS processes_system_process_idx RENAME TO automations_system_automation_idx;
ALTER INDEX IF EXISTS processes_engine_webhook_unique_idx RENAME TO automations_engine_webhook_unique_idx;

-- Re-add FKs pointing at renamed tables
ALTER TABLE automations
  ADD CONSTRAINT automations_workflow_engine_id_fkey
  FOREIGN KEY (workflow_engine_id) REFERENCES automation_engines(id);
ALTER TABLE automations
  ADD CONSTRAINT automations_org_category_id_fkey
  FOREIGN KEY (org_category_id) REFERENCES automation_categories(id);

-- §5.4a capability-contract columns
ALTER TABLE automations
  ADD COLUMN side_effects text NOT NULL DEFAULT 'unknown'
    CHECK (side_effects IN ('read_only', 'mutating', 'unknown'));
ALTER TABLE automations
  ADD COLUMN idempotent boolean NOT NULL DEFAULT false;

-- ─── subaccount_automation_links (formerly subaccount_process_links) ─────────
ALTER TABLE subaccount_process_links DROP CONSTRAINT IF EXISTS subaccount_process_links_process_id_fkey;
ALTER TABLE subaccount_process_links RENAME TO subaccount_automation_links;
ALTER INDEX IF EXISTS subaccount_process_links_subaccount_process_unique_idx RENAME TO subaccount_automation_links_subaccount_automation_unique_idx;
ALTER INDEX IF EXISTS subaccount_process_links_subaccount_idx RENAME TO subaccount_automation_links_subaccount_idx;
ALTER INDEX IF EXISTS subaccount_process_links_process_idx RENAME TO subaccount_automation_links_automation_idx;
ALTER INDEX IF EXISTS subaccount_process_links_category_idx RENAME TO subaccount_automation_links_category_idx;
ALTER TABLE subaccount_automation_links
  ADD CONSTRAINT subaccount_automation_links_automation_id_fkey
  FOREIGN KEY (process_id) REFERENCES automations(id);

-- ─── automation_connection_mappings (formerly process_connection_mappings) ────
ALTER TABLE process_connection_mappings DROP CONSTRAINT IF EXISTS process_connection_mappings_process_id_fkey;
ALTER TABLE process_connection_mappings RENAME TO automation_connection_mappings;
ALTER INDEX IF EXISTS pcm_subaccount_process_key_unique RENAME TO acm_subaccount_automation_key_unique;
ALTER INDEX IF EXISTS pcm_subaccount_process_idx RENAME TO acm_subaccount_automation_idx;
ALTER INDEX IF EXISTS pcm_connection_idx RENAME TO acm_connection_idx;
ALTER INDEX IF EXISTS pcm_org_idx RENAME TO acm_org_idx;
ALTER TABLE automation_connection_mappings
  ADD CONSTRAINT automation_connection_mappings_automation_id_fkey
  FOREIGN KEY (process_id) REFERENCES automations(id);

-- executions table: FK to processes needs updating
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_process_id_fkey;
ALTER TABLE executions
  ADD CONSTRAINT executions_automation_id_fkey
  FOREIGN KEY (process_id) REFERENCES automations(id);

-- Update FK to automation_engines on executions
-- executions uses engine_id (added by 0018), not workflow_engine_id
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_workflow_engine_id_fkey;
ALTER TABLE executions
  ADD CONSTRAINT executions_automation_engine_id_fkey
  FOREIGN KEY (engine_id) REFERENCES automation_engines(id);

-- tasks table: FK to processes needs updating
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_process_id_fkey;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_automation_id_fkey
  FOREIGN KEY (process_id) REFERENCES automations(id);
