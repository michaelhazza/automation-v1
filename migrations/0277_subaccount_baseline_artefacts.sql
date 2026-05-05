-- F1 Sub-Account Baseline Artefacts — schema additions.
-- See docs/sub-account-baseline-artefacts-spec.md §3.
ALTER TABLE memory_blocks
  ADD COLUMN IF NOT EXISTS tier SMALLINT,
  ADD COLUMN IF NOT EXISTS applies_to_domains TEXT[];

CREATE INDEX IF NOT EXISTS memory_blocks_tier_idx
  ON memory_blocks(organisation_id, subaccount_id, tier)
  WHERE tier IS NOT NULL;

ALTER TABLE subaccounts
  ADD COLUMN IF NOT EXISTS baseline_artefacts_status JSONB
  DEFAULT '{"version":1,"tier1":{"brand_identity":{"status":"not_started","captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null},"voice_tone":{"status":"not_started","captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null}},"tier2":{"offer_positioning":{"status":"not_started","captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null},"audience_icp":{"status":"not_started","captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null}},"tier3":{"operating_constraints":{"status":"not_started","captured_at":null,"skipped_at":null,"workspace_memory_id":null,"captured_by_user_id":null},"proof_library":{"status":"not_started","captured_at":null,"skipped_at":null,"workspace_memory_id":null,"captured_by_user_id":null}}}'::jsonb;

-- Backfill existing rows that were created with the previous shorter default
-- (missing the four nullable fields). Uses jsonb_set chain to add missing keys
-- without overwriting captured artefacts.
UPDATE subaccounts
SET baseline_artefacts_status = baseline_artefacts_status
  || '{"tier1":{"brand_identity":{"captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null},"voice_tone":{"captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null}},"tier2":{"offer_positioning":{"captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null},"audience_icp":{"captured_at":null,"skipped_at":null,"memory_block_id":null,"captured_by_user_id":null}},"tier3":{"operating_constraints":{"captured_at":null,"skipped_at":null,"workspace_memory_id":null,"captured_by_user_id":null},"proof_library":{"captured_at":null,"skipped_at":null,"workspace_memory_id":null,"captured_by_user_id":null}}}'::jsonb
WHERE baseline_artefacts_status IS NOT NULL
  AND (baseline_artefacts_status -> 'tier1' -> 'brand_identity' -> 'captured_at') IS NULL;
