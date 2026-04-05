-- Routing Debug: Fallback chain tracking
-- Adds columns to capture what the resolver originally selected and which
-- providers were attempted during fallback, enabling routing decision analysis.

ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS requested_provider text,
  ADD COLUMN IF NOT EXISTS requested_model text,
  ADD COLUMN IF NOT EXISTS fallback_chain text;  -- JSON stored as text, matching Drizzle text() schema type
