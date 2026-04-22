-- 0200_fix_universal_brief_rls.sql
--
-- Universal Brief feature — repair Row Level Security on the three tables
-- introduced by migrations 0194 and 0195. The original policies referenced
-- `app.current_organisation_id`, a session variable that is never set in
-- this codebase. The canonical variable is `app.organisation_id` (see
-- migrations 0079-0081 and server/middleware/auth.ts + server/lib/createWorker.ts).
--
-- The original migrations also omitted FORCE ROW LEVEL SECURITY (Postgres
-- bypasses RLS for the table owner without it) and the explicit IS NOT NULL
-- / non-empty guards + WITH CHECK clause that the 0079 canonical pattern uses.
--
-- This migration drops the broken policies and recreates them matching
-- 0079_rls_tasks_actions_runs.sql exactly, so tenant isolation is enforced
-- at the database layer regardless of the migration-runner's ownership.

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_org_isolation ON conversations;
CREATE POLICY conversations_org_isolation ON conversations
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

-- ---------------------------------------------------------------------------
-- conversation_messages
-- ---------------------------------------------------------------------------

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_messages_org_isolation ON conversation_messages;
CREATE POLICY conversation_messages_org_isolation ON conversation_messages
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

-- ---------------------------------------------------------------------------
-- fast_path_decisions
-- ---------------------------------------------------------------------------

ALTER TABLE fast_path_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fast_path_decisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fast_path_decisions_org_isolation ON fast_path_decisions;
CREATE POLICY fast_path_decisions_org_isolation ON fast_path_decisions
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
