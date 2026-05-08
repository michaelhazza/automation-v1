ALTER TABLE reference_documents DROP COLUMN IF EXISTS retrieval_version_id;
ALTER TABLE reference_documents DROP COLUMN IF EXISTS active_embedding_model;
ALTER TABLE reference_documents DROP COLUMN IF EXISTS last_chunked_at;
ALTER TABLE reference_documents DROP COLUMN IF EXISTS summary_generated_at;
ALTER TABLE reference_documents DROP COLUMN IF EXISTS summary_stale;
ALTER TABLE reference_documents DROP COLUMN IF EXISTS summary;
ALTER TABLE reference_documents DROP COLUMN IF EXISTS mode;
