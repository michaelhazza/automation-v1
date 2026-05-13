-- Migration 0349: Add FK warm_session_id → browser_warm_sessions(id) ON DELETE RESTRICT
-- and unique partial index for idle-cost-row idempotency.
--
-- FK action: ON DELETE RESTRICT (not SET NULL). Rationale: browser_warm_sessions rows
-- are never deleted (state-transition only). RESTRICT surfaces any accidental DELETE
-- as a constraint violation rather than silently nulling idempotency-bearing data.
--
-- Unique partial index: one idle-cost llm_requests row per warm_session_id.
-- Re-runs of warm-session teardown are no-ops (23505 = already written).
--
-- Spec: tasks/builds/iee-browser-on-e2b/spec.md §10.3, §8.6, §13.1

ALTER TABLE llm_requests
  ADD CONSTRAINT llm_requests_warm_session_id_fk
  FOREIGN KEY (warm_session_id) REFERENCES browser_warm_sessions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX llm_requests_warm_session_id_unique_idx
  ON llm_requests(warm_session_id)
  WHERE subtype = 'warm_pool';
