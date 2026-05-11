-- Migration 0321: Operator Session Identity — consent ledger tables
--
-- Creates operator_session_consents and operator_session_consent_events
-- with RLS, FORCE RLS, and the canonical three-guard org-isolation policy.
--
-- Manifest: see server/config/rlsProtectedTables.ts — keep in sync.
-- Spec: docs/operator-session-identity-spec.md §7.1, §7.2, §8.1, §8.2

-- ---------------------------------------------------------------------------
-- operator_session_consents
-- Consent audit log: one row per user acceptance of a disclosure version
-- for a given connection. Immutable after INSERT (enforced in application
-- layer; guarded by CI gate scripts/verify-operator-session-consent-immutable.sh).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_session_consents (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id         uuid        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id           uuid                 REFERENCES subaccounts(id)   ON DELETE SET NULL,
  user_id                 uuid                 REFERENCES users(id)         ON DELETE SET NULL,
  -- connection_id is nullable on INSERT; filled by post-INSERT UPDATE once the
  -- integration_connections row exists (spec §7.2 FK bootstrap order).
  connection_id           uuid                 REFERENCES integration_connections(id) ON DELETE SET NULL,
  plan_tier               text        NOT NULL,
  disclosure_version      int         NOT NULL,
  accepted_at             timestamptz NOT NULL DEFAULT now(),
  disclosure_text_snapshot text       NOT NULL,
  consent_text_snapshot   text        NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Named unique index: one consent per (connection, disclosure_version).
-- Named per spec §7.1 for deterministic FK reference from 0322.
CREATE UNIQUE INDEX IF NOT EXISTS operator_session_consents_connection_disclosure_unique
  ON operator_session_consents (connection_id, disclosure_version);

-- RLS: canonical three-guard org-isolation pattern.
ALTER TABLE operator_session_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_session_consents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_session_consents_org_isolation ON operator_session_consents;
CREATE POLICY operator_session_consents_org_isolation ON operator_session_consents
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
-- operator_session_consent_events
-- Append-only event ledger: records granted / revoked / superseded transitions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_session_consent_events (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id           uuid        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  consent_id                uuid        NOT NULL REFERENCES operator_session_consents(id) ON DELETE RESTRICT,
  event_type                text        NOT NULL CHECK (event_type IN ('granted', 'revoked', 'superseded')),
  actor_user_id             uuid                 REFERENCES users(id) ON DELETE SET NULL,
  at                        timestamptz NOT NULL DEFAULT now(),
  -- Only non-NULL for event_type = 'superseded'
  superseded_by_consent_id  uuid                 REFERENCES operator_session_consents(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- RLS: same three-guard pattern.
ALTER TABLE operator_session_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_session_consent_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_session_consent_events_org_isolation ON operator_session_consent_events;
CREATE POLICY operator_session_consent_events_org_isolation ON operator_session_consent_events
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
