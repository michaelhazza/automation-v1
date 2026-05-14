-- 0355 down — remove the trigger + emit-audit column.
DROP TRIGGER IF EXISTS trg_delegation_outcomes_substep_status_updated_at ON delegation_outcomes;
DROP FUNCTION IF EXISTS set_delegation_outcomes_substep_status_updated_at();

ALTER TABLE delegation_outcomes DROP COLUMN IF EXISTS awaiting_initiator_event_emitted_at;
