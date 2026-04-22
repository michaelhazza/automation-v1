-- Migration 0192 — Live Agent Execution Log (Phase 1)
--
-- Spec: tasks/live-agent-execution-log-spec.md §5.1, §5.6, §5.7.
--
-- Creates three new per-run tables for the Live Agent Execution Log surface:
--
--   1. agent_execution_events — durable typed timeline of material agent
--      decisions (prompt assembly, memory retrieval, rule evaluation, skill
--      invocation, LLM call start/complete, handoff, etc.). Keyed by
--      (run_id, sequence_number) UNIQUE. Sequence allocation is atomic
--      against agent_runs.next_event_seq — no MAX scan.
--
--   2. agent_run_prompts — the fully-assembled system+user prompt for each
--      run assembly (run start + each handoff + each re-assembly). Closes
--      the biggest audit gap — systemPromptTokens (count, not content) was
--      the only prior trace.
--
--   3. agent_run_llm_payloads — full request+response payload per LLM
--      ledger row. Keyed by llm_request_id (1:1 with llm_requests). Hard
--      size cap enforced at write time; fields truncated greatest-first
--      with modifications recorded. TOAST compresses the rest.
--
-- Also adds two columns to the existing agent_runs table:
--
--   - next_event_seq integer NOT NULL DEFAULT 0
--       Atomic per-run sequence counter for agent_execution_events.
--       Allocation: `UPDATE agent_runs SET next_event_seq = next_event_seq + 1
--                    WHERE id = $runId AND next_event_seq < $cap
--                    RETURNING next_event_seq`.
--       Empty RETURNING = run hit AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN.
--
--   - event_limit_reached_emitted boolean NOT NULL DEFAULT false
--       One-shot flag gating the exactly-once `run.event_limit_reached`
--       signal event. Atomic claim pattern — see spec §4.1.
--
-- RLS: three-layer fail-closed isolation. All three tables enable + FORCE
-- row level security, mirror the llm_requests policy shape (app.organisation_id
-- session variable). All three are added to server/config/rlsProtectedTables.ts
-- in the same commit; verify-rls-coverage.sh catches drift.
--
-- Backfill: both new agent_runs columns default to 0 / false. Existing runs
-- are terminal per TERMINAL_RUN_STATUSES by the time this migration lands
-- on their row — they never allocate new event sequence numbers, so the
-- zero defaults are safe.

BEGIN;

-- ── agent_runs — add sequence-allocation + cap-signal columns ──────────────

ALTER TABLE agent_runs
  ADD COLUMN next_event_seq              integer NOT NULL DEFAULT 0,
  ADD COLUMN event_limit_reached_emitted boolean NOT NULL DEFAULT false;

-- ── agent_execution_events ─────────────────────────────────────────────────

CREATE TABLE agent_execution_events (
  id                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                       uuid         NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  organisation_id              uuid         NOT NULL REFERENCES organisations(id),
  subaccount_id                uuid         REFERENCES subaccounts(id),
  sequence_number              integer      NOT NULL,
  event_type                   text         NOT NULL,
  event_timestamp              timestamptz  NOT NULL DEFAULT now(),
  duration_since_run_start_ms  integer      NOT NULL,
  source_service               text         NOT NULL,
  payload                      jsonb        NOT NULL,
  linked_entity_type           text,
  linked_entity_id             uuid,
  created_at                   timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (run_id, sequence_number),

  -- Null-together invariant: the linked-entity type and id are always
  -- populated together or both null. The service layer also enforces
  -- this via validateLinkedEntity(); the DB constraint is the last-
  -- resort safety net for any future write path that bypasses the
  -- service. Spec §5.1.
  CONSTRAINT agent_execution_events_linked_entity_null_together CHECK (
    (linked_entity_type IS NULL AND linked_entity_id IS NULL)
    OR
    (linked_entity_type IS NOT NULL AND linked_entity_id IS NOT NULL)
  )
);

CREATE INDEX agent_execution_events_run_seq_idx
  ON agent_execution_events (run_id, sequence_number);

CREATE INDEX agent_execution_events_org_created_idx
  ON agent_execution_events (organisation_id, created_at DESC);

CREATE INDEX agent_execution_events_linked_entity_idx
  ON agent_execution_events (linked_entity_type, linked_entity_id)
  WHERE linked_entity_type IS NOT NULL;

ALTER TABLE agent_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_events FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_execution_events_org_isolation ON agent_execution_events;
CREATE POLICY agent_execution_events_org_isolation ON agent_execution_events
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

-- ── agent_run_prompts ──────────────────────────────────────────────────────

CREATE TABLE agent_run_prompts (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid         NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  assembly_number    integer      NOT NULL,
  organisation_id    uuid         NOT NULL REFERENCES organisations(id),
  subaccount_id      uuid         REFERENCES subaccounts(id),
  assembled_at       timestamptz  NOT NULL DEFAULT now(),
  system_prompt      text         NOT NULL,
  user_prompt        text         NOT NULL,
  tool_definitions   jsonb        NOT NULL,
  layer_attributions jsonb        NOT NULL,
  total_tokens       integer      NOT NULL,

  UNIQUE (run_id, assembly_number)
);

CREATE INDEX agent_run_prompts_run_assembly_idx
  ON agent_run_prompts (run_id, assembly_number);

CREATE INDEX agent_run_prompts_org_assembled_idx
  ON agent_run_prompts (organisation_id, assembled_at DESC);

ALTER TABLE agent_run_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_prompts FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_prompts_org_isolation ON agent_run_prompts;
CREATE POLICY agent_run_prompts_org_isolation ON agent_run_prompts
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

-- ── agent_run_llm_payloads ─────────────────────────────────────────────────

CREATE TABLE agent_run_llm_payloads (
  llm_request_id    uuid         PRIMARY KEY REFERENCES llm_requests(id) ON DELETE CASCADE,
  -- Denormalised run_id for cheap per-run filtering + debugging. Nullable
  -- because non-agent LLM callers (skill-analyzer, configuration
  -- assistant) produce payload rows that are not tied to an agent run.
  -- When present, the FK enforces referential integrity against agent_runs.
  -- The route guard in /api/agent-runs/:runId/llm-payloads/:llmRequestId
  -- cross-checks payload.organisation_id against the run; the run_id
  -- column lets a future revision replace that check with a direct
  -- equality test + makes per-run forensic queries a single-column scan.
  run_id            uuid         REFERENCES agent_runs(id) ON DELETE CASCADE,
  organisation_id   uuid         NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid         REFERENCES subaccounts(id),
  system_prompt     text         NOT NULL,
  messages          jsonb        NOT NULL,
  tool_definitions  jsonb        NOT NULL,
  response          jsonb        NOT NULL,
  redacted_fields   jsonb        NOT NULL DEFAULT '[]'::jsonb,
  modifications     jsonb        NOT NULL DEFAULT '[]'::jsonb,
  total_size_bytes  integer      NOT NULL,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX agent_run_llm_payloads_org_created_idx
  ON agent_run_llm_payloads (organisation_id, created_at DESC);

CREATE INDEX agent_run_llm_payloads_run_id_idx
  ON agent_run_llm_payloads (run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE agent_run_llm_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_llm_payloads FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_llm_payloads_org_isolation ON agent_run_llm_payloads;
CREATE POLICY agent_run_llm_payloads_org_isolation ON agent_run_llm_payloads
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

COMMIT;
