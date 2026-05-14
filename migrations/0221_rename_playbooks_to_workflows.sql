-- Migration: M3 playbook → workflow rename
--
-- Renames all playbook_* tables to workflow_* tables, renames associated indexes,
-- renames cross-table columns, and re-adds FK constraints with new names.
--
-- The workflow_runs namespace was cleared by M1 (0219: workflow_runs → flow_runs)
-- so renaming playbook_runs → workflow_runs does not collide.
--
-- Tables renamed (9):
--   system_playbook_templates              → system_workflow_templates
--   system_playbook_template_versions      → system_workflow_template_versions
--   playbook_templates                     → workflow_templates
--   playbook_template_versions             → workflow_template_versions
--   playbook_runs                          → workflow_runs
--   playbook_run_event_sequences           → workflow_run_event_sequences
--   playbook_step_runs                     → workflow_step_runs
--   playbook_step_reviews                  → workflow_step_reviews
--   playbook_studio_sessions               → workflow_studio_sessions
--
-- Cross-table column renames (7):
--   subaccount_onboarding_state.playbook_slug                → workflow_slug
--   portal_briefs.playbook_slug                              → workflow_slug
--   modules.onboarding_playbook_slugs                        → onboarding_workflow_slugs
--   onboarding_bundle_configs.playbook_slugs                 → workflow_slugs
--   memory_blocks.last_written_by_playbook_slug              → last_written_by_workflow_slug
--   agent_runs.playbook_step_run_id                          → workflow_step_run_id
--   scheduled_tasks.created_by_playbook_slug                 → created_by_workflow_slug

-- =============================================================================
-- Step 1: Drop FK constraints that reference tables being renamed
-- (must be dropped before the referenced table is renamed)
-- =============================================================================

-- system_playbook_template_versions → system_playbook_templates
ALTER TABLE system_playbook_template_versions
  DROP CONSTRAINT IF EXISTS system_playbook_template_versions_system_template_id_fkey;

-- playbook_templates → system_playbook_templates
ALTER TABLE playbook_templates
  DROP CONSTRAINT IF EXISTS playbook_templates_forked_from_system_id_fkey;

-- playbook_template_versions → playbook_templates
ALTER TABLE playbook_template_versions
  DROP CONSTRAINT IF EXISTS playbook_template_versions_template_id_fkey;

-- playbook_run_event_sequences → playbook_runs
ALTER TABLE playbook_run_event_sequences
  DROP CONSTRAINT IF EXISTS playbook_run_event_sequences_run_id_fkey;

-- playbook_step_runs → playbook_runs
ALTER TABLE playbook_step_runs
  DROP CONSTRAINT IF EXISTS playbook_step_runs_run_id_fkey;

-- playbook_step_reviews → playbook_step_runs
ALTER TABLE playbook_step_reviews
  DROP CONSTRAINT IF EXISTS playbook_step_reviews_step_run_id_fkey;

-- playbook_runs → playbook_template_versions (outbound FK from runs to versions)
ALTER TABLE playbook_runs
  DROP CONSTRAINT IF EXISTS playbook_runs_template_version_id_fkey;

-- subaccount_onboarding_state → playbook_runs
ALTER TABLE subaccount_onboarding_state
  DROP CONSTRAINT IF EXISTS subaccount_onboarding_state_last_run_id_fkey;

-- portal_briefs → playbook_runs
ALTER TABLE portal_briefs
  DROP CONSTRAINT IF EXISTS portal_briefs_run_id_fkey;

-- =============================================================================
-- Step 2: Rename tables
-- =============================================================================

ALTER TABLE system_playbook_templates          RENAME TO system_workflow_templates;
ALTER TABLE system_playbook_template_versions  RENAME TO system_workflow_template_versions;
ALTER TABLE playbook_templates                 RENAME TO workflow_templates;
ALTER TABLE playbook_template_versions         RENAME TO workflow_template_versions;
ALTER TABLE playbook_runs                      RENAME TO workflow_runs;
ALTER TABLE playbook_run_event_sequences       RENAME TO workflow_run_event_sequences;
ALTER TABLE playbook_step_runs                 RENAME TO workflow_step_runs;
ALTER TABLE playbook_step_reviews              RENAME TO workflow_step_reviews;
ALTER TABLE playbook_studio_sessions           RENAME TO workflow_studio_sessions;

-- =============================================================================
-- Step 3: Rename indexes on the renamed tables
-- =============================================================================

-- system_workflow_templates
ALTER INDEX IF EXISTS system_playbook_templates_slug_idx
  RENAME TO system_workflow_templates_slug_idx;

-- system_workflow_template_versions
ALTER INDEX IF EXISTS system_playbook_template_versions_unique_idx
  RENAME TO system_workflow_template_versions_unique_idx;

-- workflow_templates
ALTER INDEX IF EXISTS playbook_templates_org_slug_unique_idx
  RENAME TO workflow_templates_org_slug_unique_idx;
ALTER INDEX IF EXISTS playbook_templates_org_idx
  RENAME TO workflow_templates_org_idx;
ALTER INDEX IF EXISTS playbook_templates_forked_from_idx
  RENAME TO workflow_templates_forked_from_idx;

-- workflow_template_versions
ALTER INDEX IF EXISTS playbook_template_versions_unique_idx
  RENAME TO workflow_template_versions_unique_idx;

-- workflow_runs
ALTER INDEX IF EXISTS playbook_runs_org_status_idx
  RENAME TO workflow_runs_org_status_idx;
