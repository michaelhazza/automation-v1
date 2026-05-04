-- Migration 0254: Canonical workspace layer — workspace_actors, workspace_identities,
-- workspace_messages, workspace_calendar_events.
-- Adds workspace_identity_status enum, splits connector_configs unique index
-- into CRM-scoped + workspace-scoped partials, and applies org-isolation RLS
-- policies using the 0245 canonical template.
--
-- Phase A — schema only. No code reads these tables until Phase B.
-- Entire migration runs in a single transaction for atomicity of the
-- connector_configs index swap (drop + create two partials).

BEGIN;

-- ── 1. Enum ────────────────────────────────────────────────────────────────────

CREATE TYPE workspace_identity_status AS ENUM
  ('provisioned', 'active', 'suspended', 'revoked', 'archived');

-- ── 2. connector_configs index swap ───────────────────────────────────────────
-- Drop the org-wide unique index that prevents a second subaccount in an org
-- from configuring Google Workspace. Replace with two partial unique indexes:
-- one for CRM-style connectors (org-wide, no subaccount) and one for workspace
-- connectors (per org+subaccount).

DROP INDEX IF EXISTS connector_configs_org_type_unique;

-- CRM-style connectors: one per org (original semantics preserved).
CREATE UNIQUE INDEX connector_configs_org_type_uniq_crm
  ON connector_configs (organisation_id, connector_type)
  WHERE connector_type NOT IN ('synthetos_native', 'google_workspace');

-- Workspace connectors: one per (org, subaccount, type) — supports multi-tenant within an org.
CREATE UNIQUE INDEX connector_configs_org_subaccount_type_uniq_workspace
  ON connector_configs (organisation_id, subaccount_id, connector_type)
  WHERE connector_type IN ('synthetos_native', 'google_workspace');

-- ── 3. workspace_actors ────────────────────────────────────────────────────────

CREATE TABLE workspace_actors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid NOT NULL REFERENCES subaccounts(id),
  actor_kind          text NOT NULL CHECK (actor_kind IN ('agent', 'human')),
  display_name        text NOT NULL,
  parent_actor_id     uuid REFERENCES workspace_actors(id),
  agent_role          text,
  agent_title         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_actors_org_idx        ON workspace_actors(organisation_id);
CREATE INDEX workspace_actors_subaccount_idx ON workspace_actors(subaccount_id);
CREATE INDEX workspace_actors_kind_idx       ON workspace_actors(actor_kind);
CREATE INDEX workspace_actors_parent_idx     ON workspace_actors(parent_actor_id);

CREATE OR REPLACE FUNCTION workspace_actors_parent_same_subaccount() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_actor_id IS NOT NULL THEN
    PERFORM 1 FROM workspace_actors p
      WHERE p.id = NEW.parent_actor_id
        AND p.subaccount_id = NEW.subaccount_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'workspace_actors.parent_actor_id must reference an actor in the same subaccount';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_actors_parent_same_subaccount_trg
  BEFORE INSERT OR UPDATE OF parent_actor_id, subaccount_id ON workspace_actors
  FOR EACH ROW EXECUTE FUNCTION workspace_actors_parent_same_subaccount();

-- ── 4. workspace_identities ────────────────────────────────────────────────────

CREATE TABLE workspace_identities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES organisations(id),
  subaccount_id            uuid NOT NULL REFERENCES subaccounts(id),
  actor_id                 uuid NOT NULL REFERENCES workspace_actors(id),
  connector_config_id      uuid NOT NULL REFERENCES connector_configs(id),
  backend                  text NOT NULL CHECK (backend IN ('synthetos_native', 'google_workspace')),
  email_address            text NOT NULL,
  email_sending_enabled    boolean NOT NULL DEFAULT true,
  external_user_id         text,
  display_name             text NOT NULL,
  photo_url                text,
  status                   workspace_identity_status NOT NULL DEFAULT 'provisioned',
  status_changed_at        timestamptz NOT NULL DEFAULT now(),
  status_changed_by        uuid REFERENCES users(id),
  provisioning_request_id  text NOT NULL,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz
);

-- One active-or-suspended identity per actor per backend.
CREATE UNIQUE INDEX workspace_identities_actor_backend_active_uniq
  ON workspace_identities (actor_id, backend)
  WHERE status IN ('provisioned', 'active', 'suspended');

-- Idempotency: one identity per provisioning_request_id.
CREATE UNIQUE INDEX workspace_identities_provisioning_request_uniq
  ON workspace_identities (provisioning_request_id);

-- Email uniqueness within a connector config.
CREATE UNIQUE INDEX workspace_identities_email_per_config_uniq
  ON workspace_identities (connector_config_id, lower(email_address))
  WHERE status IN ('provisioned', 'active', 'suspended');

CREATE INDEX workspace_identities_org_idx        ON workspace_identities(organisation_id);
CREATE INDEX workspace_identities_subaccount_idx ON workspace_identities(subaccount_id);
CREATE INDEX workspace_identities_actor_idx      ON workspace_identities(actor_id);
CREATE INDEX workspace_identities_status_idx     ON workspace_identities(status);

