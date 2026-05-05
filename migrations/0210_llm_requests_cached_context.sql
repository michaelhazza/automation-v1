-- Migration 0210: llm_requests cache attribution columns (§5.9)
-- Adds cache_creation_tokens (from Anthropic cache_creation_input_tokens) and
-- prefix_hash (the assembled prefix hash written by cachedContextOrchestrator).

ALTER TABLE llm_requests ADD COLUMN cache_creation_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE llm_requests ADD COLUMN prefix_hash text;

-- Partial index for querying runs by prefix hash (cache analysis)
CREATE INDEX llm_requests_prefix_hash_idx ON llm_requests (prefix_hash)
  WHERE prefix_hash IS NOT NULL;
