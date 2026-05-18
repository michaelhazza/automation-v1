-- 0379_deterministic_validators_phase_1.down.sql
-- Rollback for 0379_deterministic_validators_phase_1.sql

DROP TABLE IF EXISTS validator_invocations;
DROP TABLE IF EXISTS validator_versions;

ALTER TABLE scorecards DROP COLUMN IF EXISTS inconclusive_alert_threshold;

ALTER TABLE scorecard_judgements DROP COLUMN IF EXISTS validator_version;
ALTER TABLE scorecard_judgements DROP COLUMN IF EXISTS validator_slug;
ALTER TABLE scorecard_judgements DROP COLUMN IF EXISTS evaluation_method;
