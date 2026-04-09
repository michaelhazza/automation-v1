-- Down-migration for 0082_tool_call_security_events.sql

DROP POLICY IF EXISTS tool_call_security_events_org_isolation ON tool_call_security_events;
ALTER TABLE tool_call_security_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tool_call_security_events DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS tool_call_security_events_run_tool_unique;
DROP INDEX IF EXISTS tool_call_security_events_run_idx;
DROP INDEX IF EXISTS tool_call_security_events_org_idx;
DROP TABLE IF EXISTS tool_call_security_events;

ALTER TABLE organisations
  DROP COLUMN IF EXISTS security_event_retention_days;
