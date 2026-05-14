-- Drop deprecated loading_mode column from agent_data_sources.
-- Application references removed in Chunks 4B/4C remediation.
ALTER TABLE agent_data_sources DROP COLUMN loading_mode;
