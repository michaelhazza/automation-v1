-- 0289_reference_document_chunks.sql
--
-- Auto Knowledge Retrieval Phase 1 — per-document embedding chunk table.
-- Stores chunked + embedded content from reference document versions for
-- vector similarity retrieval. One row per (version_id, chunk_index,
-- embedding_model) triplet; the unique index is the idempotency key for
-- the chunking job (spec §10.1 / §10.6 / §13.3).
--
-- organisation_id is denormalised onto the row for RLS-policy locality
-- (spec §12) — the policy uses the direct column, not a parent-EXISTS walk.
--
-- Cosine distance is the ONLY similarity metric across this build (spec
-- invariant §1.5 #14). The HNSW index uses vector_cosine_ops; mixing
-- dot-product or Euclidean across embedding generations is forbidden.

CREATE TABLE reference_document_chunks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id       uuid        NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  version_id        uuid        NOT NULL REFERENCES reference_document_versions(id) ON DELETE CASCADE,
  chunk_index       integer     NOT NULL,
  embedding_model   text        NOT NULL,
  embedding         vector(1536),
  content           text        NOT NULL,
  token_count       integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- Idempotency key: exactly one chunk per (version, position, model) tuple.
-- Partial: excludes soft-deleted rows so a re-embed after soft-delete succeeds.
CREATE UNIQUE INDEX rdc_version_chunk_model_uq
  ON reference_document_chunks (version_id, chunk_index, embedding_model)
  WHERE deleted_at IS NULL;

-- Retrieval read path: fetch all chunks for a document's active version.
CREATE INDEX rdc_doc_version_idx
  ON reference_document_chunks (document_id, version_id);

-- RLS scan path: filter to live chunks for an org.
CREATE INDEX rdc_org_active_idx
  ON reference_document_chunks (organisation_id)
  WHERE deleted_at IS NULL;

-- Vector similarity search (cosine distance — the only permitted metric).
CREATE INDEX rdc_embedding_hnsw
  ON reference_document_chunks
  USING hnsw (embedding vector_cosine_ops);

-- RLS: tenant isolation keyed on organisation_id (direct column — no parent walk).
ALTER TABLE reference_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_document_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_document_chunks_org_isolation ON reference_document_chunks;
CREATE POLICY reference_document_chunks_org_isolation ON reference_document_chunks
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
