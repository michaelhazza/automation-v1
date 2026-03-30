-- Add multi-agent assignment to tasks
-- assignedAgentIds stores the full list of agents working this task.
-- assignedAgentId remains as the primary/lead agent for backward-compat FK joins.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: any task with an existing single agent gets that agent in the array
UPDATE tasks
SET assigned_agent_ids = jsonb_build_array(assigned_agent_id::text)
WHERE assigned_agent_id IS NOT NULL
  AND (assigned_agent_ids IS NULL OR assigned_agent_ids = '[]'::jsonb);
