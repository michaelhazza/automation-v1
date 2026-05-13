-- Migration 0351: Atomic claim + emit audit columns for cross-owner timeout events.
--
-- Round 3 chatgpt-pr-review for PA-V2 operator. Two follow-ups to migrations
-- 0349 and 0350:
--
-- (F10) The fail_parent and continue_without_substep timeout branches transition
-- delegation_outcomes to a terminal state (sets terminalAt) BEFORE emitting the
-- cross_owner_substep.completed event. If appendEvent fails after the terminal
-- transition, the row is locked out of subsequent sweeps (WHERE terminalAt IS NULL
-- no longer matches) and the terminal event is permanently lost. Same shape as F8,
-- but for the terminal-emit path.
--
-- (F11) The ask_initiator branch currently uses read-then-write to gate event
-- emission (read row.awaitingInitiatorEventEmittedAt, append if null, then set
-- the column). Two overlapping sweeps could both observe null and both append,
-- producing duplicate cross_owner_substep.awaiting_initiator_decision events.
--
-- Both fixes use the same claim+emit pattern:
--   1. Atomic claim: UPDATE <type>_event_claim_at = NOW() WHERE id = $1 AND
--      <type>_event_emitted_at IS NULL AND (<type>_event_claim_at IS NULL OR
--      <type>_event_claim_at < $cutoff) RETURNING id
--   2. If 0 rows, skip (another sweep claimed or already emitted).
--   3. If 1 row, attempt appendEvent.
--   4. On appendEvent success: UPDATE <type>_event_emitted_at = NOW().
--   5. On appendEvent failure: leave columns alone. Stale-claim threshold (5 min)
--      releases the claim for a future retry.
--
-- Residual risk: if a sweep crashes between successful appendEvent and the
-- emitted_at UPDATE, then waits past the stale-claim threshold, the next sweep
-- re-claims and re-emits. That produces a duplicate event. The window is small
-- (single-process DB transient between two adjacent UPDATEs) and the alternative
-- (full event-idempotency support in agent_execution_events) is out of scope for
-- this build. Documented as a known limitation.
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §5.6 (timeout sweep), §9.4 (terminal event guarantee).
-- Pairs with migrations 0349 + 0350.

ALTER TABLE delegation_outcomes
  ADD COLUMN IF NOT EXISTS terminal_event_claim_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS terminal_event_emitted_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS awaiting_initiator_event_claim_at TIMESTAMP WITH TIME ZONE NULL;
