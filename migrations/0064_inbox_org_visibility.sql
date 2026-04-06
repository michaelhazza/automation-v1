-- 0064_inbox_org_visibility.sql
-- Configurable per-subaccount org inbox visibility

ALTER TABLE subaccounts
  ADD COLUMN include_in_org_inbox BOOLEAN NOT NULL DEFAULT true;
