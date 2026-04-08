-- 0078_scheduled_task_data_sources.sql
--
-- Adds scheduled-task scoping and loading-mode support to agent_data_sources,
-- plus a context_sources_snapshot column on agent_runs for per-run debugging.
--
-- Context: agent_data_sources already has an (unused-in-fetch) subaccount_agent_id
-- column for subaccount-level scoping. This migration adds a parallel
-- scheduled_task_id column for scheduled-task-level scoping, plus a loading_mode
-- column that controls whether a source is stuffed into the system prompt
-- (eager) or only surfaced in the manifest for on-demand retrieval via
-- read_data_source (lazy).
--
-- A CHECK constraint enforces that a row cannot be both subaccount-scoped and
-- scheduled-task-scoped — the two scopes are orthogonal and mutually exclusive.
--
-- A partial unique index prevents two data sources with the same name from
-- existing within the same scope (per-agent, per-subaccount-link, or
-- per-scheduled-task).

ALTER TABLE agent_data_sources
  ADD COLUMN IF NOT EXISTS scheduled_task_id UUID
    REFERENCES scheduled_tasks(id) ON DELETE CASCADE;

ALTER TABLE agent_data_sources
  ADD COLUMN IF NOT EXISTS loading_mode TEXT NOT NULL DEFAULT 'eager';

-- Enforce loading_mode enum shape
ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_loading_mode_check;
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_loading_mode_check
  CHECK (loading_mode IN ('eager', 'lazy'));

-- Mutual exclusion of scoping columns
ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_scope_exclusive_check;
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_scope_exclusive_check
  CHECK (
    NOT (subaccount_agent_id IS NOT NULL AND scheduled_task_id IS NOT NULL)
  );

-- Index for scheduled-task-scoped lookups
CREATE INDEX IF NOT EXISTS agent_data_sources_scheduled_task_idx
  ON agent_data_sources (scheduled_task_id)
  WHERE scheduled_task_id IS NOT NULL;

-- Uniqueness per scope: the triple (agent_id, scope_key, name) must be unique
-- where scope_key is effectively:
--   agent-scoped          → (NULL, NULL)
--   subaccount-scoped     → (subaccount_agent_id, NULL)
--   scheduled-task-scoped → (NULL, scheduled_task_id)
CREATE UNIQUE INDEX IF NOT EXISTS agent_data_sources_unique_per_scope_idx
  ON agent_data_sources (
    agent_id,
    COALESCE(subaccount_agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scheduled_task_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name
  )
  WHERE name IS NOT NULL;

-- Snapshot of the context sources considered for each agent run.
-- Populated at run start by loadRunContextData; never updated afterward
-- except for the optional safety-net truncated: true flip post-render.
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS context_sources_snapshot JSONB;

-- ─── Permission backfill (spec §10.2 / pr-reviewer Blocker 4) ──────────────
--
-- Insert the new permission key into the global permissions table if it
-- doesn't already exist, then grant it to every existing permission set
-- that already grants `org.agents.edit`. Without this backfill, existing
-- deployments would have the new key declared in the application code but
-- not granted to anyone except org admins (who get it via the seeder's
-- Object.values(ORG_PERMISSIONS) for fresh orgs), so the new data-source
-- routes would 403 for everyone in production.

INSERT INTO permissions (key, description, group_name)
VALUES (
  'org.scheduled_tasks.data_sources.manage',
  'Manage data sources (reference files, URLs) attached to scheduled tasks',
  'org.agents'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT psi.permission_set_id, 'org.scheduled_tasks.data_sources.manage'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.agents.edit'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.scheduled_tasks.data_sources.manage'
  );