ALTER INDEX IF EXISTS playbook_runs_subaccount_status_idx
  RENAME TO workflow_runs_subaccount_status_idx;
ALTER INDEX IF EXISTS playbook_runs_template_version_idx
  RENAME TO workflow_runs_template_version_idx;

-- workflow_step_runs
ALTER INDEX IF EXISTS playbook_step_runs_run_id_status_idx
  RENAME TO workflow_step_runs_run_id_status_idx;
ALTER INDEX IF EXISTS playbook_step_runs_agent_run_id_idx
  RENAME TO workflow_step_runs_agent_run_id_idx;
ALTER INDEX IF EXISTS playbook_step_runs_run_step_live_unique_idx
  RENAME TO workflow_step_runs_run_step_live_unique_idx;

-- workflow_step_reviews
ALTER INDEX IF EXISTS playbook_step_reviews_step_run_idx
  RENAME TO workflow_step_reviews_step_run_idx;

-- workflow_studio_sessions
ALTER INDEX IF EXISTS playbook_studio_sessions_user_idx
  RENAME TO workflow_studio_sessions_user_idx;

-- =============================================================================
-- Step 4: Rename the denormalised playbook_slug column on workflow_runs itself
-- =============================================================================

ALTER TABLE workflow_runs RENAME COLUMN playbook_slug TO workflow_slug;

-- =============================================================================
-- Step 5: Rename cross-table columns on tables that are NOT being renamed
-- =============================================================================

-- subaccount_onboarding_state
ALTER TABLE subaccount_onboarding_state
  RENAME COLUMN playbook_slug TO workflow_slug;

-- Rename indexes that include the old column name
ALTER INDEX IF EXISTS subaccount_onboarding_state_subaccount_slug_uniq
  RENAME TO subaccount_onboarding_state_subaccount_workflow_slug_uniq;
ALTER INDEX IF EXISTS subaccount_onboarding_state_org_idx
  RENAME TO subaccount_onboarding_state_org_workflow_slug_idx;

-- portal_briefs
ALTER TABLE portal_briefs
  RENAME COLUMN playbook_slug TO workflow_slug;

-- Rename index that includes playbook_slug in its name
ALTER INDEX IF EXISTS portal_briefs_subaccount_slug_idx
  RENAME TO portal_briefs_subaccount_workflow_slug_idx;

-- modules
ALTER TABLE modules
  RENAME COLUMN onboarding_playbook_slugs TO onboarding_workflow_slugs;

-- onboarding_bundle_configs
ALTER TABLE onboarding_bundle_configs
  RENAME COLUMN playbook_slugs TO workflow_slugs;

-- memory_blocks
ALTER TABLE memory_blocks
  RENAME COLUMN last_written_by_playbook_slug TO last_written_by_workflow_slug;

-- agent_runs
ALTER TABLE agent_runs
  RENAME COLUMN playbook_step_run_id TO workflow_step_run_id;

-- Rename the index that references the old column name
ALTER INDEX IF EXISTS agent_runs_playbook_step_run_id_idx
  RENAME TO agent_runs_workflow_step_run_id_idx;

-- scheduled_tasks
ALTER TABLE scheduled_tasks
  RENAME COLUMN created_by_playbook_slug TO created_by_workflow_slug;

-- Rename the index that references the old column name
ALTER INDEX IF EXISTS scheduled_tasks_playbook_slug_idx
  RENAME TO scheduled_tasks_workflow_slug_idx;

-- =============================================================================
-- Step 6: Re-add FK constraints with new names
-- =============================================================================

-- system_workflow_template_versions → system_workflow_templates
ALTER TABLE system_workflow_template_versions
  ADD CONSTRAINT system_workflow_template_versions_system_template_id_fkey
  FOREIGN KEY (system_template_id) REFERENCES system_workflow_templates(id) ON DELETE RESTRICT;

-- workflow_templates → system_workflow_templates
ALTER TABLE workflow_templates
  ADD CONSTRAINT workflow_templates_forked_from_system_id_fkey
  FOREIGN KEY (forked_from_system_id) REFERENCES system_workflow_templates(id) ON DELETE SET NULL;

-- workflow_template_versions → workflow_templates
ALTER TABLE workflow_template_versions
  ADD CONSTRAINT workflow_template_versions_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE RESTRICT;

-- workflow_runs → workflow_template_versions
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_template_version_id_fkey
  FOREIGN KEY (template_version_id) REFERENCES workflow_template_versions(id) ON DELETE RESTRICT;

-- workflow_run_event_sequences → workflow_runs
ALTER TABLE workflow_run_event_sequences
  ADD CONSTRAINT workflow_run_event_sequences_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE;

-- workflow_step_runs → workflow_runs
ALTER TABLE workflow_step_runs
  ADD CONSTRAINT workflow_step_runs_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE;

-- workflow_step_reviews → workflow_step_runs
ALTER TABLE workflow_step_reviews
  ADD CONSTRAINT workflow_step_reviews_step_run_id_fkey
  FOREIGN KEY (step_run_id) REFERENCES workflow_step_runs(id) ON DELETE CASCADE;

-- subaccount_onboarding_state → workflow_runs
ALTER TABLE subaccount_onboarding_state
  ADD CONSTRAINT subaccount_onboarding_state_last_run_id_fkey
  FOREIGN KEY (last_run_id) REFERENCES workflow_runs(id);

-- portal_briefs → workflow_runs
ALTER TABLE portal_briefs
  ADD CONSTRAINT portal_briefs_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id);
