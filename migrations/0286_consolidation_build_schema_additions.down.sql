-- Down migration for 0286_consolidation_build_schema_additions

DROP INDEX IF EXISTS projects_linked_agent_ids_gin;

ALTER TABLE projects DROP COLUMN IF EXISTS migrated_from_goals_at;
ALTER TABLE projects DROP COLUMN IF EXISTS linked_agent_ids;
ALTER TABLE projects DROP COLUMN IF EXISTS objective;

ALTER TABLE agents DROP COLUMN IF EXISTS personality;
