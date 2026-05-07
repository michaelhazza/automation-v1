-- Consolidation Build (C1) — schema additions for personality, objectives, and linked agents
-- Migration 0286

-- Add personality JSONB column to agents (stores persona traits, tone, description, enabled flag)
ALTER TABLE agents ADD COLUMN personality jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add objective text column to projects (plain-text mission statement for the project)
ALTER TABLE projects ADD COLUMN objective text;

-- Add linked_agent_ids uuid[] to projects (agents actively working this project)
ALTER TABLE projects ADD COLUMN linked_agent_ids uuid[] NOT NULL DEFAULT '{}';

-- Add migrated_from_goals_at timestamptz to projects (tracks when goal data was migrated)
ALTER TABLE projects ADD COLUMN migrated_from_goals_at timestamptz;

-- GIN index on linked_agent_ids for efficient array-contains lookups
CREATE INDEX projects_linked_agent_ids_gin ON projects USING gin (linked_agent_ids);
