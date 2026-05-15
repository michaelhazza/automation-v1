-- 0359_workflow_runs_org_permissions.sql
--
-- WF5 — Org-tier workflow-run permission family (spec §7, plan §3b).
--
-- Adds four new org-level permission keys for workflow run operations that were
-- previously gated on AGENTS_VIEW / AGENTS_EDIT (too broad). The fifth
-- required permission (EXECUTE semantics) reuses the existing
-- org.workflow_runs.start key added in migration 0171.
--
-- Route gate changes land in the same PR (server/routes/workflowRuns.ts).
-- Backfill grants the new keys to any permission set that already holds the
-- corresponding agents.* key so existing role assignments keep working.

-- ── Catalogue inserts ──────────────────────────────────────────────────────

INSERT INTO permissions (key, description, group_name)
VALUES
  ('org.workflow_runs.view',
   'View Workflow runs at the org level',
   'org.workflows'),
  ('org.workflow_runs.cancel',
   'Cancel running Workflows at the org level',
   'org.workflows'),
  ('org.workflow_runs.edit_output',
   'Edit completed step outputs and submit form inputs (org)',
   'org.workflows'),
  ('org.workflow_runs.approve',
   'Decide on Workflow approval gates (org)',
   'org.workflows')
ON CONFLICT (key) DO NOTHING;

-- ── Backfill into existing permission sets ────────────────────────────────
--
-- org.workflow_runs.view → sets that already hold org.agents.view
-- (view access to agents implies view access to agent-driven workflow runs)

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.workflow_runs.view'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.agents.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.workflow_runs.view'
  );

-- org.workflow_runs.cancel → sets that already hold org.agents.edit

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.workflow_runs.cancel'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.agents.edit'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.workflow_runs.cancel'
  );

-- org.workflow_runs.edit_output → sets that already hold org.agents.edit

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.workflow_runs.edit_output'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.agents.edit'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.workflow_runs.edit_output'
  );

-- org.workflow_runs.approve → sets that already hold org.agents.edit

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.workflow_runs.approve'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.agents.edit'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.workflow_runs.approve'
  );
