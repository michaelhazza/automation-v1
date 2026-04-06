-- Feature 1: Goal Hierarchy System
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  parent_goal_id UUID REFERENCES goals(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  level TEXT NOT NULL DEFAULT 'objective',
  owner_agent_id UUID REFERENCES agents(id),
  target_date TIMESTAMPTZ,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX goals_subaccount_idx ON goals(subaccount_id);
CREATE INDEX goals_org_idx ON goals(organisation_id);
CREATE INDEX goals_parent_idx ON goals(parent_goal_id);
CREATE INDEX goals_subaccount_status_idx ON goals(subaccount_id, status);

-- Add goal_id to tasks
ALTER TABLE tasks ADD COLUMN goal_id UUID REFERENCES goals(id);
CREATE INDEX tasks_goal_idx ON tasks(goal_id);

-- Add goal_id to projects
ALTER TABLE projects ADD COLUMN goal_id UUID REFERENCES goals(id);
CREATE INDEX projects_goal_idx ON projects(goal_id);
