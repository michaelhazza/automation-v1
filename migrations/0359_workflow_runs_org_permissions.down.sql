-- 0359_workflow_runs_org_permissions.down.sql
--
-- Reverses the WF5 permission seeding. Removes the four new org-tier
-- workflow-run keys and any permission_set_items rows that reference them.
-- Does NOT restore AGENTS_VIEW / AGENTS_EDIT gates on workflow-run routes —
-- those route changes are code-level and must be reverted via git revert.

DELETE FROM permission_set_items
WHERE permission_key IN (
  'org.workflow_runs.view',
  'org.workflow_runs.cancel',
  'org.workflow_runs.edit_output',
  'org.workflow_runs.approve'
);

DELETE FROM permissions
WHERE key IN (
  'org.workflow_runs.view',
  'org.workflow_runs.cancel',
  'org.workflow_runs.edit_output',
  'org.workflow_runs.approve'
);
