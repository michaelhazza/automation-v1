-- Add methodology column to skills table
-- Stores structured workflow documents (phases, decision trees, quality criteria)
-- that enrich agent system prompts beyond simple tool instructions.
ALTER TABLE "skills" ADD COLUMN "methodology" text;
