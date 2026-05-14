-- Migration 0342: Add assigned_user_id to agent_runs
--
-- Stores the user a run is assigned to (the human owner of the task that
-- triggered the run). Populated at run-creation time by the caller; remains
-- null for system-initiated runs (scheduled, triggered, autonomous).
--
-- Why this column exists: the operator-backend task-action routes
-- (POST /api/operator-tasks/:id/retry-chain-failure and
-- POST /api/operator-tasks/:id/extend-budget) authorise by route-specific
-- actor rule "assigned user OR manager+". Before this migration the routes
-- had no data source for the assigned user, so the assigned-user branch
-- was dead code. With this column the actor rule activates: an assigned
-- user with AGENTS_EDIT permission can retry / extend-budget their own
-- task even when they would not normally pass a manager+ check.
--
-- Nullable: not every run has an assigned user (system / scheduled).
-- ON DELETE SET NULL: if a user is deleted their tasks lose the assignee
-- pointer but the run history is preserved.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §6.5b

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_runs_assigned_user_id_idx
  ON agent_runs (assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;
