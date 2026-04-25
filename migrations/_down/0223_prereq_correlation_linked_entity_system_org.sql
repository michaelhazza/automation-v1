-- Down: revert prereq column additions from 0223.
DROP INDEX IF EXISTS organisations_system_org_unique_idx;
ALTER TABLE organisations DROP COLUMN IF EXISTS is_system_org;
ALTER TABLE tasks DROP COLUMN IF EXISTS linked_entity_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS linked_entity_kind;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS correlation_id;
