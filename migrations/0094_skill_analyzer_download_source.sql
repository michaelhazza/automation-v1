-- Add 'download' to the skill_analyzer_jobs source_type CHECK constraint
ALTER TABLE skill_analyzer_jobs
  DROP CONSTRAINT IF EXISTS skill_analyzer_jobs_source_type_check;

ALTER TABLE skill_analyzer_jobs
  ADD CONSTRAINT skill_analyzer_jobs_source_type_check
  CHECK (source_type IN ('paste', 'upload', 'github', 'download'));
