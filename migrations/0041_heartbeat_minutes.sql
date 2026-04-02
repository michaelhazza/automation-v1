-- Add minute-level precision to heartbeat start time across all agent tables
ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_offset_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subaccount_agents ADD COLUMN IF NOT EXISTS heartbeat_offset_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS heartbeat_offset_minutes INTEGER NOT NULL DEFAULT 0;
