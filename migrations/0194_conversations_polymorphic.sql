-- Universal Brief: polymorphic conversations + conversation_messages tables
-- Phase 2 of the Universal Brief spec (docs/universal-brief-dev-spec.md §5.1)

CREATE TABLE IF NOT EXISTS conversations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL,
  subaccount_id         uuid,
  scope_type            text NOT NULL CHECK (scope_type IN ('agent', 'brief', 'task', 'agent_run')),
  scope_id              uuid NOT NULL,
  created_by_user_id    uuid,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX conversations_org_idx ON conversations (organisation_id);
CREATE INDEX conversations_subaccount_idx ON conversations (subaccount_id);
CREATE INDEX conversations_scope_idx ON conversations (scope_type, scope_id);
CREATE UNIQUE INDEX conversations_unique_scope ON conversations (scope_type, scope_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organisation_id       uuid NOT NULL,
  subaccount_id         uuid,
  role                  text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content               text NOT NULL,
  artefacts             jsonb NOT NULL DEFAULT '[]',
  sender_user_id        uuid,
  sender_agent_id       uuid,
  triggered_run_id      uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conv_msgs_conversation_idx ON conversation_messages (conversation_id);
CREATE INDEX conv_msgs_org_idx ON conversation_messages (organisation_id);
CREATE INDEX conv_msgs_subaccount_idx ON conversation_messages (subaccount_id);

-- Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_org_isolation ON conversations
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);

CREATE POLICY conversation_messages_org_isolation ON conversation_messages
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);
