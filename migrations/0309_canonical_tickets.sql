CREATE TABLE canonical_tickets (
  -- identity
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  connector_config_id         UUID         NOT NULL REFERENCES connector_configs(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),

  -- customer identity
  customer_email              TEXT,
  customer_name               TEXT,
  customer_external_id        TEXT,
  canonical_contact_id        UUID         REFERENCES canonical_contacts(id),

  -- lifecycle
  status                      TEXT         NOT NULL,
  priority                    TEXT         NOT NULL,
  opened_at                   TIMESTAMP WITH TIME ZONE NOT NULL,
  first_response_at           TIMESTAMP WITH TIME ZONE,
  last_customer_message_at    TIMESTAMP WITH TIME ZONE,
  last_agent_message_at       TIMESTAMP WITH TIME ZONE,
  closed_at                   TIMESTAMP WITH TIME ZONE,
  resolution_at               TIMESTAMP WITH TIME ZONE,

  -- routing
  inbox_id                    UUID         NOT NULL REFERENCES canonical_inboxes(id),
  assignee_agent_id           UUID         REFERENCES canonical_support_agents(id),

  -- collision primitives
  last_human_activity_at      TIMESTAMP WITH TIME ZONE,
  last_bot_activity_at        TIMESTAMP WITH TIME ZONE,
  bot_claimed_at              TIMESTAMP WITH TIME ZONE,
  bot_claimed_by_run_id       UUID,

  -- classification
  subject                     TEXT         NOT NULL,
  tags                        TEXT[]       NOT NULL DEFAULT '{}',
  category                    TEXT,
  source_channel              TEXT         NOT NULL,

  -- SLA
  sla_due_at                  TIMESTAMP WITH TIME ZONE,
  sla_breached                BOOLEAN      NOT NULL DEFAULT FALSE,
  sla_policy_external_id      TEXT,

  -- tombstone
  provider_deleted            BOOLEAN      NOT NULL DEFAULT FALSE,
  deleted_at_external         TIMESTAMP WITH TIME ZONE,
  deleted_at_canonical        TIMESTAMP WITH TIME ZONE,
  deletion_source             TEXT,

  -- common
  external_id                 TEXT         NOT NULL,
  external_metadata           JSONB,
  last_synced_at              TIMESTAMP WITH TIME ZONE,
  source_connection_id        UUID         REFERENCES integration_connections(id),
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_tickets_connector_external_unique UNIQUE (connector_config_id, external_id),
  CONSTRAINT canonical_tickets_status_enum
    CHECK (status IN ('open','pending_internal','waiting_on_customer','resolved','closed','unknown_provider_status')),
  CONSTRAINT canonical_tickets_priority_enum
    CHECK (priority IN ('low','medium','high','urgent')),
  CONSTRAINT canonical_tickets_source_channel_enum
    CHECK (source_channel IN ('email','chat','form','api')),
  CONSTRAINT canonical_tickets_deletion_source_enum
    CHECK (deletion_source IS NULL OR deletion_source IN ('provider_webhook','provider_poll_observation','manual_admin')),
  CONSTRAINT canonical_tickets_tombstone_consistency
    CHECK (
      (provider_deleted = FALSE AND deletion_source IS NULL)
      OR (provider_deleted = TRUE AND deletion_source IS NOT NULL)
    )
);

CREATE INDEX canonical_tickets_org_inbox_status_idx
  ON canonical_tickets (organisation_id, inbox_id, status);

CREATE INDEX canonical_tickets_org_customer_email_idx
  ON canonical_tickets (organisation_id, customer_email);

CREATE INDEX canonical_tickets_org_last_human_activity_idx
  ON canonical_tickets (organisation_id, last_human_activity_at);

CREATE INDEX canonical_tickets_unknown_status_idx
  ON canonical_tickets (organisation_id, status)
  WHERE status = 'unknown_provider_status';

CREATE INDEX canonical_tickets_sla_due_idx
  ON canonical_tickets (organisation_id, sla_due_at)
  WHERE sla_due_at IS NOT NULL AND sla_breached = FALSE;

ALTER TABLE canonical_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canonical_tickets_org_isolation ON canonical_tickets;
CREATE POLICY canonical_tickets_org_isolation ON canonical_tickets
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
