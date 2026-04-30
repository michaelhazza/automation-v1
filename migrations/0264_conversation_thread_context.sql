CREATE TABLE conversation_thread_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  conversation_id UUID NOT NULL UNIQUE REFERENCES agent_conversations(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID REFERENCES subaccounts(id),
  decisions JSONB NOT NULL DEFAULT '[]',
  tasks JSONB NOT NULL DEFAULT '[]',
  approach TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX conv_thread_ctx_org_idx ON conversation_thread_context (organisation_id);
CREATE UNIQUE INDEX conv_thread_ctx_conv_uniq ON conversation_thread_context (conversation_id);

ALTER TABLE conversation_thread_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY conv_thread_ctx_org_isolation ON conversation_thread_context
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
