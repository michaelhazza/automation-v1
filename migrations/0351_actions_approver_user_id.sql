-- Migration 0351: Add approver_user_id to actions
--
-- Adds an optional override for the approval recipient. NULL = preserve V1
-- initiator-defaulted approval path. Cross-owner action proposals set this
-- to the executor agent's owner_user_id so approval routes to the right user.
--
-- Backfill: NULL for all existing rows (no rewrite of historical approvals).
-- FK ON DELETE RESTRICT — prevents orphaning approval records when a user
-- is deleted; the caller must resolve or reassign before deleting.
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §4.1 (migration 0351), §5.5 (approval-owner routing)

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS approver_user_id UUID NULL
    REFERENCES users(id) ON DELETE RESTRICT;
