-- Migration 0348: Create browser_warm_sessions table
--
-- Per-subaccount warm-pool session rows. Rows transition available → leased →
-- terminated and are NEVER deleted (audit / cost-attribution trail).
-- FK warm_session_id on llm_requests lands in migration 0349.
--
-- Spec: tasks/builds/iee-browser-on-e2b/spec.md §10.3
-- RLS: dual-GUC policy on BOTH app.organisation_id AND app.subaccount_id

CREATE TABLE browser_warm_sessions (
  id                       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id          UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id            UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  sandbox_id               TEXT        NOT NULL,
  template_name            TEXT        NOT NULL,
  template_version         TEXT        NOT NULL,
  status                   TEXT        NOT NULL DEFAULT 'available',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_at                TIMESTAMPTZ,
  terminated_at            TIMESTAMPTZ,
  idle_cost_cents_attributed INTEGER,

  CONSTRAINT bws_status_check CHECK (status IN ('available', 'leased', 'terminated'))
);

-- Composite index for checkout query
CREATE INDEX browser_warm_sessions_subaccount_status_idx
  ON browser_warm_sessions(subaccount_id, status);

-- Partial index for eviction sweep (age of available sessions)
CREATE INDEX browser_warm_sessions_available_age_idx
  ON browser_warm_sessions(created_at)
  WHERE status = 'available';

-- R2-F5: DB-level enforcement of "size 1 per enabled subaccount" invariant.
-- Two concurrent refill triggers race to INSERT; the loser gets 23505
-- and treats it as "another worker already refilled" — no error surface.
CREATE UNIQUE INDEX browser_warm_sessions_subaccount_available_unique_idx
  ON browser_warm_sessions(subaccount_id)
  WHERE status = 'available';

-- RLS: dual-GUC scoping on both organisation_id AND subaccount_id
ALTER TABLE browser_warm_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_warm_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY browser_warm_sessions_org_subaccount_isolation ON browser_warm_sessions
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
