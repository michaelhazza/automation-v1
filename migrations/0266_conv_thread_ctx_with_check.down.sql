-- Restore USING-only policy (removes WITH CHECK).
-- Reverts to the original shape from migration 0264.
DROP POLICY IF EXISTS conv_thread_ctx_org_isolation ON conversation_thread_context;
CREATE POLICY conv_thread_ctx_org_isolation ON conversation_thread_context
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
