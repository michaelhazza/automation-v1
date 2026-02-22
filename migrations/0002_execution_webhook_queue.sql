-- Add webhook callback and queue tracking columns to executions table
ALTER TABLE "executions"
  ADD COLUMN "return_webhook_url" text,
  ADD COLUMN "outbound_payload" jsonb,
  ADD COLUMN "callback_received_at" timestamp,
  ADD COLUMN "callback_payload" jsonb,
  ADD COLUMN "queued_at" timestamp;
