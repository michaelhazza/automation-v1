-- Migration 0114: Skill Analyzer — agent intelligence enhancements
--
-- Adds three capabilities:
--
--   1. is_documentation_file / is_context_file flags on results
--      Detected heuristically during Stage 4 (Compare). Documentation files
--      (README-style, no tool definition, repo-name slug) are flagged so the
--      Review UI can warn before the user accidentally imports them. Context
--      files (foundation skill docs like product-marketing-context that have
--      no tool definition but rich instructions) are flagged with a different
--      badge so reviewers know to assign them to Knowledge Management Agent.
--
--   2. agent_recommendation jsonb on skill_analyzer_jobs
--      Populated by Stage 8b (Cluster Recommendation) after all results are
--      written. When multiple DISTINCT skills have no good agent match
--      (best_score < 0.55) and cluster together semantically, Sonnet is asked
--      whether a new agent should be created. The JSON shape is:
--      {
--        shouldCreateAgent: boolean,
--        agentName?: string,
--        agentSlug?: string,
--        agentDescription?: string,
--        reasoning: string,
--        skillSlugs?: string[]
--      }
--
-- The agent_proposals JSONB column already exists on skill_analyzer_results.
-- The LLM reasoning enhancement (Stage 7b) enriches the existing JSONB by
-- adding `llmReasoning` and `llmConfirmed` fields to each proposal object —
-- no schema change needed for that.

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS is_documentation_file boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_context_file       boolean NOT NULL DEFAULT false;

ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS agent_recommendation jsonb;
