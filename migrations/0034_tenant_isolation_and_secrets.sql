-- =============================================================================
-- 0034_tenant_isolation_and_secrets.sql
-- M-8: Add subaccount_id to agent_conversations for proper tenant isolation.
-- H-3: Change agent_data_sources.source_headers from jsonb to text so the
--      application layer can store an encrypted JSON blob instead of plaintext
--      headers (which may contain API keys).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- M-8: agent_conversations — add subaccount_id
-- ---------------------------------------------------------------------------
ALTER TABLE "agent_conversations"
  ADD COLUMN IF NOT EXISTS "subaccount_id" uuid
    REFERENCES "subaccounts"("id");

-- Backfill: derive subaccount_id from the agent via its most recent run.
-- For existing rows this will be NULL (conversations pre-date the column).
-- The application layer will begin enforcing this going forward.
-- If a subaccount mapping is needed for historical data, run a data migration
-- to join agent_conversations → agent_runs → subaccount_id.

CREATE INDEX IF NOT EXISTS "agent_conversations_subaccount_idx"
  ON "agent_conversations" ("subaccount_id");

-- ---------------------------------------------------------------------------
-- H-3: agent_data_sources.source_headers — change to encrypted text
-- The column held plaintext JSONB headers (including API keys). It is now
-- stored as AES-256-GCM encrypted text via connectionTokenService. Existing
-- rows are set to NULL; operators must re-enter source headers via the UI.
-- ---------------------------------------------------------------------------
ALTER TABLE "agent_data_sources"
  ALTER COLUMN "source_headers" TYPE text USING NULL;
