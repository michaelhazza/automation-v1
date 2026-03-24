-- Add methodology column to skills table
-- Stores structured workflow documents (phases, decision trees, quality criteria)
-- that enrich agent system prompts beyond simple tool instructions.
ALTER TABLE "skills" ADD COLUMN "methodology" text;

-- Add default skill slugs to agents table
-- These get copied to subaccountAgents.skillSlugs when an agent is linked to a subaccount.
ALTER TABLE "agents" ADD COLUMN "default_skill_slugs" jsonb;
