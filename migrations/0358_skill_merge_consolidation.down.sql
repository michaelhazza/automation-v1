-- Down migration 0358 — reverse skill merge consolidation pass columns
-- Reverses the up migration in reverse order.
--
-- Idempotent (IF EXISTS) because scripts/migrate.ts:37 treats every *.sql in
-- migrations/ as a forward migration to apply in lexical order, and
-- `0358_*.down.sql` sorts BEFORE `0358_*.sql` (the `.` before `down` < the
-- terminating `.sql`). Without IF EXISTS, fresh-DB CI runs fail on the down
-- migration before the up gets a chance. Convention matches all 89 existing
-- *.down.sql files in this directory.

ALTER TABLE skill_analyzer_config DROP COLUMN IF EXISTS consolidation_trigger_severity;
ALTER TABLE skill_analyzer_config DROP COLUMN IF EXISTS consolidation_enabled;
UPDATE skill_analyzer_config SET warning_tier_map = warning_tier_map - 'CONSOLIDATION_APPLIED' - 'CONSOLIDATION_DECLINED' - 'CONSOLIDATION_FAILED' WHERE key = 'default';
ALTER TABLE skill_analyzer_results DROP COLUMN IF EXISTS consolidation_note;
ALTER TABLE skill_analyzer_results DROP COLUMN IF EXISTS consolidation_outcome;
ALTER TABLE skill_analyzer_results DROP COLUMN IF EXISTS pre_consolidation_merge;
