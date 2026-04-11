-- Migration 0098: skill analyzer v2 columns + agent_embeddings table
-- See docs/skill-analyzer-v2-spec.md §5.1, §5.2, §5.3 for the full contract.
--
-- Changes:
-- 1. agent_embeddings: new content-addressed cache for system-agent embeddings.
--    Mirrors skill_embeddings but keyed by system_agent_id (one current
--    embedding per agent). The content_hash column is the cache invalidator.
--
-- 2. skill_analyzer_results: 5 new columns for the agent-proposal pipeline
--    and the LLM merge proposal.
--    - agent_proposals jsonb NOT NULL DEFAULT '[]'
--    - proposed_merged_content jsonb (nullable)
--    - original_proposed_merge jsonb (nullable, immutable after Write stage)
--    - user_edited_merge boolean NOT NULL DEFAULT false
--    - candidate_content_hash text NOT NULL (added with temporary default of
--      empty string so the ALTER works against any existing rows; the default
--      is dropped immediately. Existing rows in pre-production are dev fixtures
--      and will be re-created by re-running the analyzer.)
--
-- 3. skill_analyzer_results: drop matched_system_skill_slug and matched_skill_name.
--    Replaced by the matchedSkillContent live lookup in the GET /jobs/:id
--    response. matched_skill_id stays but now points at system_skills.id.
--
-- The agent_embeddings table is created in this migration even though the
-- first writer is in Phase 2 — landing the schema with Phase 1 keeps the
-- migration count tidy and matches spec §10 Phase 1.

-- ---------------------------------------------------------------------------
-- 1. agent_embeddings table
-- ---------------------------------------------------------------------------

CREATE TABLE agent_embeddings (
  system_agent_id uuid PRIMARY KEY REFERENCES system_agents(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding vector(1536) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. skill_analyzer_results — new columns
-- ---------------------------------------------------------------------------

ALTER TABLE skill_analyzer_results
  ADD COLUMN agent_proposals jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE skill_analyzer_results
  ADD COLUMN proposed_merged_content jsonb;

ALTER TABLE skill_analyzer_results
  ADD COLUMN original_proposed_merge jsonb;

ALTER TABLE skill_analyzer_results
  ADD COLUMN user_edited_merge boolean NOT NULL DEFAULT false;

ALTER TABLE skill_analyzer_results
  ADD COLUMN candidate_content_hash text NOT NULL DEFAULT '';

ALTER TABLE skill_analyzer_results
  ALTER COLUMN candidate_content_hash DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. skill_analyzer_results — drop legacy match-pointer columns
-- ---------------------------------------------------------------------------

ALTER TABLE skill_analyzer_results
  DROP COLUMN matched_system_skill_slug;

ALTER TABLE skill_analyzer_results
  DROP COLUMN matched_skill_name;
