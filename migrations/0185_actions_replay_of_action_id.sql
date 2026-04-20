-- Migration 0185 — actions.replay_of_action_id (ClientPulse Session 2, contract (s))
-- Pre-documents the column the replay-runtime will populate in a future session.
-- Stays NULL for all Session 2 rows — see spec §1.3 Q4.

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS replay_of_action_id uuid NULL REFERENCES actions(id);

CREATE INDEX IF NOT EXISTS actions_replay_of_action_id_idx
  ON actions(replay_of_action_id)
  WHERE replay_of_action_id IS NOT NULL;
