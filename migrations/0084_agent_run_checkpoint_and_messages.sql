-- 0084_agent_run_checkpoint_and_messages.sql
--
-- Sprint 3 — P2.1 Sprint 3A append-only message log + checkpoint column
-- + per-org run-retention override.
--
-- Three changes that ship as a single atomic migration:
--
--   1. Create `agent_run_messages` — the new authoritative per-run
--      message log. The existing in-memory `messages[]` array inside
--      `runAgenticLoop` is mirrored to this table after every LLM
--      response and every tool-result batch. Sprint 3A does not remove
--      or refactor the in-memory array; it only adds the write-side
--      mirror so the Sprint 3B resume-read path has something to load
--      from. RLS policy is identical to the 0079–0083 shape.
--
--   2. Add `agent_run_snapshots.checkpoint jsonb` — structured
--      per-iteration checkpoint payload (see
--      `server/services/middleware/types.ts` → `AgentRunCheckpoint`).
--      Null until the agent writes the first checkpoint. The existing
--      `tool_calls_log` column is kept as a derived projection.
--
--   3. Add `organisations.run_retention_days integer` — per-org
--      override for the global `DEFAULT_RUN_RETENTION_DAYS`
--      (90 days) consumed by the Sprint 3A agent-run-cleanup cron.
--      NULL falls back to the default.
--
-- Contract: docs/improvements-roadmap-spec.md §P2.1 (3A).
-- RLS shape mirrors migration 0083_regression_cases.sql exactly.

-- ---------------------------------------------------------------------------
-- agent_run_messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_run_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,

  -- Monotonic per-run sequence number. Combined with run_id this is the
  -- logical primary key for ordering; the surrogate id is kept for
  -- foreign-key hygiene. The unique index below enforces uniqueness.
  sequence_number integer NOT NULL,

  -- Conversation role mirrored from the in-memory array:
  --   'assistant' — LLM response (may contain tool_use blocks)
  --   'user'      — tool results batch OR human input
  --   'system'    — system prompt (rarely mirrored; kept for future)
  role text NOT NULL,

  -- The content block(s) for this message. Stored as jsonb so a single
  -- assistant message can carry multiple tool_use blocks, and a single
  -- user message can carry multiple tool_result blocks. Shape matches
  -- the provider-neutral `{ type, text | tool_use | tool_result }`
  -- block used by the existing llmService adapters.
  content jsonb NOT NULL,

  -- When the message carries exactly one tool_use or tool_result block,
  -- mirror the tool_call_id at the top level for fast lookup by the
  -- Sprint 3B projection service. NULL for plain text messages.
  tool_call_id text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_run_messages_role_check
    CHECK (role IN ('assistant', 'user', 'system')),
  CONSTRAINT agent_run_messages_sequence_number_non_negative
    CHECK (sequence_number >= 0)
);

-- Uniqueness — the (run_id, sequence_number) tuple is the logical key.
-- The unique index also doubles as the "order by sequence" lookup the
-- resume path uses via `streamMessages(runId, fromSequence)`.
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_messages_run_seq_unique
  ON agent_run_messages (run_id, sequence_number);

CREATE INDEX IF NOT EXISTS agent_run_messages_org_idx
  ON agent_run_messages (organisation_id);

CREATE INDEX IF NOT EXISTS agent_run_messages_tool_call_idx
  ON agent_run_messages (run_id, tool_call_id)
  WHERE tool_call_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row Level Security — Sprint 2 P1.1 Layer 1 policy shape (see 0079).
-- Per-run messages contain the full LLM conversation transcript; a
-- leak would expose every prompt, tool input, and tool output from the
-- other org's agent runs.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_run_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_messages_org_isolation ON agent_run_messages;
CREATE POLICY agent_run_messages_org_isolation ON agent_run_messages
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- agent_run_snapshots.checkpoint — structured per-iteration checkpoint.
-- Nullable because existing rows have no checkpoint and Sprint 3A writes
-- it lazily (only after the first iteration completes).
-- ---------------------------------------------------------------------------

ALTER TABLE agent_run_snapshots
  ADD COLUMN IF NOT EXISTS checkpoint jsonb;

-- ---------------------------------------------------------------------------
-- organisations.run_retention_days — per-org override for the cleanup
-- cron retention window. NULL = use DEFAULT_RUN_RETENTION_DAYS from
-- server/config/limits.ts (90 days).
-- ---------------------------------------------------------------------------

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS run_retention_days integer;
