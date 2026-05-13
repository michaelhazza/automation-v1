-- 0332_executive_assistant_seed.down.sql
-- Removes EA template row and the per-user partial index.
-- Never touches the home_widget column (owned by migration 0331).
--
-- Idempotent against a fresh DB: the migrate runner picks up *.down.sql in lex
-- order before *.sql, so we guard the DELETE on the table's existence.

DROP INDEX IF EXISTS agents_personal_assistant_per_user_idx;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'system_agents'
  ) THEN
    DELETE FROM system_agents WHERE slug = 'executive-assistant';
  END IF;
END $$;
