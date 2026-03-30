-- Add heartbeat scheduling fields to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_interval_hours integer;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS heartbeat_offset_hours integer NOT NULL DEFAULT 0;
