-- Migration 0333: memory_block_version_sources table + RLS + indexes.
-- Tracks which workspace_memory_entries contributed to each memory_block_versions
-- row at auto-synthesis time. Spec §4 Phase 1 / §3.1 / §3.2 / §3.3.

CREATE TABLE memory_block_version_sources (
  id                          uuid                DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id             uuid       NOT NULL,
  block_version_id            uuid       NOT NULL REFERENCES memory_block_versions(id)  ON DELETE CASCADE,
  source_entry_id             uuid                REFERENCES workspace_memory_entries(id) ON DELETE SET NULL,
  source_entry_id_hash        text       NOT NULL,
  content_hash                text       NOT NULL,
  source_type                 text       NOT NULL,
  captured_at                 timestamptz NOT NULL DEFAULT now(),
  quality_score_at_capture    numeric,
  contribution_rank           integer    NOT NULL,
  source_run_id               uuid                REFERENCES agent_runs(id)              ON DELETE SET NULL,
  source_run_id_hash          text,
  source_run_label_at_capture text,

  CONSTRAINT memory_block_version_sources_bv_entry_uq
    UNIQUE (block_version_id, source_entry_id_hash)
);

-- Tenant isolation
ALTER TABLE memory_block_version_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_block_version_sources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_block_version_sources_org_isolation ON memory_block_version_sources;

CREATE POLICY memory_block_version_sources_org_isolation ON memory_block_version_sources
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

-- Indexes
CREATE INDEX idx_mbvs_block_version   ON memory_block_version_sources (block_version_id);
CREATE INDEX idx_mbvs_source_entry    ON memory_block_version_sources (source_entry_id);
-- Reverse-lineage index: enables COUNT(*) GROUP BY source_entry_id_hash efficiently (spec §15 Q6)
CREATE INDEX idx_mbvs_source_entry_hash ON memory_block_version_sources (source_entry_id_hash);
CREATE INDEX idx_mbvs_source_run      ON memory_block_version_sources (source_run_id);
