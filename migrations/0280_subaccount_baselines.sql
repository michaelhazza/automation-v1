-- F3 Baseline Capture (spec §3) — primary baseline row per subaccount.
-- See docs/baseline-capture-spec.md.
CREATE TABLE subaccount_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  baseline_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'capturing', 'captured', 'failed', 'manual', 'reset')),
  capture_attempt_count SMALLINT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  -- §5.4 — stamped explicitly on retry transitions (last_attempt_at + backoff
  -- window). The cron's eligibility filter could derive this from
  -- last_attempt_at + capture_attempt_count, but persisting it gives operators
  -- direct visibility into "when does this retry next?" without re-deriving
  -- the schedule. Set to NULL when status is not 'ready' with attempts > 0.
  next_attempt_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'mixed')),
  confidence TEXT NOT NULL DEFAULT 'partial' CHECK (confidence IN ('confirmed', 'estimated', 'partial')),
  failure_reason TEXT,
  admin_reset_reason TEXT,
  reset_at TIMESTAMPTZ,
  reset_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §10 invariant: AT MOST ONE active (non-reset) baseline per sub-account.
-- The partial index on subaccount_id (NOT (subaccount_id, baseline_version))
-- enforces "exactly one active baseline" regardless of version. Admin reset
-- is a single transaction: UPDATE prior SET status='reset' THEN INSERT new
-- with baseline_version+1 (see captureBaselineService.adminReset).
CREATE UNIQUE INDEX subaccount_baselines_active_uniq
  ON subaccount_baselines(subaccount_id)
  WHERE status <> 'reset';

CREATE INDEX subaccount_baselines_status_idx
  ON subaccount_baselines(organisation_id, status);

-- Retry pickup: covers cron's `WHERE status='ready' AND capture_attempt_count > 0`.
-- 'failed' is terminal (recovery via manual entry only) and excluded.
CREATE INDEX subaccount_baselines_pending_retry_idx
  ON subaccount_baselines(last_attempt_at)
  WHERE status = 'ready' AND capture_attempt_count > 0;

-- F3 §4 — readiness condition support: counter + earliest qualifying poll.
-- Polling service maintains both via UPDATE on every successful sync. See
-- baselineReadinessService.evaluate().
ALTER TABLE connector_configs
  ADD COLUMN IF NOT EXISTS successful_poll_count_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_qualifying_poll_at TIMESTAMPTZ;
