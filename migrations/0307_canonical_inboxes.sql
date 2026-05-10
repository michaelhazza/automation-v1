CREATE TABLE canonical_inboxes (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID         NOT NULL REFERENCES organisations(id),
  connector_config_id  UUID         NOT NULL REFERENCES connector_configs(id),
  subaccount_id        UUID         REFERENCES subaccounts(id),
  external_id          TEXT         NOT NULL,
  name                 TEXT         NOT NULL,
  email_address        TEXT,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  agent_config         JSONB        NOT NULL DEFAULT '{"version":1,"mode":"disabled","collisionWindow":{"minMinutesSinceHumanActivity":30,"respectHumanAssignee":true},"draftExpiry":{"awaitingReviewHours":72,"draftHours":24},"optIns":{"autonomousReplyOnWaitingOnCustomer":false,"postResolutionFollowUp":false}}'::jsonb,
  external_metadata    JSONB,
  last_synced_at       TIMESTAMP WITH TIME ZONE,
  source_connection_id UUID         REFERENCES integration_connections(id),
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_inboxes_connector_external_unique UNIQUE (connector_config_id, external_id)
);

CREATE INDEX canonical_inboxes_org_active_idx
  ON canonical_inboxes (organisation_id, is_active);

ALTER TABLE canonical_inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_inboxes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canonical_inboxes_org_isolation ON canonical_inboxes;
CREATE POLICY canonical_inboxes_org_isolation ON canonical_inboxes
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
