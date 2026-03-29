-- Agent Model Options
-- Adds response_mode, output_size, and allow_model_override to agents and agent_templates

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Agents table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "response_mode" text NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS "output_size" text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS "allow_model_override" integer NOT NULL DEFAULT 1;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Agent Templates table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "agent_templates"
  ADD COLUMN IF NOT EXISTS "response_mode" text NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS "output_size" text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS "allow_model_override" integer NOT NULL DEFAULT 1;
