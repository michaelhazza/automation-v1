-- Down migration for 0085_policy_rules_confidence_guidance.sql
--
-- Drops the two Sprint 3 P2.3 columns. Safe to run — both are nullable
-- and have no default. Rules that populated them lose the values; the
-- runtime falls back to `CONFIDENCE_GATE_THRESHOLD` from
-- server/config/limits.ts and no decision-time guidance will be
-- injected.

ALTER TABLE policy_rules DROP COLUMN IF EXISTS guidance_text;
ALTER TABLE policy_rules DROP COLUMN IF EXISTS confidence_threshold;
