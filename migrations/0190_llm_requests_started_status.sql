-- Migration 0190 — `'started'` provisional status on llm_requests
--
-- Deferred-items brief §1 (tasks/llm-inflight-deferred-items-brief.md).
--
-- Adds application-layer support for the `'started'` status — a provisional
-- ledger row written BEFORE providerAdapter.call(). If the DB write of the
-- terminal row fails after the provider returns 200 OK, a retry under the
-- same idempotencyKey sees the provisional row and throws
-- ReconciliationRequiredError instead of re-dispatching to the provider.
-- This closes the partial-external-success window where a DB blip +
-- retry could double-bill at the provider.
--
-- `status` is stored as free text on llm_requests (not as a Postgres
-- enum), so adding a new value is a pure application-layer change.
-- This migration adds a partial index to speed up the sweep job that
-- reaps aged-out provisional rows.
--
-- See tasks/llm-inflight-deferred-items-brief.md §1 for the full design
-- including the retry contract (throw — caller reconciles; never auto-
-- retry inside the router) and the TTL (providerTimeoutMs + 60s).

BEGIN;

-- Partial index on provisional rows only. Keeps the index tiny — the
-- common case (99%+ terminal rows) doesn't pay the index cost. The
-- maintenance:llm-started-row-sweep job uses this to find aged-out
-- rows without scanning the whole table.
CREATE INDEX llm_requests_started_idx
  ON llm_requests (created_at)
  WHERE status = 'started';

COMMIT;
