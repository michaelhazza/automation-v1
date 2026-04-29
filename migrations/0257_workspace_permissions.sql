-- Migration 0257: Workspace identity permission keys (agents-as-employees).
--
-- Inserts 7 new permission keys and backfills them into existing permission
-- sets using the same pattern as migrations 0201–0204.
--
-- Key naming follows the established dot-namespace convention:
--   subaccount.<group>.<verb>
--
-- Backfill strategy:
--   "manager" defaults (onboard, view_mailbox, view_calendar, view_activity):
--     → grant to any set that already holds subaccount.workspace.view
--   "org_admin" defaults (all 7):
--     → grant to any set that already holds subaccount.settings.edit
--
-- Manager defaults (4 of 7): onboard, view_mailbox, view_calendar, view_activity
-- Org-admin-only  (3 of 7): workspace.manage_connector, agents.manage_lifecycle, agents.toggle_email
--
-- Uses INSERT ... ON CONFLICT DO NOTHING throughout for idempotency.

-- ── Catalogue inserts ──────────────────────────────────────────────────────

INSERT INTO permissions (key, description, group_name)
VALUES
  ('subaccount.workspace.manage_connector',
   'Configure and manage the subaccount workspace connector',
   'subaccount.workspace'),
  ('subaccount.agents.onboard',
   'Onboard an agent to the workplace (provision identity)',
   'subaccount.agents'),
  ('subaccount.agents.manage_lifecycle',
   'Suspend, resume, or revoke an agent identity',
   'subaccount.agents'),
  ('subaccount.agents.toggle_email',
   'Enable or disable outbound email sending for an agent',
   'subaccount.agents'),
  ('subaccount.agents.view_mailbox',
   'View an agent''s mailbox',
   'subaccount.agents'),
  ('subaccount.agents.view_calendar',
   'View an agent''s calendar',
   'subaccount.agents'),
  ('subaccount.agents.view_activity',
   'View an agent''s activity feed',
   'subaccount.agents')
ON CONFLICT (key) DO NOTHING;

-- ── Backfill manager defaults ──────────────────────────────────────────────
-- Grant to sets that already have subaccount.workspace.view (manager-level).

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'subaccount.agents.onboard'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'subaccount.agents.onboard'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'subaccount.agents.view_mailbox'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'subaccount.agents.view_mailbox'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'subaccount.agents.view_calendar'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'subaccount.agents.view_calendar'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'subaccount.agents.view_activity'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'subaccount.agents.view_activity'
  );

-- ── Backfill org_admin defaults ────────────────────────────────────────────
-- Grant all 7 keys to sets that already have subaccount.settings.edit (org_admin-level).

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, key_to_grant.key
FROM permission_set_items psi
CROSS JOIN (
  VALUES
    ('subaccount.workspace.manage_connector'),
    ('subaccount.agents.onboard'),
    ('subaccount.agents.manage_lifecycle'),
    ('subaccount.agents.toggle_email'),
    ('subaccount.agents.view_mailbox'),
    ('subaccount.agents.view_calendar'),
    ('subaccount.agents.view_activity')
) AS key_to_grant(key)
WHERE psi.permission_key = 'subaccount.settings.edit'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = key_to_grant.key
  );
