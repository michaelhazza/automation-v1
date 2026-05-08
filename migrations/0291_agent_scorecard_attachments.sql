-- 0291_agent_scorecard_attachments.sql
-- Trust & Verification Layer — Chunk 6, spec §6.4, §7
--
-- Creates agent_scorecard_attachments: many-to-many join of agents and
-- scorecards with authority level and grading frequency.
-- Tenant-isolated via canonical org-isolation RLS policy.

CREATE TABLE IF NOT EXISTS agent_scorecard_attachments (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id  uuid        NOT NULL REFERENCES organisations (id),
  agent_id         uuid        NOT NULL REFERENCES agents (id),
  scorecard_id     uuid        NOT NULL REFERENCES scorecards (id),
  attach_authority text        NOT NULL
    CONSTRAINT agent_scorecard_attachments_authority_check
      CHECK (attach_authority IN ('system_mandatory', 'org_mandatory', 'suggested')),
  grading_frequency text       NOT NULL DEFAULT 'q1'
    CONSTRAINT agent_scorecard_attachments_frequency_check
      CHECK (grading_frequency IN ('off', 'q1', 'q2', 'q3')),
  attached_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_scorecard_attachments_agent_scorecard_uniq
    UNIQUE (agent_id, scorecard_id)
);

CREATE INDEX agent_scorecard_attachments_org_idx
  ON agent_scorecard_attachments (organisation_id);
CREATE INDEX agent_scorecard_attachments_agent_idx
  ON agent_scorecard_attachments (agent_id);
CREATE INDEX agent_scorecard_attachments_scorecard_idx
  ON agent_scorecard_attachments (scorecard_id);

-- RLS — canonical org-isolation policy (matches 0079 template)
ALTER TABLE agent_scorecard_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_scorecard_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_scorecard_attachments_org_isolation ON agent_scorecard_attachments;
CREATE POLICY agent_scorecard_attachments_org_isolation ON agent_scorecard_attachments
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
