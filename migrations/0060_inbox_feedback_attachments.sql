-- 0060_inbox_feedback_attachments.sql
-- Feature 3: Inbox Read States
-- Feature 8: Task Attachments
-- Feature 9: Feedback Voting

CREATE TABLE inbox_read_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inbox_read_user_entity_uniq ON inbox_read_states(user_id, entity_type, entity_id);
CREATE INDEX inbox_read_user_unread_idx ON inbox_read_states(user_id, is_read);
CREATE INDEX inbox_read_user_archived_idx ON inbox_read_states(user_id, is_archived);

CREATE TABLE task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'local',
  thumbnail_key TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_by_agent_id UUID REFERENCES agents(id),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT task_attach_idempotency UNIQUE(task_id, idempotency_key)
);

CREATE INDEX task_attach_task_idx ON task_attachments(task_id);
CREATE INDEX task_attach_org_idx ON task_attachments(organisation_id);

CREATE TABLE feedback_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  vote TEXT NOT NULL,
  comment TEXT,
  agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX feedback_agent_idx ON feedback_votes(agent_id);
CREATE INDEX feedback_org_idx ON feedback_votes(organisation_id);
CREATE INDEX feedback_agent_time_idx ON feedback_votes(agent_id, created_at);
