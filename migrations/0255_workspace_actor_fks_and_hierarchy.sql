-- Migration 0255: Add workspace_actor_id FK columns to agents, users, audit_events;
-- add actor_id FK column to agent_runs. All columns are nullable so existing rows
-- remain valid; backfill is done by the seed script (scripts/seed-workspace-actors.ts)
-- after actor rows are created.
--
-- Note: audit_events.workspace_actor_id is a NEW column named workspace_actor_id,
-- distinct from the existing polymorphic audit_events.actor_id (uuid, nullable,
-- no FK). The existing actor_id column is preserved for legacy writers.

ALTER TABLE agents      ADD COLUMN IF NOT EXISTS workspace_actor_id uuid REFERENCES workspace_actors(id);
ALTER TABLE users       ADD COLUMN IF NOT EXISTS workspace_actor_id uuid REFERENCES workspace_actors(id);
ALTER TABLE agent_runs  ADD COLUMN IF NOT EXISTS actor_id           uuid REFERENCES workspace_actors(id);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS workspace_actor_id uuid REFERENCES workspace_actors(id);

-- Backfill agents: match by display name + org. Runs as a no-op if workspace_actors
-- table is empty (Phase A schema-only deploy); seed script fills this properly.
UPDATE agents
   SET workspace_actor_id = wa.id
  FROM workspace_actors wa
 WHERE wa.actor_kind = 'agent'
   AND wa.display_name = agents.name
   AND wa.organisation_id = agents.organisation_id
   AND agents.workspace_actor_id IS NULL;

-- Backfill users: match by email + org.
UPDATE users
   SET workspace_actor_id = wa.id
  FROM workspace_actors wa
 WHERE wa.actor_kind = 'human'
   AND wa.display_name = users.email
   AND wa.organisation_id = users.organisation_id
   AND users.workspace_actor_id IS NULL;
