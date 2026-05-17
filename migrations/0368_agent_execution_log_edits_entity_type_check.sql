-- LAEL-P2-L3: tighten agent_execution_log_edits.entity_type to the two values
-- the writer codepath actually emits ('memory_block', 'workspace_memory_summary').
-- The 0367 migration left the column unconstrained text; this CHECK prevents
-- drift if a future call site forgets the closed-enum contract.

ALTER TABLE agent_execution_log_edits
  ADD CONSTRAINT agent_execution_log_edits_entity_type_check
  CHECK (entity_type IN ('memory_block', 'workspace_memory_summary'));
