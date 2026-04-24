-- Down: reverse M3 — restore workflow_* tables to playbook_* names.
--
-- Exact inverse of 0221_rename_playbooks_to_workflows.sql.

-- =============================================================================
-- Step 1: Drop re-added FK constraints (new names)
-- =============================================================================

ALTER TABLE portal_briefs
  DROP CONSTRAINT IF EXISTS portal_briefs_run_id_fkey;

ALTER TABLE subaccount_onboarding_state
  DROP CONSTRAINT IF EXISTS subaccount_onboarding_state_last_run_id_fkey;

ALTER TABLE workflow_step_reviews
  DROP CONSTRAINT IF EXISTS workflow_step_reviews_step_run_id_fkey;

ALTER TABLE workflow_step_runs
  DROP CONSTRAINT IF EXISTS workflow_step_runs_run_id_fkey;

ALTER TABLE workflow_run_event_sequences
  DROP CONSTRAINT IF EXISTS workflow_run_event_sequences_run_id_fkey;

ALTER TABLE workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_template_version_id_fkey;

ALTER TABLE workflow_template_versions
  DROP CONSTRAINT IF EXISTS workflow_template_versions_template_id_fkey;

ALTER TABLE workflow_templates
  DROP CONSTRAINT IF EXISTS workflow_templates_forked_from_system_id_fkey;

ALTER TABLE system_workflow_template_versions
  DROP CONSTRAINT IF EXISTS system_workflow_template_versions_system_template_id_fkey;

-- =============================================================================
-- Step 2: Restore cross-table columns on tables that were NOT renamed
-- =============================================================================

-- scheduled_tasks
ALTER INDEX IF EXISTS scheduled_tasks_workflow_slug_idx
  RENAME TO scheduled_tasks_playbook_slug_idx;
ALTER TABLE scheduled_tasks
  RENAME COLUMN created_by_workflow_slug TO created_by_playbook_slug;

-- agent_runs
ALTER INDEX IF EXISTS agent_runs_workflow_step_run_id_idx
  RENAME TO agent_runs_playbook_step_run_id_idx;
ALTER TABLE agent_runs
  RENAME COLUMN workflow_step_run_id TO playbook_step_run_id;

-- memory_blocks
ALTER TABLE memory_blocks
  RENAME COLUMN last_written_by_workflow_slug TO last_written_by_playbook_slug;

-- onboarding_bundle_configs
ALTER TABLE onboarding_bundle_configs
  RENAME COLUMN workflow_slugs TO playbook_slugs;

-- modules
ALTER TABLE modules
  RENAME COLUMN onboarding_workflow_slugs TO onboarding_playbook_slugs;

-- portal_briefs
ALTER INDEX IF EXISTS portal_briefs_subaccount_workflow_slug_idx
  RENAME TO portal_briefs_subaccount_slug_idx;
ALTER TABLE portal_briefs
  RENAME COLUMN workflow_slug TO playbook_slug;

-- subaccount_onboarding_state
ALTER INDEX IF EXISTS subaccount_onboarding_state_org_workflow_slug_idx
  RENAME TO subaccount_onboarding_state_org_idx;
ALTER INDEX IF EXISTS subaccount_onboarding_state_subaccount_workflow_slug_uniq
  RENAME TO subaccount_onboarding_state_subaccount_slug_uniq;
ALTER TABLE subaccount_onboarding_state
  RENAME COLUMN workflow_slug TO playbook_slug;

-- =============================================================================
-- Step 3: Restore the denormalised column on workflow_runs before renaming it
-- =============================================================================

ALTER TABLE workflow_runs RENAME COLUMN workflow_slug TO playbook_slug;

-- =============================================================================
-- Step 4: Restore indexes to old names (before renaming tables back)
-- =============================================================================

-- workflow_studio_sessions → playbook_studio_sessions
ALTER INDEX IF EXISTS workflow_studio_sessions_user_idx
  RENAME TO playbook_studio_sessions_user_idx;

-- workflow_step_reviews → playbook_step_reviews
ALTER INDEX IF EXISTS workflow_step_reviews_step_run_idx
  RENAME TO playbook_step_reviews_step_run_idx;

-- workflow_step_runs → playbook_step_runs
ALTER INDEX IF EXISTS workflow_step_runs_run_step_live_unique_idx
  RENAME TO playbook_step_runs_run_step_live_unique_idx;
ALTER INDEX IF EXISTS workflow_step_runs_agent_run_id_idx
  RENAME TO playbook_step_runs_agent_run_id_idx;
ALTER INDEX IF EXISTS workflow_step_runs_run_id_status_idx
  RENAME TO playbook_step_runs_run_id_status_idx;

