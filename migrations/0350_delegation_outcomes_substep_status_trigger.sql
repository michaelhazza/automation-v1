-- Migration 0350: Centrally enforce substep_status_updated_at + emit-audit column.
--
-- Round 2 chatgpt-pr-review for PA-V2 operator. Two follow-ups to migration 0349:
--
-- (F7) substep_status_updated_at is documented as mandatory but was only set by
-- the three writers that exist today (workflowGateStallNotifyJob.ts). Any future
-- writer that forgets to set both columns would break the timeout sweep silently.
-- A BEFORE UPDATE trigger gated on (NEW.substep_status IS DISTINCT FROM OLD.substep_status)
-- enforces the invariant at the DB layer. No-op updates that keep substep_status
-- unchanged (e.g. the ask_initiator race-claim UPDATE) intentionally do NOT bump
-- substep_status_updated_at — the row is still in the same status window.
--
-- (F8) When the timeout sweep's ask_initiator branch lands the approval action
-- (via actionService.proposeAction's idempotent insert) but then crashes before
-- appendEvent succeeds, the event would never be emitted because subsequent
-- sweeps see isNew=false and short-circuit. awaiting_initiator_event_emitted_at
-- tracks the event-side write so re-sweeps can detect the missing event and
-- retry appendEvent independently of proposeAction's idempotency dedupe.
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §5.6 (timeout sweep), §9.4 (terminal event guarantee), §9.7 (state machine).
-- Pairs with migration 0349 (column add).

-- Audit column: NULL until the awaiting_initiator_decision event lands; set to
-- NOW() immediately after appendEvent succeeds. Nullable + no default so an
-- INSERT without an explicit value defaults to NULL (the desired "not yet
-- emitted" state for fresh rows).
ALTER TABLE delegation_outcomes
  ADD COLUMN IF NOT EXISTS awaiting_initiator_event_emitted_at TIMESTAMP WITH TIME ZONE NULL;

-- Trigger: auto-bump substep_status_updated_at when substep_status actually changes.
-- Uses IS DISTINCT FROM so updates that re-write the same value (e.g. the
-- ask_initiator race-claim) do NOT touch substep_status_updated_at.
CREATE OR REPLACE FUNCTION set_delegation_outcomes_substep_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.substep_status_updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delegation_outcomes_substep_status_updated_at ON delegation_outcomes;

CREATE TRIGGER trg_delegation_outcomes_substep_status_updated_at
  BEFORE UPDATE ON delegation_outcomes
  FOR EACH ROW
  WHEN (NEW.substep_status IS DISTINCT FROM OLD.substep_status)
  EXECUTE FUNCTION set_delegation_outcomes_substep_status_updated_at();
