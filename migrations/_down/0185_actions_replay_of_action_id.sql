-- Down migration for 0185 — drop replay_of_action_id column + its index.
-- Clean rollback: column is NULL on every Session 2 row.

DROP INDEX IF EXISTS actions_replay_of_action_id_idx;
ALTER TABLE actions DROP COLUMN IF EXISTS replay_of_action_id;
