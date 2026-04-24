# PR Review Log — ClientPulse Session 2

**Branch:** `claude/clientpulse-session-2-arch-gzYlZ`
**Diff range:** `170f560^..HEAD` (13 commits)
**Files reviewed:** ~30 (routes, services, adapters, client pages, migrations, tests)
**Reviewer:** pr-reviewer agent
**Timestamp:** 2026-04-20T07:26:18Z

---

## Table of Contents

- [Scope & Signals](#scope--signals)
- [Blocking Issues](#blocking-issues)
  - [B-1 — Missing `organisationId` filter on `clientPulseSignalObservations`](#b-1--missing-organisationid-filter-on-clientpulsesignalobservations-in-drilldownservicegetsignals)
  - [B-2 — Missing permission guard on propose / intervention-context](#b-2--missing-permission-guard-on-post-interventionspropose-and-get-intervention-context)
  - [B-3 — `resolveGhlContext` ignores `organisationId`](#b-3--resolveghlcontext-accepts-organisationid-but-never-uses-it-in-the-db-query)
  - [B-4 — S2-D.4 integration test absent](#b-4--ship-gate-s2-d4-integration-test-absent-from-codebase)
- [Strong Recommendations](#strong-recommendations)
  - [H-1 — Dead `pickRecommendedActionType`](#h-1--dead-function-pickrecommendedactiontype-introduced-as-dead-code-by-session-2)
  - [H-2 — `createOrganisationFromTemplate` bypasses `recordHistory`](#h-2--createorganisationfromtemplate-bypasses-confighistoryservicerecordhistory)
  - [H-3 — in-app channel reports `delivered` without delivering](#h-3--notify_operator-in-app-channel-reports-delivered-without-writing-any-notification)
  - [H-4 — apiAdapter has no token expiry check](#h-4--apiadapter-reads-accesstoken-directly-without-token-expiry-check)
  - [H-5 — Missing test for `createOrganisationFromTemplate`](#h-5--missing-test-for-createorganisationfromtemplate-s2-d1-acceptance-gap)
- [Non-Blocking Improvements](#non-blocking-improvements)
- [Verdict](#verdict)

---

## Scope & Signals

- 13 commits reviewed covering B.1 (apiAdapter real GHL dispatch), B.2 (live-data pickers), B.3 (drilldown page + routes), C.1 (notify_operator fan-out), C.2 (outcome-weighted recommendation), C.3 (typed InterventionTemplatesEditor), C.4 (dual-path UX), D.1 (createFromTemplate minimal), D.2 (9 typed Settings editors), D.4 (recordHistory refactor).
- All new async route handlers use `asyncHandler` — no manual try/catch found in routes.
- All drilldown routes call `resolveSubaccount` before service calls.
- Migration 0185 (`actions.replay_of_action_id`) is additive and rollback-safe.
- No raw SQL schema changes outside migration files.
- No `as any` or `@ts-ignore` in new Session 2 code.
- Pure test files present: `apiAdapterClassifierPure.test.ts` (10), `recommendedInterventionPure.test.ts` (8), `drilldownOutcomeBadgePure.test.ts` (11), `notifyOperatorFanoutServicePure.test.ts` (8).
- `ClientPulseDrilldownPage` and `ClientPulseSettingsPage` both registered via `lazy()` in `App.tsx`.

## Blocking Issues

### B-1 — Missing `organisationId` filter on `clientPulseSignalObservations` in `drilldownService.getSignals`

**File:** `server/services/drilldownService.ts:124-136`

The query on `clientPulseSignalObservations` applies only `subaccountId` and `signalSlug` filters. The table has an `organisationId` column (`server/db/schema/clientPulseCanonicalTables.ts:307`). Per the architecture rule "all queries filter by `organisationId`", this is a missing org-scope predicate. The practical exploit path is blocked by `resolveSubaccount` at the route layer, but the architecture rule exists as a defence-in-depth invariant against future route changes that forget the prior guard.

**Fix:** Add `eq(clientPulseSignalObservations.organisationId, params.organisationId)` to the `and(...)` block at line 129.

---

### B-2 — Missing permission guard on `POST /interventions/propose` and `GET /intervention-context`

**File:** `server/routes/clientpulseInterventions.ts:18-31` (GET context), `server/routes/clientpulseInterventions.ts:59-90` (POST propose)

Both routes carry only `authenticate`. All five CRM picker routes on the same file carry `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`. The propose endpoint enqueues an `actions` row with `gateLevel='review'` — any authenticated user, including read-only portal users, can currently trigger an intervention proposal that enters the operator review queue.

Architecture rule: "auth middleware — `authenticate` always first, then permission guards as needed." A write operation advancing the intervention pipeline is clearly a case where a permission guard is needed.

**Fix:** Add `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)` to the propose POST (write action). Add `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` to the intervention-context GET (in line with all drilldown routes that already carry this guard).

---

### B-3 — `resolveGhlContext` accepts `organisationId` but never uses it in the DB query

**File:** `server/services/adapters/ghlReadHelpers.ts:31-57`

The function signature includes `organisationId: string` but the DB query on `integrationConnections` filters only by `subaccountId`, `providerType`, and `connectionStatus` (lines 38-44). The `organisationId` parameter is silently dropped. Since `integrationConnections` has an `organisationId` column, callers passing `orgId` with the reasonable assumption that the query is org-scoped are incorrect.

The current runtime defence is `resolveSubaccount` validation in every route that calls into this function. But the function's own contract is broken: a caller that forgets `resolveSubaccount` (or passes an attacker-controlled `subaccountId`) could reach credentials for a different org's GHL connection.

**Fix:** Add `eq(integrationConnections.organisationId, params.organisationId)` to the WHERE clause at line 39.

---

### B-4 — Ship gate S2-D.4 integration test absent from codebase

**Files:** (absent) `server/routes/__tests__/organisationConfig.test.ts`

Spec §1.1 gate S2-D.4: "`server/routes/__tests__/organisationConfig.test.ts` integration test lands (the 8-case matrix described in Session 1 plan §5.2)". Progress.md marks D.4 as "partial" and acknowledges the test as deferred "pending DB-fixture layer". However the gate was listed as a ship gate, not a deferred item, and the `recordHistory` version-return half of the gate (which did ship) is not independently verifiable without the integration test.

**Fix:** Either land the 8-case integration test for `POST /api/organisation/config/apply` covering the matrix (non-sensitive commit, sensitive enqueue, schema reject, drift detect, org-not-found, invalid path, etc.), or re-classify S2-D.4 explicitly as deferred in the spec and progress.md with a named owner and target session.

## Strong Recommendations

### H-1 — Dead function `pickRecommendedActionType` introduced as dead code by Session 2

**File:** `server/services/clientPulseInterventionContextService.ts:260-279`

Session 2 C.2 replaced the priority-only recommendation path with `pickRecommendedTemplate`. The old `pickRecommendedActionType` function (lines 260-279) is now unreferenced. Per CLAUDE.md §6: "Remove imports/variables/functions that YOUR changes made unused." This was not removed.

**Fix:** Delete lines 260-279.

---

### H-2 — `createOrganisationFromTemplate` bypasses `configHistoryService.recordHistory`

**File:** `server/services/organisationService.ts:277-285`

The direct `db.insert(configHistory).values({ version: 1, ... })` bypasses the service method. Consequences: `changedBy` is absent from the row (not set, will be NULL), sensitive-field stripping is not applied (no risk here since `snapshot: {}`, but the bypass is structural), and if `createOrganisationFromTemplate` were ever called twice for the same org the direct insert would produce a confusing unique-constraint violation rather than the service method's graceful version increment.

**Fix:** Replace with `await configHistoryService.recordHistory({ entityType: 'organisation_operational_config', entityId: organisationId, organisationId, snapshot: {}, changedBy: null, changeSource: 'system_sync', changeSummary: ... })` — the service will handle version derivation.

---

### H-3 — `notify_operator` in-app channel reports `delivered` without writing any notification

**File:** `server/services/notifyOperatorChannels/inAppChannel.ts:12-26`

`deliverInApp` returns `{ status: 'delivered', recipientCount: params.recipientUserIds.length }` unconditionally. No notification record is written, no WebSocket event is emitted. The audit row in `actions.metadata_json.fanoutResults` will show `in_app: delivered (N recipients)` but those N users received nothing beyond the pre-existing review-queue row. This creates a misleading audit trail.

Given/When/Then for missing test:
- **Given** an org with 2 users and a pending `notify_operator` action
- **When** `fanoutOperatorAlert` is called with `channels: ['in_app']`
- **Then** the returned result contains `{ channel: 'in_app', status: 'delivered', recipientCount: 2 }` AND (with real delivery) each recipient has received a queryable notification record

**Fix (minimum):** Change the in-app return to `status: 'skipped_not_configured'` with an honest `errorMessage` noting the audit-trail semantics, until a real notification delivery mechanism is implemented.

---

### H-4 — `apiAdapter` reads `accessToken` directly without token expiry check

**File:** `server/services/adapters/apiAdapter.ts:247`

This is the first session where real GHL calls cross the wire. The adapter reads `typedConnection.accessToken` from the DB row without checking `tokenExpiresAt`. An expired-but-not-yet-refreshed token will produce repeated `terminal_failure: AUTH` responses. The failure is visible (not silent), but pilot operators will see cryptic auth failures before understanding the root cause is token staleness.

Progress.md acknowledges this as "OAuth refresh-on-expire for apiAdapter deferred to Session 3."

Given the pilot launch scope, this should either land a defensive log-warning when `tokenExpiresAt < now + 5min`, or Session 3 must close this before any pilot org's GHL token expires.

---

### H-5 — Missing test for `createOrganisationFromTemplate` (S2-D.1 acceptance gap)

**File:** `server/services/organisationService.ts:246-288`

Spec gate S2-D.1 requires "Service integration test + manual smoke". No test file exists for this function. The core behaviour (stamps `appliedSystemTemplateId`, writes config_history creation-event) should be verified.

**Given/When/Then:**
- **Given** a valid `systemTemplateId` exists in `system_hierarchy_templates`
- **When** `createOrganisationFromTemplate({ name, slug, plan, ..., systemTemplateId })` is called
- **Then** the returned `organisationId` maps to an `organisations` row with `applied_system_template_id = systemTemplateId`, AND a `config_history` row exists with `entity_type = 'organisation_operational_config'`, `version = 1`, `change_source = 'system_sync'`

## Non-Blocking Improvements

### N-1 — Priority convention inversion at `clientPulseInterventionContextService.ts:174` is undocumented

`priority: -(t.priority ?? 0)` negates the data-model priority before passing it to `pickRecommendedTemplate`. This is correct (higher config priority → lower sort key → sorts first in the pure function's ascending sort), but the inversion is invisible to the next reader. A single-line comment explaining the inversion would prevent future bugs.

---

### N-2 — `apiAdapterClassifierPure.ts` maps all non-HTTP errors to `network_timeout`

**File:** `server/services/adapters/apiAdapterClassifierPure.ts:20-21`

DNS failures, TCP resets, and connection-refused errors all return `reason: 'network_timeout'` even though they are not timeouts. Spec §2.3 specifically uses `'network_timeout'` for this bucket, so changing it is a spec deviation — flagging for a future spec amendment.

---

### N-3 — `crmLiveDataService` in-memory cache has no max-size cap

**File:** `server/services/crmLiveDataService.ts:22-39`

Entries evict only on read when past TTL. At pilot scale this is negligible; a simple max-size guard (e.g. 500 entries) provides a safety cap at near-zero cost.

---

### N-4 — `BlockCard.save` callback triplicated in `ClientPulseSettingsPage`

**File:** `client/src/pages/ClientPulseSettingsPage.tsx:186-221, 264-287, 289-310`

`api.post('/api/organisation/config/apply', ...)` + toast + `setEditing(false)` + `onSaved()` repeated in three branches. Extracting to a shared helper would remove ~60 lines of duplication.

---

### N-5 — `ConfigUpdateToolResult` dual-path UX wire-up deferred without explicit timeline

Component and parser shipped with B6, but `ConfigAssistantPage`'s message pipeline filters `tool_result` messages entirely. Affordance invisible to end-users until D.3 panel extraction lands. Flagging so Session 3 explicitly gates on this wire-up.

---

## Verdict

**Blockers present** — B-1 (missing org-scope filter), B-2 (missing permission guards on intervention routes), B-3 (resolveGhlContext ignores orgId in query), B-4 (S2-D.4 integration test absent). All four must be resolved before marking this PR ready.
