-- Add idempotency key to agent_runs for deduplication of retried runs
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_idempotency_key_idx" ON "agent_runs" ("idempotency_key");
