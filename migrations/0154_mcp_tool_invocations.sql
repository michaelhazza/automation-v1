-- Migration 0154 — mcp_tool_invocations
-- Append-only ledger for every MCP tool call attempt (including retries).
-- See docs/mcp-tool-invocations-spec.md.

CREATE TABLE IF NOT EXISTS mcp_tool_invocations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid        NOT NULL REFERENCES organisations(id),
  subaccount_id         uuid        REFERENCES subaccounts(id),
  run_id                uuid        REFERENCES agent_runs(id),
  agent_id              uuid        REFERENCES agents(id),
  mcp_server_config_id  uuid        REFERENCES mcp_server_configs(id),
  server_slug           text        NOT NULL,
  tool_name             text        NOT NULL,
  gate_level            text        CHECK (gate_level IN ('auto', 'review', 'block')),
  status                text        NOT NULL CHECK (status IN ('success', 'error', 'timeout', 'budget_blocked')),
  failure_reason        text        CHECK (failure_reason IN ('timeout', 'process_crash', 'invalid_response', 'auth_error', 'rate_limited', 'unknown')),
  duration_ms           integer     NOT NULL DEFAULT 0,
  response_size_bytes   integer,
  was_truncated         boolean     NOT NULL DEFAULT false,
  is_test_run           boolean     NOT NULL DEFAULT false,
  call_index            integer,
  billing_month         text        NOT NULL,
  billing_day           text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index: prevents double-writes for the same attempt within a run
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_invocations_run_call_unique
  ON mcp_tool_invocations (run_id, call_index)
  WHERE run_id IS NOT NULL AND call_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_org_month_idx
  ON mcp_tool_invocations (organisation_id, billing_month);

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_sub_month_idx
  ON mcp_tool_invocations (subaccount_id, billing_month)
  WHERE subaccount_id IS NOT NULL;

-- Covering index for run-detail mcpCallSummary GROUP BY server_slug query
CREATE INDEX IF NOT EXISTS mcp_tool_invocations_run_server_idx
  ON mcp_tool_invocations (run_id, server_slug)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_server_slug_idx
  ON mcp_tool_invocations (organisation_id, server_slug, billing_month);

-- Enforce status/failure_reason coupling at the DB level:
--   success rows must have failure_reason = NULL
--   non-success rows must have failure_reason set
ALTER TABLE mcp_tool_invocations ADD CONSTRAINT mcp_tool_invocations_failure_reason_chk
  CHECK (
    (status = 'success' AND failure_reason IS NULL)
    OR
    (status != 'success' AND failure_reason IS NOT NULL)
  );

-- Partial index for error/timeout analytics queries (WHERE status != 'success')
CREATE INDEX IF NOT EXISTS mcp_tool_invocations_error_idx
  ON mcp_tool_invocations (organisation_id, status, billing_month)
  WHERE status != 'success';
