-- 0365_agent_execution_events_idempotency_key
--
-- Closes PA-V2-EVENT-IDEMPOTENCY: content-keyed idempotency for
-- agent_execution_events. Before this migration the only dedup mechanism on
-- the events table was the per-run sequence number — which is allocated
-- inside appendEvent, so a crash between sequence allocation and INSERT
-- (or an at-least-once retry) would produce TWO events for the same
-- logical occurrence. The cross-owner timeout sweep papered over this with
-- a stale-claim TTL on delegation_outcomes; the proper fix is a UNIQUE at
-- the DB level keyed on the producer's intent.
--
-- Adds a NULLABLE idempotency_key column. Producers that need idempotency
-- (the cross-owner sweep, future schedulers) pass a content-derived key —
-- e.g. `cross_owner_substep_completed:<substepId>:failed`. Producers that
-- don't care about dedup pass NULL and behave exactly as before.
--
-- The partial UNIQUE index covers (run_id, event_type, idempotency_key) and
-- only applies WHERE idempotency_key IS NOT NULL — so legacy events with
-- NULL keys keep landing without any collision risk.
--
-- Use with ON CONFLICT DO NOTHING in the application code so duplicate
-- writes are silently suppressed (no exception, no row).

ALTER TABLE agent_execution_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS agent_execution_events_idempotency_idx
  ON agent_execution_events (run_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
