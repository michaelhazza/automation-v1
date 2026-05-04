CREATE TABLE task_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organisation_id  uuid        NOT NULL,
  subaccount_id    uuid,
  seq              integer     NOT NULL,
  event_type       text        NOT NULL,
  payload          jsonb       NOT NULL DEFAULT '{}',
  origin           text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);
CREATE INDEX idx_task_events_task_seq ON task_events (task_id, seq);
CREATE INDEX idx_task_events_org_time ON task_events (organisation_id, created_at);

-- Partial unique index: one step.approval_resolved event per (task_id, stepId).
-- Prevents duplicate emission at DB level regardless of retry paths.
-- taskEventService stores the whole TaskEvent object into the payload column,
-- so stepId lives at payload->'payload'->>'stepId' (one level deeper).
-- NULLS NOT DISTINCT so rows with a NULL stepId do not bypass the constraint.
CREATE UNIQUE INDEX uniq_approval_resolved_per_step
  ON task_events (task_id, ((payload->'payload'->>'stepId')))
  NULLS NOT DISTINCT
  WHERE event_type = 'step.approval_resolved';

-- Row Level Security: per-org tenant isolation (canonical pattern per 0079/0245).
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_events FORCE ROW LEVEL SECURITY;
CREATE POLICY task_events_org_isolation ON task_events
  USING (organisation_id::text = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
