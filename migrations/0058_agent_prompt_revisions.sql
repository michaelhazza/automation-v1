CREATE TABLE agent_prompt_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  revision_number INTEGER NOT NULL,
  master_prompt TEXT NOT NULL,
  additional_prompt TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  change_description TEXT,
  changed_by UUID REFERENCES users(id),
  changed_by_agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, revision_number)
);

CREATE INDEX agent_prompt_rev_agent_idx ON agent_prompt_revisions(agent_id);
CREATE INDEX agent_prompt_rev_created_idx ON agent_prompt_revisions(agent_id, created_at DESC);
