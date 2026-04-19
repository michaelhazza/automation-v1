-- 0176_clientpulse_integration_fingerprints.sql
-- ClientPulse Phase 1 follow-up: integration-fingerprint scanner state (§2.0c).
--
-- Three generic, CRM-agnostic tables power the scanner:
--   integration_fingerprints          — library of patterns (system + org scope)
--   integration_detections            — per-sub-account matches against the library
--   integration_unclassified_signals  — novel observations that need operator triage
--
-- All three: RLS enabled, `canonical_writer` bypass for ingestion writes, tenant-isolation
-- read policy keyed on current_setting('app.organisation_id').
--
-- Seed data: CloseBot + Uphex patterns at `scope='system'` so every org benefits from
-- the baseline library on first scan. Additional vendors land via operator triage of
-- integration_unclassified_signals → promote to system scope via config-change flow.

BEGIN;

-- ===========================================================================
-- integration_fingerprints — library (system + org scope)
-- ===========================================================================

CREATE TABLE integration_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('system', 'org')),
  organisation_id uuid REFERENCES organisations(id),
  integration_slug text NOT NULL,
  display_name text NOT NULL,
  vendor_url text,
  fingerprint_type text NOT NULL CHECK (
    fingerprint_type IN (
      'conversation_provider_id',
      'workflow_action_type',
      'outbound_webhook_domain',
      'custom_field_prefix',
      'tag_prefix',
      'contact_source'
    )
  ),
  fingerprint_value text,
  fingerprint_pattern text,
  confidence numeric(3,2) NOT NULL DEFAULT 0.80,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT integration_fingerprints_scope_org_consistent CHECK (
    (scope = 'system' AND organisation_id IS NULL) OR
    (scope = 'org' AND organisation_id IS NOT NULL)
  ),
  CONSTRAINT integration_fingerprints_value_or_pattern CHECK (
    fingerprint_value IS NOT NULL OR fingerprint_pattern IS NOT NULL
  )
);

-- Separate unique indexes per scope (NULL organisation_id behaves correctly with partial indexes).
CREATE UNIQUE INDEX integration_fingerprints_system_unique
  ON integration_fingerprints (integration_slug, fingerprint_type, COALESCE(fingerprint_value, ''), COALESCE(fingerprint_pattern, ''))
  WHERE scope = 'system' AND deleted_at IS NULL;

CREATE UNIQUE INDEX integration_fingerprints_org_unique
  ON integration_fingerprints (organisation_id, integration_slug, fingerprint_type, COALESCE(fingerprint_value, ''), COALESCE(fingerprint_pattern, ''))
  WHERE scope = 'org' AND deleted_at IS NULL;

CREATE INDEX integration_fingerprints_slug_type_idx
  ON integration_fingerprints (integration_slug, fingerprint_type)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- Seed BEFORE enabling RLS. Postgres does not enforce row-level security until
-- ENABLE ROW LEVEL SECURITY runs; seeding first lets the migration role insert
-- without needing BYPASSRLS or a canonical_writer session context. Every
-- subsequent write from application code happens under RLS.
-- ===========================================================================

INSERT INTO integration_fingerprints (scope, integration_slug, display_name, vendor_url, fingerprint_type, fingerprint_value, fingerprint_pattern, confidence) VALUES
  ('system', 'closebot', 'CloseBot', 'https://closebot.ai', 'conversation_provider_id', NULL, '^closebot:', 0.95),
  ('system', 'closebot', 'CloseBot', 'https://closebot.ai', 'workflow_action_type',     NULL, '^closebot\.',  0.95),
  ('system', 'closebot', 'CloseBot', 'https://closebot.ai', 'outbound_webhook_domain',  'api.closebot.ai', NULL, 0.95),
  ('system', 'closebot', 'CloseBot', 'https://closebot.ai', 'custom_field_prefix',      NULL, '^closebot_',   0.85),
  ('system', 'closebot', 'CloseBot', 'https://closebot.ai', 'tag_prefix',               NULL, '^closebot:',   0.85),
  ('system', 'uphex',    'Uphex',    'https://uphex.com',    'conversation_provider_id', NULL, '^uphex:',      0.95),
  ('system', 'uphex',    'Uphex',    'https://uphex.com',    'workflow_action_type',     NULL, '^uphex\.',     0.95),
  ('system', 'uphex',    'Uphex',    'https://uphex.com',    'outbound_webhook_domain',  'api.uphex.com',   NULL, 0.95),
  ('system', 'uphex',    'Uphex',    'https://uphex.com',    'custom_field_prefix',      NULL, '^uphex_',      0.85),
  ('system', 'uphex',    'Uphex',    'https://uphex.com',    'tag_prefix',               NULL, '^uphex:',      0.85);

ALTER TABLE integration_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_fingerprints FORCE ROW LEVEL SECURITY;

-- System-scope rows are readable by every tenant; org-scope rows only by their owner.
CREATE POLICY integration_fingerprints_read ON integration_fingerprints
  FOR SELECT USING (
    scope = 'system'
    OR organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- Writers bypass tenant isolation but must supply an organisation_id for org-scope rows;
-- system-scope rows are seeded via this migration (and by sysadmin flows that run with
-- elevated context — not covered in this PR).
CREATE POLICY integration_fingerprints_writer_bypass ON integration_fingerprints
  FOR ALL TO canonical_writer
  USING (
    scope = 'system'
    OR organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    scope = 'system'
    OR organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- integration_detections — per-sub matches
-- ===========================================================================

CREATE TABLE integration_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  integration_slug text NOT NULL,
  matched_fingerprint_id uuid NOT NULL REFERENCES integration_fingerprints(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  usage_indicator_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Scanner owns every row and refreshes it on every scan. There is no
-- user-facing delete action in v1; if one emerges later, introduce it via a
-- separate migration rather than a half-wired deleted_at column.
CREATE UNIQUE INDEX integration_detections_unique
  ON integration_detections (organisation_id, subaccount_id, integration_slug);

CREATE INDEX integration_detections_org_slug_idx
  ON integration_detections (organisation_id, integration_slug);

ALTER TABLE integration_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_detections FORCE ROW LEVEL SECURITY;

CREATE POLICY integration_detections_writer_bypass ON integration_detections
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY integration_detections_read ON integration_detections
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- integration_unclassified_signals — novel observations queue
-- ===========================================================================

CREATE TABLE integration_unclassified_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  signal_type text NOT NULL CHECK (
    signal_type IN (
      'conversation_provider_id',
      'workflow_action_type',
      'outbound_webhook_domain',
      'custom_field_prefix',
      'tag_prefix',
      'contact_source'
    )
  ),
  signal_value text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  importance_score numeric(5,2) NOT NULL DEFAULT 0,
  resolved_to_integration_slug text,
  resolved_by uuid,
  resolved_at timestamptz,
  dismissed_as_irrelevant boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX integration_unclassified_signals_unique
  ON integration_unclassified_signals (organisation_id, subaccount_id, signal_type, signal_value);

CREATE INDEX integration_unclassified_signals_open_idx
  ON integration_unclassified_signals (organisation_id, signal_type, importance_score DESC)
  WHERE resolved_at IS NULL AND dismissed_as_irrelevant = false;

ALTER TABLE integration_unclassified_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_unclassified_signals FORCE ROW LEVEL SECURITY;

CREATE POLICY integration_unclassified_signals_writer_bypass ON integration_unclassified_signals
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY integration_unclassified_signals_read ON integration_unclassified_signals
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

COMMIT;
