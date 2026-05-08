-- Restore loading_mode column (rollback of 0293).
-- Mirrors the original column + CHECK constraint added in migration 0078.
--
-- Idempotent under the migrate-runner convention: this file is also picked
-- up by `npm run migrate` (regex /^\d{4}_.*\.sql$/) and runs in lex order
-- BEFORE the corresponding up-script, when the loading_mode column still
-- exists from migration 0078. ADD COLUMN IF NOT EXISTS makes the pre-up
-- pass a no-op; DROP/ADD CONSTRAINT pair is already safe via IF EXISTS.
ALTER TABLE agent_data_sources ADD COLUMN IF NOT EXISTS loading_mode text NOT NULL DEFAULT 'eager';
ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_loading_mode_check;
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_loading_mode_check
  CHECK (loading_mode IN ('eager', 'lazy'));
