-- Down-script: refuses to drop the column while any system_agents row uses it.
-- This guards against accidentally severing template configurations.
--
-- Idempotent against a fresh DB: the migrate runner picks up *.down.sql in lex
-- order before *.sql, so we check for the table and column before referencing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_agents' AND column_name = 'home_widget'
  ) THEN
    -- Column doesn't exist yet (fresh DB applying down before up); nothing to do.
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM system_agents WHERE home_widget IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot drop system_agents.home_widget while rows still use it';
  END IF;
  ALTER TABLE system_agents DROP COLUMN IF EXISTS home_widget;
END $$;
