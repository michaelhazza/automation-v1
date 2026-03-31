-- =============================================================================
-- 0031_blob_extraction.sql
-- H-5: Move large blob columns out of high-volume hot tables.
--
-- agent_run_snapshots  ← systemPromptSnapshot + toolCallsLog (from agent_runs)
-- execution_payloads   ← processSnapshot + outboundPayload + callbackPayload
--                        (from executions)
--
-- These columns are written once per run/execution and only read for detail
-- views. Keeping them inline causes TOAST bloat that degrades index and
-- sequential scan performance on the hot tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- New table: agent_run_snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "agent_run_snapshots" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id"                 uuid NOT NULL
                             REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "system_prompt_snapshot" text,
  "tool_calls_log"         jsonb,
  "created_at"             timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "agent_run_snapshots_run_id_idx"
  ON "agent_run_snapshots" ("run_id");

-- ---------------------------------------------------------------------------
-- New table: execution_payloads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "execution_payloads" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id"     uuid NOT NULL
                       REFERENCES "executions"("id") ON DELETE CASCADE,
  "process_snapshot" jsonb,
  "outbound_payload" jsonb,
  "callback_payload" jsonb,
  "created_at"       timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "execution_payloads_execution_id_idx"
  ON "execution_payloads" ("execution_id");

-- ---------------------------------------------------------------------------
-- Migrate existing data from hot tables into the new tables
-- ---------------------------------------------------------------------------
INSERT INTO "agent_run_snapshots" ("run_id", "system_prompt_snapshot", "tool_calls_log")
  SELECT "id", "system_prompt_snapshot", "tool_calls_log"
  FROM   "agent_runs"
  WHERE  "system_prompt_snapshot" IS NOT NULL
     OR  "tool_calls_log"         IS NOT NULL
ON CONFLICT ("run_id") DO NOTHING;

INSERT INTO "execution_payloads" ("execution_id", "process_snapshot", "outbound_payload", "callback_payload")
  SELECT "id", "process_snapshot", "outbound_payload", "callback_payload"
  FROM   "executions"
  WHERE  "process_snapshot"  IS NOT NULL
     OR  "outbound_payload"  IS NOT NULL
     OR  "callback_payload"  IS NOT NULL
ON CONFLICT ("execution_id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Drop blob columns from hot tables
-- ---------------------------------------------------------------------------
ALTER TABLE "agent_runs"
  DROP COLUMN IF EXISTS "system_prompt_snapshot",
  DROP COLUMN IF EXISTS "tool_calls_log";

ALTER TABLE "executions"
  DROP COLUMN IF EXISTS "process_snapshot",
  DROP COLUMN IF EXISTS "outbound_payload",
  DROP COLUMN IF EXISTS "callback_payload";
