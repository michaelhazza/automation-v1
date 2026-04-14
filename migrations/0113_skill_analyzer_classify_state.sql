-- migrations/0113_skill_analyzer_classify_state.sql
ALTER TABLE skill_analyzer_jobs
  ADD COLUMN classify_state jsonb NOT NULL DEFAULT '{}';
