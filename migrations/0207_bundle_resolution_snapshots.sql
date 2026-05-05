-- 0207_bundle_resolution_snapshots.sql
--
-- Cached Context Infrastructure Phase 1: bundle_resolution_snapshots table.
-- One row per unique (bundle_id, prefix_hash). Immutable — no deleted_at.
-- Dedup guard for concurrent cron bursts resolving the same bundle.
--
-- See docs/cached-context-infrastructure-spec.md §5.6

CREATE TABLE bundle_resolution_snapshots (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES organisations(id),
  subaccount_id             uuid REFERENCES subaccounts(id),

  bundle_id                 uuid NOT NULL REFERENCES document_bundles(id),
  bundle_version            integer NOT NULL,

  model_family              text NOT NULL,
  assembly_version          integer NOT NULL,

  -- JSONB array of { documentId, documentVersion, serializedBytesHash, tokenCount }.
  ordered_document_versions jsonb NOT NULL,

  prefix_hash               text NOT NULL,
  prefix_hash_components    jsonb NOT NULL,

  estimated_prefix_tokens   integer NOT NULL,

  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Primary dedup guard: one snapshot row per (bundle, hash).
CREATE UNIQUE INDEX bundle_resolution_snapshots_bundle_prefix_hash_uq
  ON bundle_resolution_snapshots (bundle_id, prefix_hash);

-- Cross-bundle hash lookup for attribution queries.
CREATE INDEX bundle_resolution_snapshots_prefix_hash_idx
  ON bundle_resolution_snapshots (prefix_hash);

CREATE INDEX bundle_resolution_snapshots_bundle_version_idx
  ON bundle_resolution_snapshots (bundle_id, bundle_version);

CREATE INDEX bundle_resolution_snapshots_org_idx
  ON bundle_resolution_snapshots (organisation_id);

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE bundle_resolution_snapshots ENABLE ROW LEVEL SECURITY;

-- @rls-baseline: phantom-var policy replaced at runtime by migration 0213_fix_cached_context_rls.sql
CREATE POLICY bundle_resolution_snapshots_org_isolation ON bundle_resolution_snapshots
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);

CREATE POLICY bundle_resolution_snapshots_subaccount_isolation ON bundle_resolution_snapshots
  USING (
    subaccount_id IS NULL
    OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid
  );
