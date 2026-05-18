-- Migration E: backfill tasks.description and set NOT NULL
UPDATE tasks SET description = '' WHERE description IS NULL;
ALTER TABLE tasks ALTER COLUMN description SET NOT NULL;
