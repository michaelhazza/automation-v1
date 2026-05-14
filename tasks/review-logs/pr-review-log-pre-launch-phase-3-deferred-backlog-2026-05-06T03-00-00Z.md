# PR Review Log — pre-launch-phase-3-deferred-backlog
**Date:** 2026-05-06T03:00:00Z
**Branch:** claude/pre-launch-phase-3
**Reviewer:** pr-reviewer (read-only)
**Verdict:** CHANGES_REQUESTED — 4 blocking, 2 strong, 0 directional

---

## Blocking Issues

### B-1 — GHL pagination job INSERT bypasses FORCE RLS
**File:** `server/jobs/ghlAutoEnrolLocationsPageJob.ts` step 9 (line ~256)
**Finding:** The per-location `db.execute(sql\`INSERT INTO subaccounts...\`)` runs on the module-level pool connection with no `app.organisation_id` GUC set. `subaccounts` has FORCE RLS; every INSERT is silently rejected by the WITH CHECK clause. The job emits progress/completion events while writing ZERO rows.
**Fix required:** Wrap each INSERT in `db.transaction(async (tx) => { await setOrgGUC(tx, organisationId); await tx.execute(sql\`INSERT...\`); })`. The `setOrgGUC` helper from `server/lib/orgScoping.ts` is the correct primitive.
**Status:** FIXED in fix pass.

### B-2 — Inline and webhook paths omit `external_id_namespace`
**Files:** `server/services/ghlAgencyOauthService.ts` (`autoEnrolAgencyLocations`), `server/services/ghlWebhookMutationsService.ts` (`location_create` branch)
**Finding:** Both INSERT paths do not write `external_id_namespace = 'ghl_location'`. Migration 0285 creates a partial unique index `WHERE external_id_namespace = 'ghl_location'` to enforce idempotency — without this value, the index is never consulted. Additionally, both paths still reference the old ON CONFLICT target `(connector_config_id, external_id)` rather than the new `(organisation_id, external_id)` partial index.
**Fix required:** Add `external_id_namespace = 'ghl_location'` to both INSERT VALUES lists; update ON CONFLICT target to match the new partial index.
**Status:** FIXED in fix pass.

### B-3 — Migration backfill safety check too broad
**File:** `migrations/0285_subaccounts_external_id_namespace.sql`
**Finding:** The `RAISE EXCEPTION` check fires for any row with `external_id IS NOT NULL AND external_id_namespace IS NULL` — this includes manually-created subaccounts, subaccounts from disconnected connectors, and future non-GHL providers. On any staging or production database with such rows, the migration will fail to run and block deployment.
**Fix required:** Scope the check to GHL-linked rows only by adding `AND connector_config_id IN (SELECT id FROM connector_configs WHERE connector_type = 'ghl')`, or downgrade to `RAISE NOTICE`.
**Status:** FIXED in fix pass (scoped to GHL rows).

### B-4 — OAuth state audit events have null userAgent/ip
**Files:** `server/routes/ghl.ts`, `server/routes/oauthIntegrations.ts`
**Finding:** `setGhlOAuthState(nonce, orgId, pendingRunId)` and `consumeGhlOAuthState(state)` are called without the trailing `context` argument. All four lifecycle audit events (`stateIssued`, `stateConsumed`, `stateExpired`, `stateNotFound`) write null `userAgent` and null `ip` — defeating the observability value of those events.
**Fix required:** Pass `{ userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null }` as the trailing `context` argument to both calls.
**Status:** FIXED in fix pass.

---

## Strong Findings

### S-1 — Test defines `decideTokenRefreshAssertion` inline rather than importing production function
**File:** `server/services/__tests__/connectionTokenServiceAssertionsPure.test.ts`
**Finding:** The test defines the assertion logic inline rather than importing the production function. Any change to the production function signature or behavior will not be caught by this test — the test always passes because it tests its own copy.
**Status:** DIRECTIONAL — deferred to `tasks/todo.md`.

### S-4 — `setSystemWorkerContext(true)` not called in in-memory queue fallback
**File:** `server/services/queueService.ts`
**Finding:** `setSystemWorkerContext(true)` is called at pg-boss bootstrap but the in-memory queue fallback path never calls it. Workers registered on the in-memory queue will throw `MISSING_PRINCIPAL_CONTEXT` on any operation that checks `isSystemWorkerContext()`.
**Status:** DIRECTIONAL — deferred to `tasks/todo.md`.

---

## Summary

All four blocking issues (B-1 through B-4) addressed in the fix pass. Typecheck and lint confirm zero errors after fixes. Re-run pr-reviewer on the fixed files before marking the review pass complete.
