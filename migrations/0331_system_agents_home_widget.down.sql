-- Down-script: refuses to drop the column while any system_agents row uses it.
-- This guards against accidentally severing template configurations.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM system_agents WHERE home_widget IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot drop system_agents.home_widget while rows still use it';
  END IF;
  ALTER TABLE system_agents DROP COLUMN IF EXISTS home_widget;
END $$;
