-- Down: remove the seeded System Operations org + sentinel subaccount.
-- WARNING: only run in development/staging — this removes the system escalation target.
DELETE FROM subaccounts WHERE slug = 'system-ops'
  AND organisation_id IN (SELECT id FROM organisations WHERE slug = 'system-ops' AND is_system_org = true);
DELETE FROM organisations WHERE slug = 'system-ops' AND is_system_org = true;
