-- Down for 0277_subaccount_baseline_artefacts.sql
ALTER TABLE subaccounts DROP COLUMN IF EXISTS baseline_artefacts_status;
DROP INDEX IF EXISTS memory_blocks_tier_idx;
ALTER TABLE memory_blocks
  DROP COLUMN IF EXISTS applies_to_domains,
  DROP COLUMN IF EXISTS tier;
