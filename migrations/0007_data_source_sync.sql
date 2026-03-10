-- Add sync_mode: 'lazy' (re-fetch on demand when cache expires) or 'proactive' (background polling)
ALTER TABLE "agent_data_sources" ADD COLUMN "sync_mode" text NOT NULL DEFAULT 'lazy';
--> statement-breakpoint
-- Timestamp of the last admin alert email sent for this source (used for 1-hour cooldown)
ALTER TABLE "agent_data_sources" ADD COLUMN "last_alert_sent_at" timestamp;
