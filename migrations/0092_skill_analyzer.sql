-- Migration 0092: Skill Analyzer
-- Creates three new tables for the Skill Analyzer feature:
--   skill_analyzer_jobs      — import/analysis job tracking
--   skill_analyzer_results   — per-pair comparison results
--   skill_embeddings         — content-addressed embedding cache (pgvector)

-- ---------------------------------------------------------------------------
-- skill_analyzer_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE skill_analyzer_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  created_by            uuid NOT NULL REFERENCES users(id),

  -- Source metadata
  source_type           text NOT NULL CHECK (source_type IN ('paste', 'upload', 'github')),
  source_metadata       jsonb NOT NULL DEFAULT '{}',

  -- Processing state
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'parsing', 'hashing', 'embedding',
                       'comparing', 'classifying', 'completed', 'failed')),
  progress_pct          integer NOT NULL DEFAULT 0,
  progress_message      text,
  error_message         text,

  -- Counts (populated during processing)
  candidate_count       integer,
  exact_duplicate_count integer DEFAULT 0,
  comparison_count      integer DEFAULT 0,

  -- Raw parsed candidates (JSONB array for replay/debug)
  parsed_candidates     jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE INDEX skill_analyzer_jobs_org_idx
  ON skill_analyzer_jobs (organisation_id);

-- Partial index on active jobs only (not completed or failed)
CREATE INDEX skill_analyzer_jobs_active_idx
  ON skill_analyzer_jobs (status)
  WHERE status NOT IN ('completed', 'failed');

-- ---------------------------------------------------------------------------
-- skill_analyzer_results
-- ---------------------------------------------------------------------------

CREATE TABLE skill_analyzer_results (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    uuid NOT NULL REFERENCES skill_analyzer_jobs(id) ON DELETE CASCADE,

  -- Candidate skill identity
  candidate_index           integer NOT NULL,
  candidate_name            text NOT NULL,
  candidate_slug            text NOT NULL,

  -- Matched existing skill (null for DISTINCT)
  matched_skill_id          uuid,
  matched_system_skill_slug text,
  matched_skill_name        text,

  -- Classification output
  classification            text NOT NULL
    CHECK (classification IN ('DUPLICATE', 'IMPROVEMENT', 'PARTIAL_OVERLAP', 'DISTINCT')),
  confidence                real NOT NULL,
  similarity_score          real,
  classification_reasoning  text,

  -- Diff data for side-by-side UI
  diff_summary              jsonb,

  -- User action
  action_taken              text CHECK (action_taken IN ('approved', 'rejected', 'skipped')),
  action_taken_at           timestamptz,
  action_taken_by           uuid REFERENCES users(id),

  -- Execution outcome
  execution_result          text CHECK (execution_result IN ('created', 'updated', 'skipped', 'failed')),
  execution_error           text,
  resulting_skill_id        uuid,

  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX skill_analyzer_results_job_idx
  ON skill_analyzer_results (job_id);

CREATE INDEX skill_analyzer_results_classification_idx
  ON skill_analyzer_results (job_id, classification);

-- ---------------------------------------------------------------------------
-- skill_embeddings
-- ---------------------------------------------------------------------------

CREATE TABLE skill_embeddings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash      text NOT NULL,
  source_type       text NOT NULL CHECK (source_type IN ('system', 'org', 'candidate')),
  source_identifier text NOT NULL,
  embedding         vector(1536) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX skill_embeddings_hash_idx
  ON skill_embeddings (content_hash);

CREATE INDEX skill_embeddings_source_idx
  ON skill_embeddings (source_type, source_identifier);
