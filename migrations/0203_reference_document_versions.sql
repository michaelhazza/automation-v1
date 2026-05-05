-- 0203_reference_document_versions.sql
--
-- Cached Context Infrastructure Phase 1: reference_document_versions table.
-- One immutable row per content revision. Version rows are never deleted —
-- they are the load-bearing property behind per-run reproducibility.
--
-- Also adds the soft FK from reference_documents.current_version_id to this
-- table (deferred from 0202 to avoid circular dependency — same pattern as
-- memory_blocks.activeVersionId / memoryBlockVersions.id).
--
-- See docs/cached-context-infrastructure-spec.md §5.2

CREATE TABLE reference_document_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,

  version               integer NOT NULL,

  content               text NOT NULL,
  content_hash          text NOT NULL,

  -- JSONB map keyed by model family. v1 writes three keys: Sonnet / Opus / Haiku.
  token_counts          jsonb NOT NULL,

  serialized_bytes_hash text NOT NULL,

  created_by_user_id    uuid REFERENCES users(id),
  change_source         text NOT NULL,
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Monotonic version per document.
CREATE UNIQUE INDEX reference_document_versions_doc_version_uq
  ON reference_document_versions (document_id, version);

CREATE INDEX reference_document_versions_doc_version_idx
  ON reference_document_versions (document_id, version);

CREATE INDEX reference_document_versions_content_hash_idx
  ON reference_document_versions (content_hash);

-- Add the soft FK from reference_documents.current_version_id to this table.
-- Done here (migration 0203) rather than 0202 because the target table didn't
-- exist at 0202 creation time.
ALTER TABLE reference_documents
  ADD CONSTRAINT reference_documents_current_version_id_fk
  FOREIGN KEY (current_version_id) REFERENCES reference_document_versions(id);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Inherits organisation isolation via the parent document row.

ALTER TABLE reference_document_versions ENABLE ROW LEVEL SECURITY;

-- @rls-baseline: pre-FORCE-RLS migration with a parent-EXISTS policy shape
-- (no organisation_id column on this table). 0227's canonical-policy hardening
-- pass excluded this table for that reason; the FORCE RLS hardening with a
-- parent-EXISTS WITH CHECK clause is routed to a separate follow-on migration.
-- Tracked in tasks/todo.md.
CREATE POLICY reference_document_versions_org_isolation ON reference_document_versions
  USING (
    EXISTS (
      SELECT 1 FROM reference_documents rd
      WHERE rd.id = document_id
        AND rd.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
