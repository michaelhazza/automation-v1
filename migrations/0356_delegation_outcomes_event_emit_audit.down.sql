-- 0356 down — remove claim + emit audit columns.
ALTER TABLE delegation_outcomes
  DROP COLUMN IF EXISTS terminal_event_claim_at,
  DROP COLUMN IF EXISTS terminal_event_emitted_at,
  DROP COLUMN IF EXISTS awaiting_initiator_event_claim_at;
