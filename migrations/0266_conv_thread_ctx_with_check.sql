-- up: drop and recreate conv_thread_ctx_org_isolation with WITH CHECK clause.
-- Closes write-isolation gap A-D3: USING clause existed but WITH CHECK
-- was missing, allowing cross-tenant row inserts with mismatched org ID.
-- Drop-and-recreate is used by default — it is always safe regardless of PG version.
DROP POLICY IF EXISTS conv_thread_ctx_org_isolation ON conversation_thread_context;
CREATE POLICY conv_thread_ctx_org_isolation
  ON conversation_thread_context AS PERMISSIVE FOR ALL TO authenticated
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

-- down: restore to USING-only
DROP POLICY IF EXISTS conv_thread_ctx_org_isolation ON conversation_thread_context;
CREATE POLICY conv_thread_ctx_org_isolation
  ON conversation_thread_context AS PERMISSIVE FOR ALL TO authenticated
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
