-- Migration 0188 — llm_requests_archive table for retention
--
-- Spec §12: llm_requests grows unbounded by design. Rows older than
-- env.LLM_LEDGER_RETENTION_MONTHS (default 12) are moved to this archive
-- table by the nightly llm-ledger-archive job. Archive shape mirrors the
-- live table at migration time with lighter indexing — only the three
-- lookups that support / compliance flows need:
--   * idempotency_key (proof-of-billing queries)
--   * provider_request_id (Anthropic support tickets)
--   * (organisation_id, billing_month) (per-org audit window queries)
--
-- Partial indexes on the live table (status, execution_phase, feature_tag)
-- are NOT copied — dashboards never read the archive, so the write-amp
-- those indexes cost is pure waste here.
--
-- RLS: same tenant-isolation policy as llm_requests. Added to the
-- rlsProtectedTables.ts manifest in the same commit; verify-rls-coverage.sh
-- catches drift.
--
-- Referential integrity: deliberately dropped on user_id / run_id /
-- execution_id / iee_run_id / source_id. An archive row must survive the
-- deletion of the originating run/job — financial audit requirement.

BEGIN;

CREATE TABLE llm_requests_archive (
  id                             uuid PRIMARY KEY,

  idempotency_key                text NOT NULL UNIQUE,

  organisation_id                uuid NOT NULL,
  subaccount_id                  uuid,
  user_id                        uuid,
  source_type                    text NOT NULL,
  run_id                         uuid,
  execution_id                   uuid,
  iee_run_id                     uuid,
  source_id                      uuid,
  feature_tag                    text NOT NULL DEFAULT 'unknown',
  call_site                      text NOT NULL DEFAULT 'app',
  agent_name                     text,
  task_type                      text NOT NULL DEFAULT 'general',

  provider                       text NOT NULL DEFAULT 'anthropic',
  model                          text NOT NULL,
  provider_request_id            text,

  tokens_in                      integer NOT NULL DEFAULT 0,
  tokens_out                     integer NOT NULL DEFAULT 0,
  provider_tokens_in             integer,
  provider_tokens_out            integer,

  cost_raw                       numeric(12, 8) NOT NULL DEFAULT 0,
  cost_with_margin               numeric(12, 8) NOT NULL DEFAULT 0,
  cost_with_margin_cents         integer NOT NULL DEFAULT 0,
  margin_multiplier              numeric(6, 4) NOT NULL DEFAULT 1.30,
  fixed_fee_cents                integer NOT NULL DEFAULT 0,

  request_payload_hash           text,
  response_payload_hash          text,

  provider_latency_ms            integer,
  router_overhead_ms             integer,

  status                         text NOT NULL DEFAULT 'success',
  error_message                  text,
  attempt_number                 integer NOT NULL DEFAULT 1,
  parse_failure_raw_excerpt      text,
  abort_reason                   text,

  cached_prompt_tokens           integer NOT NULL DEFAULT 0,

  execution_phase                text,
  capability_tier                text NOT NULL DEFAULT 'frontier',
  was_downgraded                 boolean NOT NULL DEFAULT false,
  routing_reason                 text,

  was_escalated                  boolean NOT NULL DEFAULT false,
  escalation_reason              text,

  requested_provider             text,
  requested_model                text,
  fallback_chain                 text,

  billing_month                  text NOT NULL,
  billing_day                    text NOT NULL,

  created_at                     timestamptz NOT NULL,
  archived_at                    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX llm_requests_archive_provider_request_id_idx ON llm_requests_archive (provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE INDEX llm_requests_archive_org_month_idx ON llm_requests_archive (organisation_id, billing_month);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Mirror the llm_requests RLS shape (migration 0081). FORCE applies the
-- policy to the table owner too — otherwise the user that owns the
-- relation would bypass tenant isolation. WITH CHECK mirrors USING so
-- inserts (the archive job's writes) are also subject to the policy when
-- the caller is not running under a superuser / admin-bypass role.
ALTER TABLE llm_requests_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_requests_archive FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_requests_archive_org_isolation ON llm_requests_archive;
CREATE POLICY llm_requests_archive_org_isolation ON llm_requests_archive
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

COMMIT;
