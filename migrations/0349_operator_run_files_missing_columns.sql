-- Migration 0349: Add owner_user_id and subaccount_id to operator_run_files
-- These columns were omitted from migration 0348 (plan-vs-spec drift, resolved 2026-05-13).
-- owner_user_id: executor's owner for file events; null for subaccount-owned agents.
-- subaccount_id: the subaccount the operator run belongs to.
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md §4.1

ALTER TABLE operator_run_files
  ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE operator_run_files
  ADD COLUMN IF NOT EXISTS subaccount_id UUID NULL REFERENCES subaccounts(id) ON DELETE CASCADE;
