-- Down migration for 0255_workspace_actor_fks_and_hierarchy.sql
ALTER TABLE audit_events DROP COLUMN IF EXISTS workspace_actor_id;
ALTER TABLE agent_runs   DROP COLUMN IF EXISTS actor_id;
ALTER TABLE users        DROP COLUMN IF EXISTS workspace_actor_id;
ALTER TABLE agents       DROP COLUMN IF EXISTS workspace_actor_id;
