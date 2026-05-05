-- Migration 0191 — llm_inflight_history
--
-- Deferred-items brief §6 (tasks/llm-inflight-deferred-items-brief.md).
-- Durable forensic log of every in-flight registry add/remove event so an
-- operator can answer "what was running at 3:17am last Tuesday" even when
-- the process that handled those calls has restarted.
--
-- Posture:
--   - System-admin-read-only via route-level gating. RLS is NOT forced
--     here; cross-tenant reads are expected (the table is an operations
--     surface, same as llm_requests_archive).
--   - Writes are fire-and-forget from the registry — a DB hiccup must
--     not delay the sub-second socket emit. See
--     server/services/llmInflightRegistry.ts `persistHistoryEvent`.
--   - Retention: short TTL (default 7 days) swept by a pg-boss job.
--     Follow-on brief implementation may adjust.
--
-- The event_payload jsonb column stores the full InFlightEntry (on
-- 'added') or InFlightRemoval (on 'removed'). terminal_status is lifted
-- out of the payload for cheap sampling of aggregate signals
-- (swept_stale / evicted_overflow rates).

BEGIN;

CREATE TABLE IF NOT EXISTS llm_inflight_history (
  id               uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_key      text      NOT NULL,
  idempotency_key  text      NOT NULL,
  organisation_id  uuid,
  subaccount_id    uuid,
  event_kind       text      NOT NULL CHECK (event_kind IN ('added', 'removed')),
  event_payload    jsonb     NOT NULL,
  terminal_status  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_inflight_history_created_at_idx
  ON llm_inflight_history (created_at);

CREATE INDEX IF NOT EXISTS llm_inflight_history_runtime_key_idx
  ON llm_inflight_history (runtime_key);

CREATE INDEX IF NOT EXISTS llm_inflight_history_idempotency_key_idx
  ON llm_inflight_history (idempotency_key);

CREATE INDEX IF NOT EXISTS llm_inflight_history_org_created_at_idx
  ON llm_inflight_history (organisation_id, created_at);

COMMIT;
