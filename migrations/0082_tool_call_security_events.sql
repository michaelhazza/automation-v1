-- 0082_tool_call_security_events.sql
--
-- Sprint 2 — P1.1 Layer 3: universal before-tool authorisation hook.
--
-- Every tool call the agent middleware evaluates writes one row here
-- (allow / deny / review). Separate from action_events and audit_events
-- because (a) higher write volume — every tool call, not just gated ones,
-- (b) different retention requirements — compliance log, longer retention,
-- (c) audit queries should not contend with run-state queries.
--
-- Idempotency: a partial unique index on (agent_run_id, tool_call_id)
-- lets the middleware use INSERT ... ON CONFLICT DO NOTHING to dedupe
-- replays from retry loops, reflection injection, and pg-boss re-delivery.
--
-- Per-org retention override lives on organisations.security_event_retention_days
-- (nullable, NULL falls back to DEFAULT_SECURITY_EVENT_RETENTION_DAYS in
-- server/config/limits.ts). Pruned nightly by the security-events-cleanup
-- pg-boss job.

CREATE TABLE IF NOT EXISTS tool_call_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_call_id text,
  tool_slug text NOT NULL,
  decision text NOT NULL,
  reason text,
  args_hash text NOT NULL,
  scope_check_results jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tool_call_security_events_decision_check
    CHECK (decision IN ('allow', 'deny', 'review'))
);

CREATE INDEX IF NOT EXISTS tool_call_security_events_org_idx
  ON tool_call_security_events (organisation_id, created_at);

CREATE INDEX IF NOT EXISTS tool_call_security_events_run_idx
  ON tool_call_security_events (agent_run_id);

-- Partial unique index — dedupes replays of the same tool call.
-- tool_call_id is nullable (system-initiated checks may have none), so
-- the uniqueness only applies where tool_call_id is set.
CREATE UNIQUE INDEX IF NOT EXISTS tool_call_security_events_run_tool_unique
  ON tool_call_security_events (agent_run_id, tool_call_id)
  WHERE tool_call_id IS NOT NULL;

-- Per-org retention override. NULL = use default from limits.ts.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS security_event_retention_days integer;

-- ---------------------------------------------------------------------------
-- Row Level Security — Sprint 2 P1.1 Layer 1 (see 0079 for policy shape).
-- tool_call_security_events is the compliance stream; a cross-tenant leak
-- here would expose another org's tool usage, scope-check reasoning and
-- args hashes. Fail-closed on unset app.organisation_id.
-- ---------------------------------------------------------------------------

ALTER TABLE tool_call_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_call_security_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tool_call_security_events_org_isolation ON tool_call_security_events;
CREATE POLICY tool_call_security_events_org_isolation ON tool_call_security_events
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
