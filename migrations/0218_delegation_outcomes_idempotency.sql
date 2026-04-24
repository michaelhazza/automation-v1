-- migration: 0218_delegation_outcomes_idempotency
--
-- Add idempotency guard to delegation_outcomes so retries, async writes, and
-- soft-breaker half-open probes cannot produce duplicate rows for the same
-- logical delegation event.
--
-- Key: (run_id, caller_agent_id, target_agent_id, delegation_scope, outcome)
-- Rationale: within a single run, any legitimate second call that produces
-- the same (caller → target, same scope, same outcome) pair is a retry or
-- accidental double-write — the observability signal is identical, so
-- collapsing duplicates is the desired behaviour. A future use case that
-- genuinely needs multiple identical-outcome rows within one run can add a
-- deterministic `attempt_id` column + rotate this unique key to include it.
--
-- Service layer uses ON CONFLICT DO NOTHING (same pattern as
-- mcp_tool_invocations per architecture.md §mcp_tool_invocations) so the
-- duplicate is silently dropped without raising the breaker.

CREATE UNIQUE INDEX delegation_outcomes_idempotency_idx
  ON delegation_outcomes (run_id, caller_agent_id, target_agent_id, delegation_scope, outcome);
