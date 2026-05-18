-- 0379_deterministic_validators_phase_1.sql
-- deterministic-validators spec §5, §11 Step 1, §12 (rows 1-5), §15.1, §15.5.
--
-- Adds verdict-provenance columns to scorecard_judgements, an inconclusive-alert
-- threshold to scorecards, and two system-tier audit tables for the deterministic
-- validator framework.

-- ---------------------------------------------------------------------------
-- 1. scorecard_judgements — verdict-provenance columns
-- ---------------------------------------------------------------------------

ALTER TABLE scorecard_judgements
  ADD COLUMN IF NOT EXISTS evaluation_method TEXT NOT NULL DEFAULT 'semantic'
    CHECK (evaluation_method IN (
      'deterministic',
      'deterministic_external',
      'hybrid_deterministic_fail',
      'hybrid_semantic',
      'semantic',
      'inconclusive'
    )),
  ADD COLUMN IF NOT EXISTS validator_slug TEXT,
  ADD COLUMN IF NOT EXISTS validator_version TEXT;

-- ---------------------------------------------------------------------------
-- 2. scorecards — inconclusive-alert threshold
-- ---------------------------------------------------------------------------

ALTER TABLE scorecards
  ADD COLUMN IF NOT EXISTS inconclusive_alert_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.20;

-- ---------------------------------------------------------------------------
-- 3. validator_versions — append-only snapshot of registered validator source
-- system-scoped: no organisation_id; validators are process-global artefacts,
-- not tenant data. No RLS policy required; table is readable only by server
-- processes with a direct DB connection (no GUC-gated session variable path).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS validator_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text NOT NULL,
  version                text NOT NULL,
  source_text            text NOT NULL,
  source_hash            text NOT NULL,
  parameter_schema_json  jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

-- ---------------------------------------------------------------------------
-- 4. validator_invocations — append-only audit ledger for every validator call
-- system-scoped: no organisation_id; the only tenant pointer is verdict_id FK
-- to scorecard_judgements (which IS tenant-isolated). Evidence stored here is
-- redacted per spec §6.6 — no raw tenant output excerpts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS validator_invocations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_id           uuid NOT NULL REFERENCES scorecard_judgements(id) ON DELETE CASCADE,
  validator_slug       text NOT NULL,
  validator_version    text NOT NULL,
  evaluation_method    text NOT NULL
    CHECK (evaluation_method IN (
      'deterministic',
      'deterministic_external',
      'hybrid_deterministic_fail',
      'hybrid_semantic',
      'semantic',
      'inconclusive',
      'hybrid_precondition_pass'
    )),
  latency_ms           integer NOT NULL,
  external_call_count  integer NOT NULL DEFAULT 0,
  result_passed        boolean NOT NULL,
  result_score         numeric(4,3),
  evidence_json        jsonb,
  trace_id             text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS validator_invocations_slug_created_idx
  ON validator_invocations (validator_slug, created_at);

CREATE INDEX IF NOT EXISTS validator_invocations_verdict_idx
  ON validator_invocations (verdict_id);
