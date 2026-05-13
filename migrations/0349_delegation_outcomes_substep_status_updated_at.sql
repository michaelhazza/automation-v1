-- Migration 0349: Add substep_status_updated_at to delegation_outcomes
--
-- The cross-owner approval timeout sweep (`workflowGateStallNotifyJob.ts`
-- `crossOwnerApprovalTimeoutSweep`) needs to detect rows that have been in
-- `substep_status = 'awaiting_cross_owner_approval'` for more than 24 hours.
-- Filtering on `created_at` is incorrect: a long-lived delegation row that
-- transitions INTO `awaiting_cross_owner_approval` more than 24h after creation
-- would be immediately timed out by the next sweep, even though the approval
-- wait just started.
--
-- This column records when `substep_status` last changed. Writers must set
-- `substep_status_updated_at = NOW()` on every status transition.
--
-- For pre-existing rows, the DEFAULT NOW() at migration time approximates
-- "status has not moved since the migration ran" — best-effort backfill.
-- Acceptable because no existing rows can be in `awaiting_cross_owner_approval`
-- (the status was introduced in migration 0347 and only the V2 cross-owner
-- delegation path emits it).
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §5.6 (timeout sweep), §9.7 (state machine).

ALTER TABLE delegation_outcomes
  ADD COLUMN IF NOT EXISTS substep_status_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
