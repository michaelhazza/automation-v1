-- Migration 0135 — subaccount_onboarding_state resume_state JSONB
--
-- Captures mid-conversation progress for the 9-step onboarding arc so the
-- Configuration Assistant can resume after a browser close or timeout.
-- Null = no mid-conversation progress captured.
--
-- Spec: docs/memory-and-briefings-spec.md §8.6 (S5 resume-from-step)

ALTER TABLE subaccount_onboarding_state
  ADD COLUMN IF NOT EXISTS resume_state jsonb;
