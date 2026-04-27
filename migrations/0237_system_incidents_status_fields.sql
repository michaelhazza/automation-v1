-- 0237_system_incidents_status_fields
--
-- Adds two explicit status columns to system_incidents so the UI consumes
-- backend-published state instead of inferring it from indirect signals.
--
-- Rationale (PR #215 ChatGPT review item #5):
--   - The detail drawer (DiagnosisAnnotation.tsx) currently derives
--     "validation failed" from `agentDiagnosis !== null && investigatePrompt === null`,
--     and "in-flight" from `Date.now() - lastTriageAttemptAt < 5 min`. Both are
--     fragile: validation-failure is a guessed semantic, and the time window
--     misrepresents crashed triage jobs / stuck queues as still running.
--
--   - The fix is to publish authoritative status from the producer (the triage
--     handler + writeDiagnosis skill) and have the UI render it directly.
--
-- Columns:
--   triage_status:    'pending' | 'running' | 'failed' | 'completed'
--                     pending  → no triage attempt yet
--                     running  → triage attempt in flight (set when triageHandler
--                                begins the LLM tool loop, cleared on terminal state)
--                     completed→ triage attempt finished successfully
--                     failed   → triage attempt finished with a terminal failure
--
--   diagnosis_status: 'none' | 'valid' | 'partial' | 'invalid'
--                     none    → agent_diagnosis IS NULL
--                     valid   → diagnosis written WITH a validated investigate_prompt
--                     partial → diagnosis written WITHOUT investigate_prompt
--                               (validation failed, or agent omitted it)
--                     invalid → reserved for future write_diagnosis sanity checks
--
-- Defaults are deliberately permissive (`pending` / `none`) so existing rows
-- backfill correctly without touching production data semantics.

ALTER TABLE system_incidents
  ADD COLUMN triage_status text NOT NULL DEFAULT 'pending';

ALTER TABLE system_incidents
  ADD COLUMN diagnosis_status text NOT NULL DEFAULT 'none';

ALTER TABLE system_incidents
  ADD CONSTRAINT system_incidents_triage_status_enum
  CHECK (triage_status IN ('pending', 'running', 'failed', 'completed'));

ALTER TABLE system_incidents
  ADD CONSTRAINT system_incidents_diagnosis_status_enum
  CHECK (diagnosis_status IN ('none', 'valid', 'partial', 'invalid'));

-- Backfill: derive status from existing column values for any rows already in
-- the table. Safe to run on an empty table; idempotent on re-run.

UPDATE system_incidents
SET diagnosis_status = CASE
  WHEN agent_diagnosis IS NOT NULL AND investigate_prompt IS NOT NULL THEN 'valid'
  WHEN agent_diagnosis IS NOT NULL AND investigate_prompt IS NULL     THEN 'partial'
  ELSE 'none'
END
WHERE diagnosis_status = 'none';

UPDATE system_incidents
SET triage_status = CASE
  WHEN agent_diagnosis IS NOT NULL                                    THEN 'completed'
  WHEN triage_attempt_count = 0                                       THEN 'pending'
  ELSE 'failed'  -- attempted ≥1× but no diagnosis landed → treat as terminal failure
END
WHERE triage_status = 'pending';
