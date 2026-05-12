-- Migration 0328: Create operator_task_profiles table
--
-- Persistent browser profile volumes per task (one row per task attempt).
-- The volume persists across chain links for the same task attempt, allowing
-- browser state to survive the 120-min soft cap boundaries.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.15
-- RLS: dual-GUC policy on BOTH app.organisation_id AND app.subaccount_id (Rev 2 invariant 3)

CREATE TABLE operator_task_profiles (
  id                              UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- One profile per task attempt (spec §3.15 item 1)
  task_id                         UUID         NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,

  -- Tenant scoping (dual-GUC RLS columns)
  organisation_id                 UUID         NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id                   UUID         NOT NULL REFERENCES subaccounts(id) ON DELETE RESTRICT,

  -- Attempt tracking (bumps on fresh-profile restart)
  attempt_number                  INTEGER      NOT NULL DEFAULT 1,

  -- Opaque sandbox-volume identifier (safe to log)
  volume_id                       TEXT         NOT NULL,

  -- Size tracking (updated on each chain link end)
  size_bytes                      BIGINT       NOT NULL DEFAULT 0,

  -- System-wide 500 MB cap (spec §3.15 item 3)
  size_cap_bytes                  BIGINT       NOT NULL DEFAULT 524288000,

  -- Profile lifecycle (spec §3.15 item 4)
  status                          TEXT         NOT NULL DEFAULT 'active',

  -- GC scheduling
  scheduled_gc_at                 TIMESTAMPTZ,
  -- Set on transition to gc_in_progress; cleared on transition to gc_done
  gc_started_at                   TIMESTAMPTZ,

  -- Admin debug-retention extension (spec §3.15 item 4)
  debug_retention_extended_by     UUID         REFERENCES users(id),
  debug_retention_extended_at     TIMESTAMPTZ,

  created_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- CHECK constraints
  CONSTRAINT operator_task_profiles_status_check CHECK (
    status IN ('active', 'scheduled_gc', 'gc_in_progress', 'gc_done')
  ),
  CONSTRAINT operator_task_profiles_attempt_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT operator_task_profiles_size_bytes_non_negative CHECK (size_bytes >= 0),
  CONSTRAINT operator_task_profiles_size_cap_bytes_positive CHECK (size_cap_bytes > 0)
);

-- UNIQUE: at most one profile per (task, attempt)
CREATE UNIQUE INDEX operator_task_profiles_task_attempt_unique_idx ON operator_task_profiles (task_id, attempt_number);

-- RLS: dual-GUC scoping on both organisation_id AND subaccount_id (Rev 2 invariant 3)
ALTER TABLE operator_task_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_task_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY operator_task_profiles_org_subaccount_isolation ON operator_task_profiles
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND current_setting('app.subaccount_id', true) IS NOT NULL
    AND current_setting('app.subaccount_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
    AND subaccount_id = current_setting('app.subaccount_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND current_setting('app.subaccount_id', true) IS NOT NULL
    AND current_setting('app.subaccount_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
    AND subaccount_id = current_setting('app.subaccount_id', true)::uuid
  );
