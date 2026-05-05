CREATE TABLE security_audit_events (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid          NOT NULL,
  subaccount_id   uuid,
  actor_user_id   uuid,
  actor_role      text,
  event_type      text          NOT NULL,
  target_type     text,
  target_id       text,
  ip              text,
  user_agent      text,
  meta            jsonb         NOT NULL DEFAULT '{}',
  occurred_at     timestamptz   NOT NULL DEFAULT now(),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_audit_org_time   ON security_audit_events (organisation_id, occurred_at DESC);
CREATE INDEX idx_security_audit_event_time ON security_audit_events (event_type, occurred_at DESC);
CREATE INDEX idx_security_audit_actor_time ON security_audit_events (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;

ALTER TABLE security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY security_audit_events_org_isolation ON security_audit_events
  USING (organisation_id::text = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
