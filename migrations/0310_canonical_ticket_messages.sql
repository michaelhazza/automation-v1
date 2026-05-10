CREATE TABLE canonical_ticket_messages (
  -- identity
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  ticket_id                   UUID         NOT NULL REFERENCES canonical_tickets(id),
  external_id                 TEXT         NOT NULL,
  connector_config_id         UUID         NOT NULL REFERENCES connector_configs(id),

  -- denormalised (avoids join in three-column unique index)
  ticket_external_id          TEXT         NOT NULL,

  -- message attributes
  direction                   TEXT         NOT NULL,
  visibility                  TEXT         NOT NULL,
  author_type                 TEXT         NOT NULL,

  -- split author FKs (polymorphic pattern — see CHECK constraint below)
  author_contact_id           UUID         REFERENCES canonical_contacts(id),
  author_support_agent_id     UUID         REFERENCES canonical_support_agents(id),

  -- content
  body_text                   TEXT         NOT NULL,
  body_html                   TEXT,
  attachments                 JSONB,

  -- redaction
  redacted                    BOOLEAN      NOT NULL DEFAULT FALSE,
  redacted_at_external        TIMESTAMP WITH TIME ZONE,
  redacted_at_canonical       TIMESTAMP WITH TIME ZONE,

  -- timestamps
  created_at_external         TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- provenance: source_draft_id has NO FK constraint and NO index here.
  -- The FK to draft_messages and the partial index are deferred to migration 0311 (C4).
  source_draft_id             UUID,

  -- common
  external_metadata           JSONB,

  CONSTRAINT canonical_ticket_messages_connector_ticket_external_unique
    UNIQUE (connector_config_id, ticket_external_id, external_id),

  CONSTRAINT canonical_ticket_messages_direction_enum
    CHECK (direction IN ('inbound','outbound','internal_note')),

  CONSTRAINT canonical_ticket_messages_visibility_enum
    CHECK (visibility IN ('public','internal')),

  CONSTRAINT canonical_ticket_messages_author_type_enum
    CHECK (author_type IN ('customer','agent','bot','system')),

  -- Polymorphic-FK author consistency:
  --   customer  → author_support_agent_id must be NULL;
  --               author_contact_id may be NULL when no canonical contact match exists.
  --   agent/bot → author_support_agent_id must be set; author_contact_id must be NULL.
  --   system    → both author FK columns must be NULL.
  CONSTRAINT canonical_ticket_messages_author_fk_consistency
    CHECK (
      (author_type = 'customer' AND author_support_agent_id IS NULL)
      OR (author_type IN ('agent', 'bot') AND author_contact_id IS NULL AND author_support_agent_id IS NOT NULL)
      OR (author_type = 'system' AND author_contact_id IS NULL AND author_support_agent_id IS NULL)
    )
);

-- Ordered thread reads: all messages for a ticket ordered by provider timestamp, tiebroken by id.
CREATE INDEX canonical_ticket_messages_org_ticket_thread_idx
  ON canonical_ticket_messages (organisation_id, ticket_id, created_at_external, id);

ALTER TABLE canonical_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_ticket_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canonical_ticket_messages_org_isolation ON canonical_ticket_messages;
CREATE POLICY canonical_ticket_messages_org_isolation ON canonical_ticket_messages
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
