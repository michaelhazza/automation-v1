-- Migration 0322: Create sandbox_artefacts, sandbox_telemetry_events, sandbox_logs tables
-- Spec §20.4, §20.5, §20.8. Atomic landing — three related tables in one migration so
-- RLS policies and manifest entries land together (spec §19.4 rationale).

-- ─── sandbox_artefacts ────────────────────────────────────────────────────────
-- Pointer rows for harvested artefacts in object storage (spec §20.4).
-- Idempotent on (sandbox_execution_id, filename). Retention: 90 days (spec §17.3).

CREATE TABLE sandbox_artefacts (
  id                    UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sandbox_execution_id  UUID    NOT NULL REFERENCES sandbox_executions(id) ON DELETE CASCADE,
  organisation_id       UUID    NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id         UUID    NOT NULL,

  filename              TEXT    NOT NULL,
  object_key            TEXT    NOT NULL,
  bytes                 INTEGER NOT NULL,
  content_hash          TEXT    NOT NULL,
  -- Content-sniffed MIME type (spec §9.6)
  mime                  TEXT    NOT NULL,

  -- Retention lifecycle (spec §17.3): uploaded → expired → purged
  object_storage_state  TEXT    NOT NULL DEFAULT 'uploaded'
    CHECK (object_storage_state IN ('uploaded', 'expired', 'purged')),

  -- Soft-delete flag — set false when parent run is soft-deleted (spec §17.4)
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DB-level idempotency: one row per artefact file per execution (spec §20.4)
CREATE UNIQUE INDEX sandbox_artefacts_execution_filename_uniq
  ON sandbox_artefacts (sandbox_execution_id, filename);
CREATE INDEX sandbox_artefacts_org_uploaded_at_idx
  ON sandbox_artefacts (organisation_id, uploaded_at DESC);
CREATE INDEX sandbox_artefacts_execution_id_idx
  ON sandbox_artefacts (sandbox_execution_id);

ALTER TABLE sandbox_artefacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_artefacts FORCE ROW LEVEL SECURITY;
CREATE POLICY sandbox_artefacts_org_isolation ON sandbox_artefacts
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

-- ─── sandbox_telemetry_events ─────────────────────────────────────────────────
-- Structured lifecycle events per execution (spec §20.5, §14.1).
-- Closed event-type enum enforced by CHECK constraint. Retention: 90 days (spec §17.3).

CREATE TABLE sandbox_telemetry_events (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sandbox_execution_id  UUID        NOT NULL REFERENCES sandbox_executions(id) ON DELETE CASCADE,
  organisation_id       UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id         UUID        NOT NULL,
  run_id                UUID        NOT NULL,
  agent_id              UUID        NOT NULL,
  task_id               TEXT        NOT NULL,

  -- Provider + template context (denormalised for query convenience)
  provider              TEXT        NOT NULL,
  template_name         TEXT        NOT NULL,
  template_version      TEXT        NOT NULL,

  -- Closed event-type enum (spec §14.2 Surface A). Changes require a spec amendment.
  event_type            TEXT        NOT NULL CHECK (event_type IN (
    'sandbox_start',
    'sandbox_start_failed',
    'sandbox_terminal',
    'sandbox_timeout',
    'sandbox_cost_ceiling_hit',
    'sandbox_crashed',
    'output_validation_failed',
    'output_validated',
    'harvest_started',
    'harvest_failed',
    'artefact_uploaded',
    'artefact_upload_failed',
    'credential_injection_denied',
    'credential_leak_attempted',
    'egress_audited',
    'provider_diagnostic',
    'provider_unavailable',
    'runtime_install_requested',
    'runtime_install_denied',
    'runtime_install_completed'
  )),
  event_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Per-execution ordered sequence; allocated atomically at write time (spec §14.1)
  sequence              INTEGER     NOT NULL,
  criticality           TEXT        NOT NULL CHECK (criticality IN ('info', 'warn', 'error')),

  -- Event-specific structured payload; schema declared per event type in spec §14.2
  payload_json          JSONB
);

-- DB-level idempotency + ordering (spec §20.5)
CREATE UNIQUE INDEX sandbox_telemetry_events_execution_sequence_uniq
  ON sandbox_telemetry_events (sandbox_execution_id, sequence);
CREATE INDEX sandbox_telemetry_events_org_event_at_idx
  ON sandbox_telemetry_events (organisation_id, event_at DESC);
-- Partial index for warn/error events — ops paging filter
CREATE INDEX sandbox_telemetry_events_event_type_warn_error_idx
  ON sandbox_telemetry_events (event_type, event_at DESC)
  WHERE criticality IN ('warn', 'error');

ALTER TABLE sandbox_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_telemetry_events FORCE ROW LEVEL SECURITY;
CREATE POLICY sandbox_telemetry_events_org_isolation ON sandbox_telemetry_events
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

-- ─── sandbox_logs ─────────────────────────────────────────────────────────────
-- Redacted per-line log rows (spec §20.8).
-- Locked at chatgpt-spec-review Round 1 (previously SANDBOX-DEF-LOG-SCHEMA).
-- Idempotent on (sandbox_execution_id, log_stream, sequence). Retention: 90 days.

CREATE TABLE sandbox_logs (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sandbox_execution_id  UUID        NOT NULL REFERENCES sandbox_executions(id) ON DELETE CASCADE,
  organisation_id       UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id         UUID        NOT NULL,
  run_id                UUID        NOT NULL,

  log_stream            TEXT        NOT NULL CHECK (log_stream IN ('stdout', 'stderr')),
  -- Per-(execution, stream) ordered sequence; allocated at harvest write time
  sequence              INTEGER     NOT NULL,
  -- Redacted log line text (spec §8.4 step 5, §20.8)
  line                  TEXT        NOT NULL,

  -- Time the log line was emitted inside the sandbox
  emitted_at            TIMESTAMPTZ NOT NULL,
  -- Time the row landed
  persisted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Soft-delete flag — set false when parent run is soft-deleted (spec §17.4)
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE
);

-- DB-level idempotency — harvest re-runs are no-ops at the line level (spec §20.8)
CREATE UNIQUE INDEX sandbox_logs_execution_stream_sequence_uniq
  ON sandbox_logs (sandbox_execution_id, log_stream, sequence);
CREATE INDEX sandbox_logs_org_persisted_at_idx
  ON sandbox_logs (organisation_id, persisted_at DESC);
CREATE INDEX sandbox_logs_run_id_idx
  ON sandbox_logs (run_id);

ALTER TABLE sandbox_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY sandbox_logs_org_isolation ON sandbox_logs
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