-- Migration retry idempotency.
CREATE UNIQUE INDEX workspace_identities_migration_request_actor_uniq
  ON workspace_identities ((metadata->>'migrationRequestId'), actor_id)
  WHERE metadata ? 'migrationRequestId';

-- Identity must live in the same subaccount as its actor.
CREATE OR REPLACE FUNCTION workspace_identities_actor_same_subaccount() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM workspace_actors a
    WHERE a.id = NEW.actor_id
      AND a.subaccount_id = NEW.subaccount_id
      AND a.organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_identities.{subaccount_id, organisation_id} must match the actor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_identities_actor_same_subaccount_trg
  BEFORE INSERT OR UPDATE OF actor_id, subaccount_id, organisation_id ON workspace_identities
  FOR EACH ROW EXECUTE FUNCTION workspace_identities_actor_same_subaccount();

-- Backend mismatch guard.
CREATE OR REPLACE FUNCTION workspace_identities_backend_matches_config() RETURNS trigger AS $$
DECLARE
  config_type text;
BEGIN
  SELECT connector_type INTO config_type
    FROM connector_configs WHERE id = NEW.connector_config_id;
  IF config_type IS DISTINCT FROM NEW.backend THEN
    RAISE EXCEPTION
      'workspace_identities.backend (%) must match connector_configs.connector_type (%) for config %',
      NEW.backend, config_type, NEW.connector_config_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_identities_backend_matches_config_trg
  BEFORE INSERT OR UPDATE OF backend, connector_config_id ON workspace_identities
  FOR EACH ROW EXECUTE FUNCTION workspace_identities_backend_matches_config();

-- ── 5. workspace_messages ──────────────────────────────────────────────────────

CREATE TABLE workspace_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  subaccount_id         uuid NOT NULL REFERENCES subaccounts(id),
  identity_id           uuid NOT NULL REFERENCES workspace_identities(id),
  actor_id              uuid NOT NULL REFERENCES workspace_actors(id),
  thread_id             uuid NOT NULL,
  external_message_id   text,
  direction             text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address          text NOT NULL,
  to_addresses          text[] NOT NULL,
  cc_addresses          text[],
  subject               text,
  body_text             text,
  body_html             text,
  sent_at               timestamptz NOT NULL,
  received_at           timestamptz,
  audit_event_id        uuid REFERENCES audit_events(id),
  rate_limit_decision   text NOT NULL DEFAULT 'allowed',
  attachments_count     integer NOT NULL DEFAULT 0,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_messages_org_idx        ON workspace_messages(organisation_id);
CREATE INDEX workspace_messages_subaccount_idx ON workspace_messages(subaccount_id);
CREATE INDEX workspace_messages_identity_idx   ON workspace_messages(identity_id);
CREATE INDEX workspace_messages_actor_idx      ON workspace_messages(actor_id);
CREATE INDEX workspace_messages_thread_idx     ON workspace_messages(thread_id);

CREATE UNIQUE INDEX workspace_messages_external_uniq
  ON workspace_messages (identity_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX workspace_messages_dedupe_uniq
  ON workspace_messages (identity_id, (metadata->>'dedupe_key'))
  WHERE metadata ? 'dedupe_key';

-- ── 6. workspace_calendar_events ──────────────────────────────────────────────

CREATE TABLE workspace_calendar_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  subaccount_id         uuid NOT NULL REFERENCES subaccounts(id),
  identity_id           uuid NOT NULL REFERENCES workspace_identities(id),
  actor_id              uuid NOT NULL REFERENCES workspace_actors(id),
  external_event_id     text,
  organiser_email       text NOT NULL,
  title                 text NOT NULL,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  attendee_emails       text[] NOT NULL,
  response_status       text NOT NULL CHECK (response_status IN ('needs_action', 'accepted', 'declined', 'tentative')),
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_calendar_events_actor_idx   ON workspace_calendar_events(actor_id);
CREATE INDEX workspace_calendar_events_starts_idx  ON workspace_calendar_events(starts_at);

CREATE UNIQUE INDEX workspace_calendar_events_external_uniq
  ON workspace_calendar_events (identity_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- ── 7. RLS — org-isolation policies (0245 canonical template) ─────────────────

ALTER TABLE workspace_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_actors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_actors_org_isolation ON workspace_actors;
CREATE POLICY workspace_actors_org_isolation ON workspace_actors
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

ALTER TABLE workspace_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_identities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_identities_org_isolation ON workspace_identities;
CREATE POLICY workspace_identities_org_isolation ON workspace_identities
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

ALTER TABLE workspace_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_messages_org_isolation ON workspace_messages;
CREATE POLICY workspace_messages_org_isolation ON workspace_messages
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

ALTER TABLE workspace_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_calendar_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_calendar_events_org_isolation ON workspace_calendar_events;
CREATE POLICY workspace_calendar_events_org_isolation ON workspace_calendar_events
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
