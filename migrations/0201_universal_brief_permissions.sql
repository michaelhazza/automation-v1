-- 0201_universal_brief_permissions.sql
--
-- Universal Brief feature — seed the five new org-level permission keys
-- into `permissions` and backfill them into existing permission sets for
-- deployed orgs. Without this, `requireOrgPermission(...)` on the new
-- /api/briefs and /api/rules routes 403s every non-admin user because the
-- keys never appear in any permission_set_items row.
--
-- Pattern mirrors migrations 0078 (scheduled-task data sources) and 0117
-- (config backups): insert the key, then backfill to sets that already
-- hold a related permission so existing role assignments keep working.

-- ── Catalogue inserts ──────────────────────────────────────────────────────

INSERT INTO permissions (key, description, group_name)
VALUES
  ('org.briefs.read',  'View Briefs and their artefacts',                    'org.briefs'),
  ('org.briefs.write', 'Create Briefs and post messages into a conversation','org.briefs'),
  ('org.rules.read',   'View Learned Rules',                                 'org.rules'),
  ('org.rules.write',  'Create, edit, pause, resume, and delete Rules',      'org.rules'),
  ('org.rules.set_authoritative',
                       'Mark a Rule as authoritative (overrides non-authoritative rules)',
                       'org.rules')
ON CONFLICT (key) DO NOTHING;

-- ── Backfill into existing permission sets ────────────────────────────────
--
-- Principle: grant the new read/write keys to sets that already hold a
-- comparable workspace-level permission, so a user who can currently see /
-- manage workspace content also sees / manages Briefs and Rules. The
-- set_authoritative key is deliberately NOT auto-granted — it is an
-- elevated action and must be assigned explicitly per org.

-- org.briefs.read → anyone who can already view the workspace
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.briefs.read'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.briefs.read'
  );

-- org.briefs.write → anyone who can already manage workspace content
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.briefs.write'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.manage'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.briefs.write'
  );

-- org.rules.read → anyone who can already view the workspace
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.rules.read'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.rules.read'
  );

-- org.rules.write → anyone who can already manage workspace content
INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'org.rules.write'
FROM permission_set_items psi
WHERE psi.permission_key = 'org.workspace.manage'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items existing
    WHERE existing.permission_set_id = psi.permission_set_id
      AND existing.permission_key = 'org.rules.write'
  );
