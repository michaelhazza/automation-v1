-- 0379_waitpoints_primitive.sql
-- oss-pattern-lifts-bundle spec §4.1, §4.2, §12.
--
-- Generalised pause/resume primitive. Three kinds:
--   'oauth'          — bound to an agent run; resume_queue required
--   'approval'       — bound via resumePayload; resume_queue must be null
--   'external_event' — unconstrained in V1 (no callers yet)
--
-- Five CHECK constraints enforce per-kind invariants at the storage layer
-- (defence in depth; service-layer validation catches first).
--
-- RLS: ENABLE + FORCE ROW LEVEL SECURITY with org-isolation policy.
-- expireWaitpoints() uses withAdminConnection + SET LOCAL ROLE admin_role
-- to bypass RLS for the cross-org expiry sweep (same pattern as
-- blockedRunExpiryJob.runFn line 51).

CREATE TABLE waitpoints (
  id                text        PRIMARY KEY,
  kind              text        NOT NULL,
  organisation_id   uuid        NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid,
  bound_run_id      uuid        REFERENCES agent_runs(id),
  expires_at        timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',
  resume_queue      text,
  resume_payload    jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,

  CONSTRAINT waitpoints_status_check
    CHECK (status IN ('pending', 'completed', 'expired')),
  CONSTRAINT waitpoints_kind_check
    CHECK (kind IN ('oauth', 'approval', 'external_event')),
  CONSTRAINT waitpoints_oauth_requires_bound_run
    CHECK (kind <> 'oauth' OR bound_run_id IS NOT NULL),
  CONSTRAINT waitpoints_oauth_requires_resume_queue
    CHECK (kind <> 'oauth' OR resume_queue IS NOT NULL),
  CONSTRAINT waitpoints_approval_forbids_resume_queue
    CHECK (kind <> 'approval' OR resume_queue IS NULL)
);

CREATE INDEX waitpoints_org_status_idx ON waitpoints (organisation_id, status);

CREATE INDEX waitpoints_bound_run_idx ON waitpoints (bound_run_id)
  WHERE bound_run_id IS NOT NULL;

ALTER TABLE waitpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY waitpoints_org ON waitpoints USING (organisation_id = current_setting('app.organisation_id')::uuid);
