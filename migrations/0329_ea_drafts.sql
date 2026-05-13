-- ea_drafts: post-approval send state for EA drafts
-- Composes over the existing actions table via proposal_action_id FK

CREATE TABLE IF NOT EXISTS ea_drafts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id       uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  owner_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_id            uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  run_id              uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  proposal_action_id  uuid NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
  kind                text NOT NULL,
  target_ref          jsonb NOT NULL,
  body                jsonb NOT NULL,
  send_state          text NOT NULL DEFAULT 'idle',
  external_result_id  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ea_drafts_send_state_check CHECK (
    send_state IN ('idle', 'sending', 'sent', 'send_failed')
  ),
  CONSTRAINT ea_drafts_kind_check CHECK (
    kind IN ('gmail_reply', 'gmail_new', 'slack_post', 'slack_dm', 'calendar_create', 'calendar_update', 'calendar_respond')
  )
);

ALTER TABLE ea_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ea_drafts FORCE ROW LEVEL SECURITY;

CREATE POLICY ea_drafts_isolation ON ea_drafts
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      owner_user_id = current_setting('app.current_user_id', true)::uuid
      OR current_setting('app.current_role', true) IN ('org_admin', 'subaccount_admin')
    )
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND owner_user_id = current_setting('app.current_user_id', true)::uuid
  );

CREATE INDEX IF NOT EXISTS ea_drafts_owner_send_state_idx
  ON ea_drafts(organisation_id, owner_user_id, send_state);

CREATE INDEX IF NOT EXISTS ea_drafts_proposal_action_idx
  ON ea_drafts(proposal_action_id);

CREATE INDEX IF NOT EXISTS ea_drafts_agent_idx
  ON ea_drafts(agent_id);

CREATE INDEX IF NOT EXISTS ea_drafts_run_idx
  ON ea_drafts(run_id);
