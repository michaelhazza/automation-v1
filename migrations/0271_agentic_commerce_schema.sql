-- Migration 0271: Agentic Commerce — New Tables, ENUMs, Triggers, and RLS
-- Spec: tasks/builds/agentic-commerce/spec.md §5
-- Plan: tasks/builds/agentic-commerce/plan.md §3.4 / Chunk 2
-- Branch: claude/agentic-commerce-spending
--
-- This migration creates:
--   1. Four closed Postgres ENUM types (invariant 30):
--      - agent_charge_status
--      - agent_charge_mode
--      - agent_charge_kind
--      - agent_charge_transition_caller
--   2. Seven new tables with canonical org-isolation RLS policies:
--      - spending_budgets
--      - spending_policies
--      - agent_charges
--      - subaccount_approval_channels
--      - org_approval_channels
--      - org_subaccount_channel_grants
--      - spending_budget_approvers
--   3. BEFORE UPDATE / BEFORE DELETE triggers on agent_charges for
--      append-only enforcement (spec §5.1, §4 transitions, plan §2.3).
--   4. organisations.shadow_charge_retention_days column.
--
-- GUC: app.spend_caller
--   Purpose: Set by application code via SET LOCAL before performing agent_charges
--   UPDATE operations that require caller-identity gating. Used by the trigger
--   agent_charges_validate_update to permit:
--     - The failed → succeeded carve-out (only when app.spend_caller =
--       'stripe_webhook'), per invariant 33 / spec §4.
--     - Non-status provider_charge_id updates on executed rows (only when
--       app.spend_caller IN ('worker_completion', 'stripe_webhook')).
--     - DELETE operations (only when app.spend_caller = 'retention_purge' AND
--       the row status = 'shadow_settled').
--   This GUC is a trigger-only variable. It MUST NOT be referenced by RLS
--   policies; the canonical RLS session variables remain app.organisation_id,
--   app.current_subaccount_id, app.current_principal_type, etc. (see
--   architecture.md § Canonical RLS session variables).
--   Set pattern: SET LOCAL "app.spend_caller" = 'stripe_webhook';
--   Must be called inside a transaction (withOrgTx) so the SET LOCAL is scoped
--   to that transaction only.

