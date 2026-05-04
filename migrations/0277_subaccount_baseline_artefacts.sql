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
  DEFAULT '{"version":1,"tier1":{"brand_identity":{"status":"not_started"},"voice_tone":{"status":"not_started"}},"tier2":{"offer_positioning":{"status":"not_started"},"audience_icp":{"status":"not_started"}},"tier3":{"operating_constraints":{"status":"not_started"},"proof_library":{"status":"not_started"}}}'::jsonb;
