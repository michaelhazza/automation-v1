-- LLM Cost Optimisation: Adaptive Intelligence Routing
-- Adds execution phase routing, capability tiers, prompt caching, and escalation tracking.

-- New columns on llm_requests (append-only financial ledger)
ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS cached_prompt_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS execution_phase text NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS capability_tier text NOT NULL DEFAULT 'frontier',
  ADD COLUMN IF NOT EXISTS was_downgraded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routing_reason text,
  ADD COLUMN IF NOT EXISTS was_escalated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalation_reason text;

-- Index for phase-based analytics queries
CREATE INDEX IF NOT EXISTS llm_requests_execution_phase_idx
  ON llm_requests (execution_phase, billing_month);
