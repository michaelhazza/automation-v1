-- Migration C: drop tasks.brief column
--
-- Pre-condition verified: no live reads of tasks.brief exist in server/ or
-- shared/ outside the schema definition file. The column is unused application
-- code; only server/db/schema/tasks.ts (definition) and a comment in
-- server/services/memoryHealthDataService.ts reference it.
-- The Drizzle schema definition is updated in the same commit as this migration.
-- ---------------------------------------------------------------------------

ALTER TABLE tasks DROP COLUMN IF EXISTS brief;
