-- migrations/0238_system_agents_v7_1.sql
-- v7.1 system-agents migration: active-row uniqueness + cross-run idempotency table.

BEGIN;

-- (1a) system_agents.slug — replace full unique with partial unique
DROP INDEX IF EXISTS system_agents_slug_idx;
CREATE UNIQUE INDEX system_agents_slug_active_idx
  ON system_agents (slug)
  WHERE deleted_at IS NULL;

-- (1b) agents.(organisation_id, slug) — confirm partial-unique posture.
-- The index is already declared partial in server/db/schema/agents.ts
-- (`agents_org_slug_uniq` with WHERE deleted_at IS NULL). This block is
-- defensive: drop-and-recreate to guarantee shape parity in any DB that
-- predates the partial declaration.
DROP INDEX IF EXISTS agents_org_slug_uniq;
CREATE UNIQUE INDEX agents_org_slug_active_uniq
  ON agents (organisation_id, slug)
  WHERE deleted_at IS NULL;

-- (2) skill_idempotency_keys — cross-run replay dedup for write skills
CREATE TABLE skill_idempotency_keys (
  subaccount_id     uuid       NOT NULL,
  organisation_id   uuid       NOT NULL,
  skill_slug        text       NOT NULL,
  key_hash          text       NOT NULL,
  request_hash      text       NOT NULL,
  response_payload  jsonb      NOT NULL DEFAULT '{}'::jsonb,
  status            text       NOT NULL DEFAULT 'in_flight'
                                CHECK (status IN ('in_flight', 'completed', 'failed')),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  expires_at        timestamptz NULL,  -- NULL = never expires (financial)
  PRIMARY KEY (subaccount_id, skill_slug, key_hash)
);

CREATE INDEX skill_idempotency_keys_expires_at_idx
  ON skill_idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX skill_idempotency_keys_org_idx
  ON skill_idempotency_keys (organisation_id);

ALTER TABLE skill_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_idempotency_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_idempotency_keys_org_isolation ON skill_idempotency_keys;
CREATE POLICY skill_idempotency_keys_org_isolation ON skill_idempotency_keys
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

COMMIT;