-- ── 1. Closed ENUM types (invariant 30) ──────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE agent_charge_status AS ENUM (
    'proposed',
    'pending_approval',
    'approved',
    'executed',
    'succeeded',
    'failed',
    'blocked',
    'denied',
    'disputed',
    'shadow_settled',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_charge_mode AS ENUM (
    'shadow',
    'live'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_charge_kind AS ENUM (
    'outbound_charge',
    'inbound_refund'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_charge_transition_caller AS ENUM (
    'charge_router',
    'stripe_webhook',
    'timeout_job',
    'worker_completion',
    'approval_expiry_job',
    'retention_purge'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. spending_budgets ───────────────────────────────────────────────────────

CREATE TABLE spending_budgets (
  id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                  UUID NOT NULL REFERENCES organisations(id),
  subaccount_id                    UUID REFERENCES subaccounts(id),
  agent_id                         UUID REFERENCES agents(id),
  currency                         TEXT NOT NULL,
  name                             TEXT NOT NULL,
  -- Kill Switch: per-budget revocation timestamp. NULL = active.
  disabled_at                      TIMESTAMPTZ,
  monthly_spend_alert_threshold_minor INTEGER,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spending_budgets_org_idx
  ON spending_budgets(organisation_id);

CREATE INDEX spending_budgets_subaccount_idx
  ON spending_budgets(subaccount_id)
  WHERE subaccount_id IS NOT NULL;

CREATE INDEX spending_budgets_agent_idx
  ON spending_budgets(agent_id)
  WHERE agent_id IS NOT NULL;

-- At most one active budget per (subaccount, currency) pair.
CREATE UNIQUE INDEX spending_budgets_subaccount_currency_uniq
  ON spending_budgets(subaccount_id, currency)
  WHERE subaccount_id IS NOT NULL AND agent_id IS NULL;

-- At most one budget per agent.
CREATE UNIQUE INDEX spending_budgets_agent_uniq
  ON spending_budgets(agent_id)
  WHERE agent_id IS NOT NULL;

ALTER TABLE spending_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE spending_budgets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spending_budgets_org_isolation ON spending_budgets;
CREATE POLICY spending_budgets_org_isolation ON spending_budgets
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 3. spending_policies ──────────────────────────────────────────────────────

CREATE TABLE spending_policies (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           UUID NOT NULL REFERENCES organisations(id),
  spending_budget_id        UUID NOT NULL REFERENCES spending_budgets(id),
  mode                      TEXT NOT NULL CHECK (mode IN ('shadow', 'live')),
  per_txn_limit_minor       INTEGER NOT NULL DEFAULT 0,
  daily_limit_minor         INTEGER NOT NULL DEFAULT 0,
  monthly_limit_minor       INTEGER NOT NULL DEFAULT 0,
  approval_threshold_minor  INTEGER NOT NULL DEFAULT 0,
  merchant_allowlist        JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_expires_hours    INTEGER NOT NULL DEFAULT 24,
  version                   INTEGER NOT NULL DEFAULT 1,
  velocity_config           JSONB,
  confidence_gate_config    JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spending_policies_org_idx
  ON spending_policies(organisation_id);

CREATE INDEX spending_policies_budget_idx
  ON spending_policies(spending_budget_id);

ALTER TABLE spending_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE spending_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spending_policies_org_isolation ON spending_policies;
CREATE POLICY spending_policies_org_isolation ON spending_policies
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 4. agent_charges ─────────────────────────────────────────────────────────
--
-- Spend Ledger. Append-only for non-terminal rows. DB-level trigger prevents
-- UPDATE/DELETE except for lifecycle state transitions (per spec §4 and §5.1)
-- and the shadow-purge retention job.
--
-- Closed ENUM columns (invariant 30):
--   status, mode, kind, last_transition_by, last_aggregated_state
--
-- parent_charge_id CHECK: NULL when kind = 'outbound_charge', non-null when
-- kind = 'inbound_refund' (invariant 41).

CREATE TABLE agent_charges (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           UUID NOT NULL REFERENCES organisations(id),
  subaccount_id             UUID REFERENCES subaccounts(id),
  spending_budget_id        UUID NOT NULL REFERENCES spending_budgets(id),
  spending_policy_id        UUID NOT NULL REFERENCES spending_policies(id),
  policy_version            INTEGER NOT NULL,
  agent_id                  UUID,
  skill_run_id              UUID,
  action_id                 UUID,
  -- Unique key preventing duplicate ledger inserts (invariant 4).
  idempotency_key           TEXT NOT NULL,
  intent_id                 UUID NOT NULL,
  intent                    TEXT NOT NULL,
  charge_type               TEXT NOT NULL,
  direction                 TEXT NOT NULL,
  -- Always positive; CHECK enforced here (invariant 19).
  amount_minor              BIGINT NOT NULL CHECK (amount_minor > 0),
  currency                  TEXT NOT NULL,
  merchant_id               TEXT,
  merchant_descriptor       TEXT,
  status                    agent_charge_status NOT NULL,
  mode                      agent_charge_mode NOT NULL,
  kind                      agent_charge_kind NOT NULL DEFAULT 'outbound_charge',
  provider_charge_id        TEXT,
  spt_connection_id         UUID,
  decision_path             JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason            TEXT,
  -- For refunds: points to the original outbound charge (invariant 41).
  parent_charge_id          UUID REFERENCES agent_charges(id),
  -- For retries after SPT expiry.
  replay_of_charge_id       UUID REFERENCES agent_charges(id),
  -- 'workflow' | 'manual' | 'scheduled' | 'retry' — reserved, not required for v1.
  provenance                TEXT,
  expires_at                TIMESTAMPTZ,
  approval_expires_at       TIMESTAMPTZ,
  approved_at               TIMESTAMPTZ,
  executed_at               TIMESTAMPTZ,
  settled_at                TIMESTAMPTZ,
  -- Closed ENUM (invariant 30). Defaults to charge_router on initial propose.
  last_transition_by        agent_charge_transition_caller NOT NULL DEFAULT 'charge_router',
  -- Stripe event id or pg-boss job id for the most recent transition.
  last_transition_event_id  TEXT,
  -- NULL on insert; updated by aggregator for invariant 27 idempotency.
  last_aggregated_state     agent_charge_status,
  metadata_json             JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_charges_idempotency_key_uniq UNIQUE (idempotency_key),
  -- parent_charge_id is NULL iff kind = 'outbound_charge' (invariant 41).
  CONSTRAINT agent_charges_parent_charge_kind_check
    CHECK (
      (kind = 'outbound_charge' AND parent_charge_id IS NULL)
      OR (kind = 'inbound_refund' AND parent_charge_id IS NOT NULL)
    )
);

CREATE INDEX agent_charges_org_idx
  ON agent_charges(organisation_id);

CREATE INDEX agent_charges_subaccount_idx
  ON agent_charges(subaccount_id, organisation_id)
  WHERE subaccount_id IS NOT NULL;

CREATE INDEX agent_charges_budget_idx
  ON agent_charges(spending_budget_id);

CREATE INDEX agent_charges_status_idx
  ON agent_charges(status, organisation_id);

CREATE INDEX agent_charges_intent_idx
  ON agent_charges(intent_id);

-- Supports execution-window timeout job scan (WHERE status = 'approved' AND expires_at < NOW()).
CREATE INDEX agent_charges_approved_expires_idx
  ON agent_charges(status, expires_at)
  WHERE status = 'approved';

-- Supports approval-expiry job scan (WHERE status = 'pending_approval' AND approval_expires_at < NOW()).
CREATE INDEX agent_charges_pending_approval_expires_idx
  ON agent_charges(status, approval_expires_at)
  WHERE status = 'pending_approval';

-- ── 4a. agent_charges: append-only trigger ───────────────────────────────────
--
-- Enforces:
--   1. Only mutable-on-transition columns (spec §5.1 allowlist) may be written.
--   2. Status transitions must match spec §4.
--   3. failed → succeeded carve-out only when app.spend_caller = 'stripe_webhook'.
--   4. No-status updates (provider_charge_id only) only on executed rows when
--      app.spend_caller IN ('worker_completion', 'stripe_webhook').
--   5. DELETE only when app.spend_caller = 'retention_purge' AND
--      row status = 'shadow_settled'.
--
-- Caller identity is set via: SET LOCAL "app.spend_caller" = '<caller>';
-- inside withOrgTx before the UPDATE. This GUC is trigger-only — not used by
-- RLS policies.

CREATE OR REPLACE FUNCTION agent_charges_validate_update()
RETURNS trigger AS $$
DECLARE
  v_caller TEXT;
  v_allowed BOOLEAN;
  v_changed_cols TEXT[];
BEGIN
  -- Collect caller identity from session GUC (trigger-only; not RLS).
  v_caller := current_setting('app.spend_caller', true);

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- ── Status transition: validate (OLD.status, NEW.status) is permitted ──

    v_allowed := FALSE;

    CASE
      -- Non-terminal → non-terminal / terminal transitions per spec §4
      WHEN OLD.status = 'proposed' AND NEW.status IN (
        'blocked', 'pending_approval', 'approved'
      ) THEN v_allowed := TRUE;

      WHEN OLD.status = 'pending_approval' AND NEW.status IN (
        'approved', 'denied'
      ) THEN v_allowed := TRUE;

      WHEN OLD.status = 'approved' AND NEW.status IN (
        'blocked', 'executed', 'shadow_settled'
      ) THEN v_allowed := TRUE;

      WHEN OLD.status = 'executed' AND NEW.status IN (
        'succeeded', 'failed'
      ) THEN v_allowed := TRUE;

      WHEN OLD.status = 'succeeded' AND NEW.status IN (
        'refunded', 'disputed'
      ) THEN v_allowed := TRUE;

      WHEN OLD.status = 'disputed' AND NEW.status IN (
        'succeeded', 'refunded'
      ) THEN v_allowed := TRUE;

      -- failed → succeeded carve-out (invariant 33): only via stripe_webhook.
      -- Allows timeout-row reconciliation when Stripe confirms the charge succeeded.
      WHEN OLD.status = 'failed' AND NEW.status = 'succeeded' THEN
        IF v_caller = 'stripe_webhook' THEN
          v_allowed := TRUE;
        ELSE
          RAISE EXCEPTION
            'invalid agent_charges transition: % → % requires app.spend_caller = ''stripe_webhook'', got ''%''',
            OLD.status, NEW.status, COALESCE(v_caller, '(unset)');
        END IF;

      ELSE
        -- All other transitions are forbidden.
        NULL;
    END CASE;

    IF NOT v_allowed THEN
      RAISE EXCEPTION
        'invalid agent_charges transition: % → %',
        OLD.status, NEW.status;
    END IF;

    -- ── Mutable-on-transition allowlist check (spec §5.1) ────────────────────
    -- Columns allowed to change on ANY status transition.
    -- Columns NOT in this list are immutable post-insert, with three carve-outs
    -- (spending_policy_id, policy_version, mode) that may also change on the
    -- proposed → X transition only — these three are snapshot at gate-evaluation
    -- time, not at INSERT time.
    v_changed_cols := ARRAY[]::TEXT[];

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NULL; -- status itself is always allowed (it's the transition)
    END IF;
    IF NEW.action_id IS DISTINCT FROM OLD.action_id THEN
      NULL; -- allowed: set when transitioning to pending_approval
    END IF;
    IF NEW.provider_charge_id IS DISTINCT FROM OLD.provider_charge_id THEN
      NULL; -- allowed: set when transitioning to executed (main_app_stripe path)
    END IF;
    IF NEW.spt_connection_id IS DISTINCT FROM OLD.spt_connection_id THEN
      NULL; -- allowed: set when transitioning to executed or shadow_settled
    END IF;
    IF NEW.decision_path IS DISTINCT FROM OLD.decision_path THEN
      NULL; -- allowed: extended at each gate evaluation
    END IF;
    IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN
      NULL; -- allowed: set when transitioning to blocked, denied, or failed
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      NULL; -- allowed: set when transitioning to approved
    END IF;
    IF NEW.executed_at IS DISTINCT FROM OLD.executed_at THEN
      NULL; -- allowed: set when transitioning to executed or shadow_settled
    END IF;
    IF NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
      NULL; -- allowed: set when transitioning to succeeded, refunded, or failed
    END IF;
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      NULL; -- allowed: set/overwritten on every transition INTO approved
    END IF;
    IF NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at THEN
      NULL; -- allowed: set at proposed → pending_approval
    END IF;
    IF NEW.last_transition_by IS DISTINCT FROM OLD.last_transition_by THEN
      NULL; -- allowed: set on every status transition
    END IF;
    IF NEW.last_transition_event_id IS DISTINCT FROM OLD.last_transition_event_id THEN
      NULL; -- allowed: set on webhook/job-driven transitions
    END IF;
    IF NEW.last_aggregated_state IS DISTINCT FROM OLD.last_aggregated_state THEN
      NULL; -- allowed: set by aggregator for invariant 27 idempotency
    END IF;
    IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
      NULL; -- always allowed
    END IF;

    -- Check immutable columns are not changed.
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      v_changed_cols := array_append(v_changed_cols, 'organisation_id');
    END IF;
    IF NEW.subaccount_id IS DISTINCT FROM OLD.subaccount_id THEN
      v_changed_cols := array_append(v_changed_cols, 'subaccount_id');
    END IF;
    IF NEW.spending_budget_id IS DISTINCT FROM OLD.spending_budget_id THEN
      v_changed_cols := array_append(v_changed_cols, 'spending_budget_id');
    END IF;
    IF NEW.spending_policy_id IS DISTINCT FROM OLD.spending_policy_id THEN
      -- Permitted on the proposed → X transition only. proposeCharge inserts a
      -- placeholder and the gate writes the actually-evaluated policy id. The
      -- column is immutable after that first transition.
      IF OLD.status <> 'proposed' THEN
        v_changed_cols := array_append(v_changed_cols, 'spending_policy_id');
      END IF;
    END IF;
    IF NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
      -- Same carve-out: snapshot of policy.version at gate-evaluation time.
      -- INSERT seeds 0; the gate UPDATE records the evaluated version. Immutable
      -- thereafter.
      IF OLD.status <> 'proposed' THEN
        v_changed_cols := array_append(v_changed_cols, 'policy_version');
      END IF;
    END IF;
    IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
      v_changed_cols := array_append(v_changed_cols, 'agent_id');
    END IF;
    IF NEW.skill_run_id IS DISTINCT FROM OLD.skill_run_id THEN
      v_changed_cols := array_append(v_changed_cols, 'skill_run_id');
    END IF;
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      v_changed_cols := array_append(v_changed_cols, 'idempotency_key');
    END IF;
    IF NEW.intent_id IS DISTINCT FROM OLD.intent_id THEN
      v_changed_cols := array_append(v_changed_cols, 'intent_id');
    END IF;
    IF NEW.intent IS DISTINCT FROM OLD.intent THEN
      v_changed_cols := array_append(v_changed_cols, 'intent');
    END IF;
    IF NEW.charge_type IS DISTINCT FROM OLD.charge_type THEN
      v_changed_cols := array_append(v_changed_cols, 'charge_type');
    END IF;
    IF NEW.direction IS DISTINCT FROM OLD.direction THEN
      v_changed_cols := array_append(v_changed_cols, 'direction');
    END IF;
    IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN
      v_changed_cols := array_append(v_changed_cols, 'amount_minor');
    END IF;
    IF NEW.currency IS DISTINCT FROM OLD.currency THEN
      v_changed_cols := array_append(v_changed_cols, 'currency');
    END IF;
    IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
      v_changed_cols := array_append(v_changed_cols, 'merchant_id');
    END IF;
    IF NEW.merchant_descriptor IS DISTINCT FROM OLD.merchant_descriptor THEN
      v_changed_cols := array_append(v_changed_cols, 'merchant_descriptor');
    END IF;
    IF NEW.mode IS DISTINCT FROM OLD.mode THEN
      -- Permitted on proposed → X: INSERT seeds 'live' as a placeholder, the
      -- gate writes the actually-evaluated mode (shadow vs live). Immutable
      -- after that first transition (mode does not change post-gate).
      IF OLD.status <> 'proposed' THEN
        v_changed_cols := array_append(v_changed_cols, 'mode');
      END IF;
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      v_changed_cols := array_append(v_changed_cols, 'kind');
    END IF;
    IF NEW.parent_charge_id IS DISTINCT FROM OLD.parent_charge_id THEN
      v_changed_cols := array_append(v_changed_cols, 'parent_charge_id');
    END IF;
    IF NEW.replay_of_charge_id IS DISTINCT FROM OLD.replay_of_charge_id THEN
      v_changed_cols := array_append(v_changed_cols, 'replay_of_charge_id');
    END IF;
    IF NEW.provenance IS DISTINCT FROM OLD.provenance THEN
      v_changed_cols := array_append(v_changed_cols, 'provenance');
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      v_changed_cols := array_append(v_changed_cols, 'created_at');
    END IF;

    IF array_length(v_changed_cols, 1) > 0 THEN
      RAISE EXCEPTION
        'agent_charges immutable column changed: %',
        array_to_string(v_changed_cols, ', ');
    END IF;

  ELSE
    -- ── No status change: only provider_charge_id (+ updated_at) may be written ──
    -- This covers the WorkerSpendCompletion handler populating provider_charge_id
    -- on a row already in executed state (invariant 20 / spec §5.1 allowlist).
    -- Gated on caller identity.
    IF OLD.status <> 'executed' THEN
      RAISE EXCEPTION
        'agent_charges non-status update rejected: row is in % (must be executed)',
        OLD.status;
    END IF;

    IF v_caller NOT IN ('worker_completion', 'stripe_webhook') THEN
      RAISE EXCEPTION
        'agent_charges non-status update on executed row requires app.spend_caller IN (''worker_completion'', ''stripe_webhook''), got ''%''',
        COALESCE(v_caller, '(unset)');
    END IF;

    -- Only provider_charge_id and updated_at may change.
    v_changed_cols := ARRAY[]::TEXT[];

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_changed_cols := array_append(v_changed_cols, 'status');
    END IF;
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      v_changed_cols := array_append(v_changed_cols, 'organisation_id');
    END IF;
    IF NEW.subaccount_id IS DISTINCT FROM OLD.subaccount_id THEN
      v_changed_cols := array_append(v_changed_cols, 'subaccount_id');
    END IF;
    IF NEW.spending_budget_id IS DISTINCT FROM OLD.spending_budget_id THEN
      v_changed_cols := array_append(v_changed_cols, 'spending_budget_id');
    END IF;
    IF NEW.spending_policy_id IS DISTINCT FROM OLD.spending_policy_id THEN
      v_changed_cols := array_append(v_changed_cols, 'spending_policy_id');
    END IF;
    IF NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
      v_changed_cols := array_append(v_changed_cols, 'policy_version');
    END IF;
    IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
      v_changed_cols := array_append(v_changed_cols, 'agent_id');
    END IF;
    IF NEW.skill_run_id IS DISTINCT FROM OLD.skill_run_id THEN
      v_changed_cols := array_append(v_changed_cols, 'skill_run_id');
    END IF;
    IF NEW.action_id IS DISTINCT FROM OLD.action_id THEN
      v_changed_cols := array_append(v_changed_cols, 'action_id');
    END IF;
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      v_changed_cols := array_append(v_changed_cols, 'idempotency_key');
    END IF;
    IF NEW.intent_id IS DISTINCT FROM OLD.intent_id THEN
      v_changed_cols := array_append(v_changed_cols, 'intent_id');
    END IF;
    IF NEW.intent IS DISTINCT FROM OLD.intent THEN
      v_changed_cols := array_append(v_changed_cols, 'intent');
    END IF;
    IF NEW.charge_type IS DISTINCT FROM OLD.charge_type THEN
      v_changed_cols := array_append(v_changed_cols, 'charge_type');
    END IF;
    IF NEW.direction IS DISTINCT FROM OLD.direction THEN
      v_changed_cols := array_append(v_changed_cols, 'direction');
    END IF;
    IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN
      v_changed_cols := array_append(v_changed_cols, 'amount_minor');
    END IF;
    IF NEW.currency IS DISTINCT FROM OLD.currency THEN
      v_changed_cols := array_append(v_changed_cols, 'currency');
    END IF;
    IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
      v_changed_cols := array_append(v_changed_cols, 'merchant_id');
    END IF;
    IF NEW.merchant_descriptor IS DISTINCT FROM OLD.merchant_descriptor THEN
      v_changed_cols := array_append(v_changed_cols, 'merchant_descriptor');
    END IF;
    IF NEW.mode IS DISTINCT FROM OLD.mode THEN
      v_changed_cols := array_append(v_changed_cols, 'mode');
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      v_changed_cols := array_append(v_changed_cols, 'kind');
    END IF;
    IF NEW.spt_connection_id IS DISTINCT FROM OLD.spt_connection_id THEN
      v_changed_cols := array_append(v_changed_cols, 'spt_connection_id');
    END IF;
    IF NEW.decision_path IS DISTINCT FROM OLD.decision_path THEN
      v_changed_cols := array_append(v_changed_cols, 'decision_path');
    END IF;
    IF NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN
      v_changed_cols := array_append(v_changed_cols, 'failure_reason');
    END IF;
    IF NEW.parent_charge_id IS DISTINCT FROM OLD.parent_charge_id THEN
      v_changed_cols := array_append(v_changed_cols, 'parent_charge_id');
    END IF;
    IF NEW.replay_of_charge_id IS DISTINCT FROM OLD.replay_of_charge_id THEN
      v_changed_cols := array_append(v_changed_cols, 'replay_of_charge_id');
    END IF;
    IF NEW.provenance IS DISTINCT FROM OLD.provenance THEN
      v_changed_cols := array_append(v_changed_cols, 'provenance');
    END IF;
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      v_changed_cols := array_append(v_changed_cols, 'expires_at');
    END IF;
    IF NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at THEN
      v_changed_cols := array_append(v_changed_cols, 'approval_expires_at');
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      v_changed_cols := array_append(v_changed_cols, 'approved_at');
    END IF;
    IF NEW.executed_at IS DISTINCT FROM OLD.executed_at THEN
      v_changed_cols := array_append(v_changed_cols, 'executed_at');
    END IF;
    IF NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
      v_changed_cols := array_append(v_changed_cols, 'settled_at');
    END IF;
    IF NEW.last_transition_by IS DISTINCT FROM OLD.last_transition_by THEN
      v_changed_cols := array_append(v_changed_cols, 'last_transition_by');
    END IF;
    IF NEW.last_transition_event_id IS DISTINCT FROM OLD.last_transition_event_id THEN
      v_changed_cols := array_append(v_changed_cols, 'last_transition_event_id');
    END IF;
    IF NEW.last_aggregated_state IS DISTINCT FROM OLD.last_aggregated_state THEN
      v_changed_cols := array_append(v_changed_cols, 'last_aggregated_state');
    END IF;
    IF NEW.metadata_json IS DISTINCT FROM OLD.metadata_json THEN
      v_changed_cols := array_append(v_changed_cols, 'metadata_json');
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      v_changed_cols := array_append(v_changed_cols, 'created_at');
    END IF;

    IF array_length(v_changed_cols, 1) > 0 THEN
      RAISE EXCEPTION
        'agent_charges non-status update on executed row: only provider_charge_id and updated_at may change; disallowed columns: %',
        array_to_string(v_changed_cols, ', ');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER agent_charges_validate_update
  BEFORE UPDATE ON agent_charges
  FOR EACH ROW
  EXECUTE FUNCTION agent_charges_validate_update();

-- ── 4b. agent_charges: DELETE guard ──────────────────────────────────────────
-- DELETE only when app.spend_caller = 'retention_purge' AND
-- the row status = 'shadow_settled' (spec §2.3, §14).

CREATE OR REPLACE FUNCTION agent_charges_validate_delete()
RETURNS trigger AS $$
DECLARE
  v_caller TEXT;
BEGIN
  v_caller := current_setting('app.spend_caller', true);

  IF v_caller = 'retention_purge' AND OLD.status = 'shadow_settled' THEN
    RETURN OLD; -- Permit the DELETE.
  END IF;

  RAISE EXCEPTION
    'agent_charges DELETE rejected: only retention_purge may delete shadow_settled rows (status=%, caller=%)',
    OLD.status,
    COALESCE(v_caller, '(unset)');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER agent_charges_validate_delete
  BEFORE DELETE ON agent_charges
  FOR EACH ROW
  EXECUTE FUNCTION agent_charges_validate_delete();

ALTER TABLE agent_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_charges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_charges_org_isolation ON agent_charges;
CREATE POLICY agent_charges_org_isolation ON agent_charges
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 5. subaccount_approval_channels ──────────────────────────────────────────

CREATE TABLE subaccount_approval_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id   UUID NOT NULL REFERENCES subaccounts(id),
  -- 'in_app' in v1; slack/email/telegram deferred per spec §20.
  channel_type    TEXT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subaccount_approval_channels_org_idx
  ON subaccount_approval_channels(organisation_id);

CREATE INDEX subaccount_approval_channels_subaccount_idx
  ON subaccount_approval_channels(subaccount_id, organisation_id);

ALTER TABLE subaccount_approval_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_approval_channels FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subaccount_approval_channels_org_isolation ON subaccount_approval_channels;
CREATE POLICY subaccount_approval_channels_org_isolation ON subaccount_approval_channels
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 6. org_approval_channels ─────────────────────────────────────────────────

CREATE TABLE org_approval_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  channel_type    TEXT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX org_approval_channels_org_idx
  ON org_approval_channels(organisation_id);

ALTER TABLE org_approval_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_approval_channels FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_approval_channels_org_isolation ON org_approval_channels;
CREATE POLICY org_approval_channels_org_isolation ON org_approval_channels
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 7. org_subaccount_channel_grants ─────────────────────────────────────────

CREATE TABLE org_subaccount_channel_grants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id),
  subaccount_id       UUID NOT NULL REFERENCES subaccounts(id),
  org_channel_id      UUID NOT NULL REFERENCES org_approval_channels(id),
  granted_by_user_id  UUID NOT NULL,
  -- Deactivate on revoke; never delete (audit trail invariant).
  active              BOOLEAN NOT NULL DEFAULT true,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX org_subaccount_channel_grants_org_idx
  ON org_subaccount_channel_grants(organisation_id);

CREATE INDEX org_subaccount_channel_grants_subaccount_idx
  ON org_subaccount_channel_grants(subaccount_id, organisation_id);

CREATE INDEX org_subaccount_channel_grants_channel_idx
  ON org_subaccount_channel_grants(org_channel_id);

ALTER TABLE org_subaccount_channel_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_subaccount_channel_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_subaccount_channel_grants_org_isolation ON org_subaccount_channel_grants;
CREATE POLICY org_subaccount_channel_grants_org_isolation ON org_subaccount_channel_grants
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 8. spending_budget_approvers ─────────────────────────────────────────────

CREATE TABLE spending_budget_approvers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id),
  spending_budget_id UUID NOT NULL REFERENCES spending_budgets(id),
  user_id           UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT spending_budget_approvers_budget_user_uniq
    UNIQUE (spending_budget_id, user_id)
);

CREATE INDEX spending_budget_approvers_org_idx
  ON spending_budget_approvers(organisation_id);

CREATE INDEX spending_budget_approvers_budget_idx
  ON spending_budget_approvers(spending_budget_id);

ALTER TABLE spending_budget_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE spending_budget_approvers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spending_budget_approvers_org_isolation ON spending_budget_approvers;
CREATE POLICY spending_budget_approvers_org_isolation ON spending_budget_approvers
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ── 9. organisations.shadow_charge_retention_days ────────────────────────────
-- Per-org retention window for shadow-mode agent_charges rows.
-- Consumed by the shadow charge retention purge job (spec §14, §17 Chunk 16).

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS shadow_charge_retention_days INTEGER NOT NULL DEFAULT 90;
