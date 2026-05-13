-- Migration 0352: Add cross-owner state-machine columns to delegation_outcomes
--
-- Three additive columns for the cross-owner delegation sub-step state machine
-- (spec §9.7). All additions are idempotent (ADD COLUMN IF NOT EXISTS).
--
-- Column 1: cross_owner_approval_timeout_policy
--   NULL = not a cross-owner delegation. Set by crossOwnerDelegationRequestAssembler.
--   Default is 'fail_parent'; 'continue_without_substep' when the parent tool-call
--   payload sets { optional: true }; 'ask_initiator' when the parent emits an
--   explicit fallback signal.
--
-- Column 2: substep_status
--   NOT NULL DEFAULT 'proposed'. Tracks the canonical sub-step lifecycle.
--   Terminal subset: 'success' | 'partial' | 'failed'.
--   Status set is closed — adding a new value requires a spec amendment (§9.7).
--
-- Column 3: terminal_at
--   NULL while the sub-step is in-flight. Set to NOW() when substep_status
--   transitions to a terminal value ('success', 'partial', 'failed').
--   The partial index below supports the "exactly one terminal event per
--   (run_id, substep)" write-time predicate:
--     UPDATE delegation_outcomes SET substep_status = $1, terminal_at = NOW()
--     WHERE id = $2 AND terminal_at IS NULL
--   0 rows affected = already terminal; losing caller reads and emits no event.
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §4.1 (migration 0352), §9.4 (terminal event guarantee), §9.7 (state machine)

ALTER TABLE delegation_outcomes
  ADD COLUMN IF NOT EXISTS cross_owner_approval_timeout_policy TEXT NULL
    CHECK (cross_owner_approval_timeout_policy IN (
      'fail_parent',
      'continue_without_substep',
      'ask_initiator'
    ));

ALTER TABLE delegation_outcomes
  ADD COLUMN IF NOT EXISTS substep_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (substep_status IN (
      'proposed',
      'authorised',
      'routed',
      'executing',
      'awaiting_cross_owner_approval',
      'approved',
      'rejected',
      'success',
      'partial',
      'failed'
    ));

ALTER TABLE delegation_outcomes
  ADD COLUMN IF NOT EXISTS terminal_at TIMESTAMP WITH TIME ZONE NULL;

-- Partial index for the single-terminal-event guarantee (§9.4).
-- Supports: UPDATE ... WHERE id = $1 AND terminal_at IS NULL (O(1) row lookup).
-- Drizzle does not natively support WHERE partial index expressions via the
-- TypeScript schema API; this index is enforced by this migration only and
-- documented with a comment in server/db/schema/delegationOutcomes.ts.
CREATE INDEX IF NOT EXISTS delegation_outcomes_open_substeps_idx
  ON delegation_outcomes (run_id, substep_status)
  WHERE terminal_at IS NULL;
