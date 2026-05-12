-- Migration 0327: Create operator_runs table
--
-- Chain-link rows for the operator_managed execution backend.
-- One row per chain link; a single agent_run spans 1..N chain links.
-- Parallel to iee_runs; operator_managed uses this as its terminalStateTable.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.3, §6
-- RLS: dual-GUC policy on BOTH app.organisation_id AND app.subaccount_id (Rev 2 invariant 3)

CREATE TABLE operator_runs (
  id                                UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Parent task
  agent_run_id                      UUID         NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,

  -- Tenant scoping (dual-GUC RLS columns)
  organisation_id                   UUID         NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id                     UUID         NOT NULL REFERENCES subaccounts(id) ON DELETE RESTRICT,

  -- Chain-link position
  chain_seq                         INTEGER      NOT NULL,
  parent_chain_link_id              UUID         REFERENCES operator_runs(id) ON DELETE SET NULL,

  -- Attempt tracking (fresh-profile restart semantics — spec §3.15 item 7)
  attempt_number                    INTEGER      NOT NULL DEFAULT 1,
  superseded_by_attempt             INTEGER,

  -- Sandbox image pinning (spec §3.5)
  image_tag                         TEXT         NOT NULL,

  -- Vendor session identifier (opaque; surfaced in Run Trace and incidents)
  vendor_session_id                 TEXT,

  -- Credential mode columns
  -- credential_start_mode: IMMUTABLE — the mode the chain link was dispatched under.
  -- Source of truth for subscription_mediated cost-row eligibility (spec §3.12.B).
  credential_start_mode             TEXT         NOT NULL,
  -- credential_mode: MUTABLE current mode (flipped to 'api_key' on mid-run fallback).
  credential_mode                   TEXT         NOT NULL,

  -- Chain-link lifecycle
  status                            TEXT         NOT NULL DEFAULT 'pending',
  failure_reason                    TEXT,
  -- Sub-flag: hard-cap unresumable without reaching a checkpoint-safe state
  failed_mid_step                   BOOLEAN      NOT NULL DEFAULT false,

  -- Timing
  started_at                        TIMESTAMPTZ,
  completed_at                      TIMESTAMPTZ,

  -- Finaliser idempotency stamp (set after operator-session-completed event emitted)
  event_emitted_at                  TIMESTAMPTZ,

  -- Cost mirrors (ledger is source of truth; cheap-read denormalisations)
  cost_subscription_mediated_cents  INTEGER      NOT NULL DEFAULT 0,
  cost_sandbox_compute_cents        INTEGER      NOT NULL DEFAULT 0,

  -- Progress tracking
  step_count                        INTEGER      NOT NULL DEFAULT 0,
  last_progress_at                  TIMESTAMPTZ,

  -- Settings snapshot: effective caps captured at dispatch time (spec §3.3)
  settings_snapshot                 JSONB        NOT NULL,

  -- Cancellation (spec §3.10)
  cancel_requested_at               TIMESTAMPTZ,
  cancel_requested_by_user_id       UUID         REFERENCES users(id),

  -- Checkpoint payload (encrypted-at-rest; spec §3.14 item 10, §4.6)
  checkpoint_payload                JSONB,

  -- Persistent browser profile pointer (spec §3.15)
  profile_volume_id                 TEXT,

  created_at                        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- CHECK constraints
  CONSTRAINT operator_runs_credential_start_mode_check CHECK (
    credential_start_mode IN ('operator_session', 'api_key')
  ),
  CONSTRAINT operator_runs_credential_mode_check CHECK (
    credential_mode IN ('operator_session', 'api_key')
  ),
  CONSTRAINT operator_runs_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT operator_runs_chain_seq_positive CHECK (chain_seq >= 1),
  CONSTRAINT operator_runs_attempt_number_positive CHECK (attempt_number >= 1)
);

-- Indexes (spec §3.3)
-- UNIQUE: at most one chain link per (task, attempt, seq)
CREATE UNIQUE INDEX operator_runs_task_attempt_seq_unique_idx ON operator_runs (agent_run_id, attempt_number, chain_seq);
-- Common dashboard query
CREATE INDEX operator_runs_org_subaccount_status_idx ON operator_runs (organisation_id, subaccount_id, status);
-- Heartbeat-stale reconcile scan (partial: only running rows)
CREATE INDEX operator_runs_running_progress_idx ON operator_runs (status, last_progress_at) WHERE status = 'running';

-- RLS: dual-GUC scoping on both organisation_id AND subaccount_id (Rev 2 invariant 3)
ALTER TABLE operator_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY operator_runs_org_subaccount_isolation ON operator_runs
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
