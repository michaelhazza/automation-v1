-- 0288_reference_document_modes_and_summary.sql
-- Phase 1A — Auto Knowledge Retrieval (spec §13.1, §13.3)
--
-- Adds retrieval-mode, summary, and three-pointer columns to reference_documents:
--   mode                 — document retrieval mode ('auto' | 'always_available' | 'reference_only')
--   summary              — LLM-generated one-paragraph summary (nullable; populated by summarisation job)
--   summary_stale        — true when content changed since last summary generation
--   summary_generated_at — timestamp of last successful summary generation
--   last_chunked_at      — timestamp of last completed chunk-and-embed sweep
--   active_embedding_model — embedding model name used for current chunks (retrieval pointer)
--   retrieval_version_id — FK to reference_document_versions; flips after chunking commits
--
-- RLS: column-level additions only; no policy change.

ALTER TABLE reference_documents
  ADD COLUMN mode text NOT NULL DEFAULT 'auto'
    CHECK (mode IN ('auto', 'always_available', 'reference_only'));

ALTER TABLE reference_documents
  ADD COLUMN summary text;

ALTER TABLE reference_documents
  ADD COLUMN summary_stale boolean NOT NULL DEFAULT false;

ALTER TABLE reference_documents
  ADD COLUMN summary_generated_at timestamptz;

ALTER TABLE reference_documents
  ADD COLUMN last_chunked_at timestamptz;

ALTER TABLE reference_documents
  ADD COLUMN active_embedding_model text;

ALTER TABLE reference_documents
  ADD COLUMN retrieval_version_id uuid
    REFERENCES reference_document_versions(id) ON DELETE SET NULL;
