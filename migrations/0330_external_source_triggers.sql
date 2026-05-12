-- external_trigger_dedup: idempotency ledger for external-source trigger events
-- Composite PK (provider, dedup_key, owner_user_id) prevents duplicate run enqueuing
--
-- Note on `agent_triggers.event_type` "enum extension" referenced in the
-- personal-assistant-v1 spec §5.2 / §10 / §24.1 (chunk group A.3):
-- `agent_triggers.event_type` is a `text` column (see
-- migrations/0029_phase_1_2_memory_entities_triggers.sql line 48), NOT a
-- Postgres ENUM type. The three new values (`gmail_message_received`,
-- `calendar_event_imminent`, `slack_mention`) are declared at the
-- TypeScript layer in server/db/schema/agentTriggers.ts via `.$type<...>()`;
-- no `ALTER TYPE ... ADD VALUE` DDL is needed because no Postgres enum
-- exists for this column. Confirmed in chatgpt-pr-review round 1 (R1).

CREATE TABLE IF NOT EXISTS external_trigger_dedup (
  provider         text NOT NULL,
  dedup_key        text NOT NULL,
  owner_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id    uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  fired_at         timestamptz NOT NULL DEFAULT now(),
  trigger_id       uuid,
  run_id           uuid,
  PRIMARY KEY (provider, dedup_key, owner_user_id)
);

ALTER TABLE external_trigger_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_trigger_dedup FORCE ROW LEVEL SECURITY;

-- RLS policy per spec §21.3: admin access is `org_admin` OR `system_admin`
-- (NOT `subaccount_admin`). Webhook handlers + trigger dispatch run via
-- admin connection per the existing pattern.
CREATE POLICY external_trigger_dedup_isolation ON external_trigger_dedup
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      owner_user_id = current_setting('app.current_user_id', true)::uuid
      OR current_setting('app.current_role', true) IN ('org_admin', 'system_admin')
    )
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND owner_user_id = current_setting('app.current_user_id', true)::uuid
  );

-- Index for lookups by organisation + owner (for cleanup jobs)
CREATE INDEX IF NOT EXISTS external_trigger_dedup_org_owner_idx
  ON external_trigger_dedup(organisation_id, owner_user_id, fired_at DESC);