-- workflow_runs → playbook_runs
ALTER INDEX IF EXISTS workflow_runs_template_version_idx
  RENAME TO playbook_runs_template_version_idx;
ALTER INDEX IF EXISTS workflow_runs_subaccount_status_idx
  RENAME TO playbook_runs_subaccount_status_idx;
ALTER INDEX IF EXISTS workflow_runs_org_status_idx
  RENAME TO playbook_runs_org_status_idx;

-- workflow_template_versions → playbook_template_versions
ALTER INDEX IF EXISTS workflow_template_versions_unique_idx
  RENAME TO playbook_template_versions_unique_idx;

-- workflow_templates → playbook_templates
ALTER INDEX IF EXISTS workflow_templates_forked_from_idx
  RENAME TO playbook_templates_forked_from_idx;
ALTER INDEX IF EXISTS workflow_templates_org_idx
  RENAME TO playbook_templates_org_idx;
ALTER INDEX IF EXISTS workflow_templates_org_slug_unique_idx
  RENAME TO playbook_templates_org_slug_unique_idx;

-- system_workflow_template_versions → system_playbook_template_versions
ALTER INDEX IF EXISTS system_workflow_template_versions_unique_idx
  RENAME TO system_playbook_template_versions_unique_idx;

-- system_workflow_templates → system_playbook_templates
ALTER INDEX IF EXISTS system_workflow_templates_slug_idx
  RENAME TO system_playbook_templates_slug_idx;

-- =============================================================================
-- Step 5: Rename tables back
-- =============================================================================

ALTER TABLE workflow_studio_sessions           RENAME TO playbook_studio_sessions;
ALTER TABLE workflow_step_reviews              RENAME TO playbook_step_reviews;
ALTER TABLE workflow_step_runs                 RENAME TO playbook_step_runs;
ALTER TABLE workflow_run_event_sequences       RENAME TO playbook_run_event_sequences;
ALTER TABLE workflow_runs                      RENAME TO playbook_runs;
ALTER TABLE workflow_template_versions         RENAME TO playbook_template_versions;
ALTER TABLE workflow_templates                 RENAME TO playbook_templates;
ALTER TABLE system_workflow_template_versions  RENAME TO system_playbook_template_versions;
ALTER TABLE system_workflow_templates          RENAME TO system_playbook_templates;

-- =============================================================================
-- Step 6: Restore original FK constraints
-- =============================================================================

-- system_playbook_template_versions → system_playbook_templates
ALTER TABLE system_playbook_template_versions
  ADD CONSTRAINT system_playbook_template_versions_system_template_id_fkey
  FOREIGN KEY (system_template_id) REFERENCES system_playbook_templates(id) ON DELETE RESTRICT;

-- playbook_templates → system_playbook_templates
ALTER TABLE playbook_templates
  ADD CONSTRAINT playbook_templates_forked_from_system_id_fkey
  FOREIGN KEY (forked_from_system_id) REFERENCES system_playbook_templates(id) ON DELETE SET NULL;

-- playbook_template_versions → playbook_templates
ALTER TABLE playbook_template_versions
  ADD CONSTRAINT playbook_template_versions_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES playbook_templates(id) ON DELETE RESTRICT;

-- playbook_runs → playbook_template_versions
ALTER TABLE playbook_runs
  ADD CONSTRAINT playbook_runs_template_version_id_fkey
  FOREIGN KEY (template_version_id) REFERENCES playbook_template_versions(id) ON DELETE RESTRICT;

-- playbook_run_event_sequences → playbook_runs
ALTER TABLE playbook_run_event_sequences
  ADD CONSTRAINT playbook_run_event_sequences_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES playbook_runs(id) ON DELETE CASCADE;

-- playbook_step_runs → playbook_runs
ALTER TABLE playbook_step_runs
  ADD CONSTRAINT playbook_step_runs_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES playbook_runs(id) ON DELETE CASCADE;

-- playbook_step_reviews → playbook_step_runs
ALTER TABLE playbook_step_reviews
  ADD CONSTRAINT playbook_step_reviews_step_run_id_fkey
  FOREIGN KEY (step_run_id) REFERENCES playbook_step_runs(id) ON DELETE CASCADE;

-- subaccount_onboarding_state → playbook_runs
ALTER TABLE subaccount_onboarding_state
  ADD CONSTRAINT subaccount_onboarding_state_last_run_id_fkey
  FOREIGN KEY (last_run_id) REFERENCES playbook_runs(id);

-- portal_briefs → playbook_runs
ALTER TABLE portal_briefs
  ADD CONSTRAINT portal_briefs_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES playbook_runs(id);
