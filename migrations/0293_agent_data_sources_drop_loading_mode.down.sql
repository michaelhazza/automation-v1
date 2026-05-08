-- Restore loading_mode column (rollback of 0293).
-- Mirrors the original column + CHECK constraint added in migration 0078.
ALTER TABLE agent_data_sources ADD COLUMN loading_mode text NOT NULL DEFAULT 'eager';
ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_loading_mode_check;
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_loading_mode_check
  CHECK (loading_mode IN ('eager', 'lazy'));
