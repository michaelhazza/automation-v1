-- Migration 0187 — new llm_requests.status values (application-level)
--
-- `status` is stored as free text on `llm_requests`, not as a Postgres enum,
-- so no DDL is required. The new values are enforced at the application
-- layer via server/db/schema/llmRequests.ts (LLM_REQUEST_STATUSES constant)
-- and the callers that write them (router + adapter error mapper).
--
-- New values:
--   'client_disconnected'   — mid-body socket RST; we don't know which side
--                             initiated (HTTP 499 or bare fetch network error)
--   'parse_failure'         — 200 OK response but post-processor failed the
--                             caller-supplied schema check after all retries
--   'aborted_by_caller'     — AbortController.abort() fired from caller code
--                             (distinguishes caller-initiated from provider-side
--                             disconnects; abort_reason carries the why)
--
-- This file reserves migration sequence number 0187 so P1 lands as three
-- discrete revertible units (0185 schema, 0186 aggregates, 0187 statuses).

BEGIN;
COMMIT;
