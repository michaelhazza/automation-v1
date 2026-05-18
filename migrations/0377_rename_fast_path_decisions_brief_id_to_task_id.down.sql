-- Migration B (down): revert task_id back to brief_id on fast_path_decisions
-- All operations are conditional — DOWN may run before UP on a fresh schema.

ALTER INDEX IF EXISTS fast_path_task_idx RENAME TO fast_path_brief_idx;

DO $$BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'fast_path_decisions_task_id_fkey'
    AND t.relname = 'fast_path_decisions'
  ) THEN
    ALTER TABLE fast_path_decisions
      RENAME CONSTRAINT fast_path_decisions_task_id_fkey TO fast_path_decisions_brief_id_fkey;
  END IF;
END $$;

DO $$BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
    AND table_name = 'fast_path_decisions'
    AND column_name = 'task_id'
  ) THEN
    ALTER TABLE fast_path_decisions RENAME COLUMN task_id TO brief_id;
  END IF;
END $$;
