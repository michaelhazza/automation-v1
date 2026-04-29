-- Migration 0257: Workspace identity permission keys (agents-as-employees).
--
-- Inserts 7 new permission keys and backfills them into existing permission
-- sets using the same pattern as migrations 0201–0204.
--
-- Backfill strategy:
--   "manager" defaults (onboard, view_mailbox, view_calendar, view_activity):
--     → grant to any set that already holds subaccount.workspace.view
--   "org_admin" defaults (all 7):
--     → grant to any set that already holds subaccount.settings.edit
--
-- Uses INSERT ... ON CONFLICT DO NOTHING throughout for idempotency.

-- ── Catalogue inserts ──────────────────────────────────────────────────────

INSERT INTO permissions (key, description, group_name)
VALUES
  ('subaccounts:manage_workspace',
   'Configure and manage the subaccount workspace connector',
   'subaccounts.workspace'),
  ('agents:onboard',
   'Onboard an agent to the workplace (provision identity)',
   'subaccounts.workspace'),
  ('agents:manage_lifecycle',
   'Suspend, resume, or revoke an agent identity',
   'subaccounts.workspace'),
  ('agents:toggle_email',
   'Enable or disable outbound email sending for an agent',
   'subaccounts.workspace'),
  ('agents:view_mailbox',
   'View an agent''s mailbox',
   'subaccounts.workspace'),
  ('agents:view_calendar',
   'View an agent''s calendar',
   'subaccounts.workspace'),
  ('agents:view_activity',
   'View an agent''s activity feed',
   'subaccounts.workspace')
ON CONFLICT (key) DO NOTHING;

-- ── Backfill manager defaults ──────────────────────────────────────────────
-- Grant to sets that already have subaccount.workspace.view (manager-level).

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'agents:onboard'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'agents:onboard'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'agents:view_mailbox'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'agents:view_mailbox'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'agents:view_calendar'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'agents:view_calendar'
  );

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, 'agents:view_activity'
FROM permission_set_items psi
WHERE psi.permission_key = 'subaccount.workspace.view'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = 'agents:view_activity'
  );

-- ── Backfill org_admin defaults ────────────────────────────────────────────
-- Grant all 7 keys to sets that already have subaccount.settings.edit (org_admin-level).

INSERT INTO permission_set_items (permission_set_id, permission_key)
SELECT DISTINCT psi.permission_set_id, key_to_grant.key
FROM permission_set_items psi
CROSS JOIN (
  VALUES
    ('subaccounts:manage_workspace'),
    ('agents:onboard'),
    ('agents:manage_lifecycle'),
    ('agents:toggle_email'),
    ('agents:view_mailbox'),
    ('agents:view_calendar'),
    ('agents:view_activity')
) AS key_to_grant(key)
WHERE psi.permission_key = 'subaccount.settings.edit'
  AND NOT EXISTS (
    SELECT 1 FROM permission_set_items x
    WHERE x.permission_set_id = psi.permission_set_id
      AND x.permission_key = key_to_grant.key
  );
