-- Migration 0358 — skill merge conditional consolidation pass
--
-- system-scoped tables touched: none. skill_analyzer_results and
-- skill_analyzer_config are org-scoped; both already in RLS_PROTECTED_TABLES
-- per existing migrations 0092/0155.
--
-- No DB CHECK constraint is added on consolidation_outcome. This repo keeps
-- similar result-state fields as text-only (see executionResult in
-- skillAnalyzerResults.ts:132-133). Closure of the closed enum
-- (not_triggered | succeeded | declined | failed) is enforced at the Drizzle
-- $type<>() boundary, the parseConsolidationResponse parser, and the
-- orchestration writer in skillAnalyzerJob.ts. Reviewers MUST NOT add a CHECK
-- constraint without amending the spec.

ALTER TABLE skill_analyzer_results ADD COLUMN pre_consolidation_merge jsonb;
ALTER TABLE skill_analyzer_results ADD COLUMN consolidation_outcome text;
ALTER TABLE skill_analyzer_results ADD COLUMN consolidation_note text;
ALTER TABLE skill_analyzer_config ADD COLUMN consolidation_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE skill_analyzer_config ADD COLUMN consolidation_trigger_severity text NOT NULL DEFAULT 'warning';
UPDATE skill_analyzer_config SET warning_tier_map = warning_tier_map || '{"CONSOLIDATION_APPLIED":"informational","CONSOLIDATION_DECLINED":"informational","CONSOLIDATION_FAILED":"informational"}'::jsonb WHERE key = 'default';
-- No backfill on skill_analyzer_results. Legacy rows: pre_consolidation_merge=NULL, consolidation_outcome=NULL, consolidation_note=NULL.
