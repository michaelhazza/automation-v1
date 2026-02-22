-- Add notify_on_complete column to executions table
ALTER TABLE "executions"
  ADD COLUMN "notify_on_complete" boolean NOT NULL DEFAULT false;
