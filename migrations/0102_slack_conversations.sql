-- migrations/0102_slack_conversations.sql
CREATE TABLE slack_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid REFERENCES subaccounts(id),
  agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  workspace_id        text NOT NULL,
  channel_id          text NOT NULL,
  thread_ts           text NOT NULL,
  agent_run_id        uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX slack_conversations_thread_idx
  ON slack_conversations (workspace_id, channel_id, thread_ts);
CREATE INDEX slack_conversations_org_idx ON slack_conversations (organisation_id);
