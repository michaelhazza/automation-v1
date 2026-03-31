-- Add project_id FK to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
