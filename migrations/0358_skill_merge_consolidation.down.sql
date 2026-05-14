-- Down migration 0358 — reverse skill merge consolidation pass columns
-- Reverses the up migration in reverse order.

ALTER TABLE skill_analyzer_config DROP COLUMN consolidation_trigger_severity;
ALTER TABLE skill_analyzer_config DROP COLUMN consolidation_enabled;
UPDATE skill_analyzer_config SET warning_tier_map = warning_tier_map - 'CONSOLIDATION_APPLIED' - 'CONSOLIDATION_DECLINED' - 'CONSOLIDATION_FAILED' WHERE key = 'default';
ALTER TABLE skill_analyzer_results DROP COLUMN consolidation_note;
ALTER TABLE skill_analyzer_results DROP COLUMN consolidation_outcome;
ALTER TABLE skill_analyzer_results DROP COLUMN pre_consolidation_merge;
