-- Agent Beliefs — discrete, agent-maintained facts per agent-subaccount.
-- Phase 1: confidence-scored, individually addressable, supersession-ready.
-- Spec: docs/beliefs-spec.md

CREATE TABLE agent_beliefs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id   UUID NOT NULL REFERENCES subaccounts(id),
  agent_id        UUID NOT NULL REFERENCES agents(id),

  -- Belief content
  belief_key      TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  subject         TEXT,
  value           TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0.7,

  -- Provenance
  source_run_id      UUID,
  evidence_count     INTEGER NOT NULL DEFAULT 1,
  source             TEXT NOT NULL DEFAULT 'agent',
  confidence_reason  TEXT,
  last_reinforced_at TIMESTAMPTZ,

  -- Supersession (Phase 2 — nullable in Phase 1)
  superseded_by   UUID REFERENCES agent_beliefs(id),
  superseded_at   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- One active belief per key per agent-subaccount
CREATE UNIQUE INDEX agent_beliefs_active_key_uniq
  ON agent_beliefs (organisation_id, subaccount_id, agent_id, belief_key)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

-- Fast lookups for prompt injection
CREATE INDEX agent_beliefs_active_lookup
  ON agent_beliefs (organisation_id, subaccount_id, agent_id)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

-- RLS: tenant isolation (matches agent_briefings pattern)
ALTER TABLE agent_beliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_beliefs FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_beliefs_org_isolation ON agent_beliefs
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
