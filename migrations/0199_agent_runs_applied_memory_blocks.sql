-- Migration 0199 — Universal Brief Phase 8 / W3c: provenance trail
--
-- Extends agent_runs to track which memory_blocks were injected into context
-- and which were actually cited in agent output.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS applied_memory_block_ids jsonb DEFAULT '[]' NOT NULL,
  ADD COLUMN IF NOT EXISTS applied_memory_block_citations jsonb DEFAULT '[]' NOT NULL;

-- applied_memory_block_ids:        blocks injected into the run's context
-- applied_memory_block_citations:  blocks cited in agent output
--   shape: [{ memoryBlockId: string, citedSnippet?: string, citationScore: number }]
