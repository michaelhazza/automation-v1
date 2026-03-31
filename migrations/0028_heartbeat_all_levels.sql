-- Add heartbeat fields to system_agents (blueprint defaults)
ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS heartbeat_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS heartbeat_interval_hours INTEGER;
ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS heartbeat_offset_hours INTEGER NOT NULL DEFAULT 0;

-- Add heartbeat fields to subaccount_agents (execution-level config, inherits from org agent)
ALTER TABLE subaccount_agents ADD COLUMN IF NOT EXISTS heartbeat_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subaccount_agents ADD COLUMN IF NOT EXISTS heartbeat_interval_hours INTEGER;
ALTER TABLE subaccount_agents ADD COLUMN IF NOT EXISTS heartbeat_offset_hours INTEGER NOT NULL DEFAULT 0;
