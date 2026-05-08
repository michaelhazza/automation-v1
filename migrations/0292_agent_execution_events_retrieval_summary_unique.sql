-- Auto Knowledge Retrieval Phase 4A: partial unique index to enforce exactly-one
-- retrieval.summary event per run (spec §10.4, §1.5 #7).

CREATE UNIQUE INDEX agent_execution_events_retrieval_summary_run_uq
  ON agent_execution_events (run_id)
  WHERE event_type = 'retrieval.summary';
