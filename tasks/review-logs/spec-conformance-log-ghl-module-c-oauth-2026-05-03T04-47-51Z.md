# Spec Conformance Log

**Spec:** `docs/ghl-module-c-oauth-spec.md`
**Spec commit at check:** `0e00a666` (HEAD of `ghl-agency-oauth`)
**Branch:** `ghl-agency-oauth`
**Base:** `a460af16` (merge-base with `main`)
**Scope:** Phases 1-5 (code-shippable). Phase 0 (manual dev-portal config) and Phase 6 (real-agency verification) are operational, not code, and are OUT_OF_SCOPE.
**Changed-code set:** 30 files (committed + staged + unstaged + untracked combined).
**Run at:** 2026-05-03T04:47:51Z
**Commit at finish:** 60dc3dfd

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## Summary

- Requirements extracted:     43
- PASS:                       38
- MECHANICAL_GAP → fixed:      2
- DIRECTIONAL_GAP → deferred:  3
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0 (Phases 0 and 6 not extracted; their requirements are operational, not code)

**Verdict:** NON_CONFORMANT (3 directional gaps — see deferred items)

The three directional gaps are not blocking for QA-stage progress (the build is functionally complete and the gaps either replicate spec-acknowledged TODOs or affect error-code precision rather than core flow). They MUST be addressed before the design-partner Stage 6b verification, because all three become customer-visible: REQ #25 affects callback latency under burst, REQ #23/#30 affects operator awareness on rate-limit truncation and disconnect, and REQ #33 affects GHL retry semantics.

---

## Requirements extracted (full checklist)

| # | Section | Requirement | Verdict |
|---|---|---|---|
| 1 | §5.3 | Scope list 15 total in `OAUTH_PROVIDERS.ghl.scopes` | PASS |
| 2 | §7 | Migration 0268 adds `token_scope`/`company_id`/`installed_at`/`disconnected_at` to `connector_configs` | PASS |
| 3 | §6 Phase 2 | Per-org partial unique index | PASS |
| 4 | §5.4 | Global partial unique index | PASS |
| 5 | §6 Phase 3 | `subaccounts (connector_config_id, external_id) WHERE deleted_at IS NULL` partial unique index | PASS |
| 6 | §8 | `connectorConfigs.ts` declares all required columns plus dedicated token columns from plan §Critical Notes | PASS |
| 7 | §6 Phase 2 | `GET /api/ghl/oauth-url` returns `{ "url": ... }`, requires authenticated session, registers nonce TTL 10 min | PASS |
| 8 | §5.6 / §6 Phase 2 | Generic `/api/oauth/callback` handles GHL with raw nonce; old in-file stub dropped | PASS |
| 9 | §6 Phase 2 | Nonce validation rejects (redirects with `invalid_state`) on missing/expired/not-found; orgId derives solely from validated state | PASS |
| 10 | §6 Phase 2 | `connectorConfigService.upsertAgencyConnection` exists, idempotent ON CONFLICT via `targetWhere` | PASS |
| 11 | §6 Phase 2 | Global 23505 → typed 409 `agency_already_installed_under_different_org` | PASS |
| 12 | §6 Phase 2 | Refresh wired into `connectorPollingTick` before sync fan-out | PASS |
| 13 | §5.7 | `validateAgencyTokenResponse`: userType='Company', companyId, both tokens present | PASS |
| 14 | §5.7 | `validateLocationTokenResponse` enforces companyId+locationId match; throws `LOCATION_TOKEN_MISMATCH`; no persist before validation | PASS |
| 15 | §6 Phase 4 | `connector_location_tokens` table + indexes | PASS |
| 16 | §6 Phase 4 | RLS via join to `connector_configs.organisation_id`; canonical `app.organisation_id` session var | PASS |
| 17 | §6 Phase 4 | Registered in `rlsProtectedTables.ts` (line 947) | PASS |
| 18 | §5.2 / §6 Phase 4 | `getLocationToken` cache/mint/refresh; mint uses `INSERT ... ON CONFLICT DO NOTHING RETURNING`; race-loser re-reads | PASS |
| 19 | §6 Phase 4 | `handleLocationToken401` soft-deletes + remints once; second 401 → `LOCATION_TOKEN_INVALID` | PASS |
| 20 | §5.2 / §6 Phase 4 | Refresh path: POST `/oauth/token`, UPDATE in place persisting returned `scope`; on 401/403 soft-delete + remint via mint path | PASS |
| 21 | §5.2 / §10a | 9 adapter methods use `withLocationToken` wrapper; `listAccounts`/`fetchSubscription` keep agency token | PASS |
| 22 | §6 Phase 3 | `enumerateAgencyLocations` paginated, breaks on short page or 1000-cap | PASS |
| 23 | §5.5 | Truncation cap 1000 → `notify_operator(reason='enumeration_truncated')` | DIRECTIONAL_GAP — only `logger.warn` emitted; `notify_operator` action not dispatched (TODO at line 173) |
| 24 | §6 Phase 3 | `autoEnrolAgencyLocations` upsert with `RETURNING id, (xmax = 0) AS inserted`; auto-start only when inserted | PASS |
| 25 | §6 Phase 3 | Queue invariant: `autoStartOwedOnboardingWorkflows` queues each workflow via pg-boss, never inline | DIRECTIONAL_GAP — workflow tick is async, but run-row insert + template resolution happen inline; TODO at line 242 acknowledges |
| 26 | §6 Phase 3 | Fires from OAuth callback AND `INSTALL Company` webhook (redundancy) | PASS |
| 27 | §5.4 | Webhook `companyId` → `(orgId, configId)` via `findAgencyConnectionByCompanyId` | PASS |
| 28 | §5.4 | INSTALL Company: 200 ack absent / `autoEnrolAgencyLocations` present | PASS |
| 29 | §5.4 | INSTALL Location: 200 ack with `ghl.webhook.install_location_ignored` log; never rejected | PASS |
| 30 | §5.4 | UNINSTALL: revoke + status=disconnected + soft-delete tokens + `notify_operator` | DIRECTIONAL_GAP — revoke now decrypts properly (mechanical fix); step (4) `notify_operator` only logged. Same gap as REQ #23 |
| 31 | §5.4 | LocationCreate: idempotent subaccount upsert + `autoStartOwedOnboardingWorkflows` only on `inserted=true` | PASS |
| 32 | §5.4 | Hard invariant: dedupe row written ONLY after side effects commit | PASS — `ghlWebhook.ts:69` calls dedupe after dispatch returns 200 |
| 33 | §5.4 | Missing `webhookId` → HTTP 400 | DIRECTIONAL_GAP — 400 returned, but with misleading "Missing locationId" message; explicit `WEBHOOK_MISSING_ID` contract not surfaced at route layer |
| 34 | §5.8 | Retry classification: 401 once + refresh, 429/5xx withBackoff 3 retries 1s/2s/4s, 4xx fail-fast | PASS |
| 35 | §5.9 | Mandatory log events fire | PASS (mechanical fix — `callback_failure` was missing from every error path until this run) |
| 36 | §8 | `server/services/ghlAgencyOauthService.ts` exists | PASS |
| 37 | §8 | `server/services/ghlAgencyOauthServicePure.ts` exists | PASS |
| 38 | §8 | `server/services/locationTokenService.ts` exists | PASS |
| 39 | §8 | `server/services/locationTokenServicePure.ts` exists | PASS |
| 40 | §8 | `server/db/schema/connectorLocationTokens.ts` exists; exported from `schema/index.ts` | PASS |
| 41 | §8 | Five test files exist | PASS |
| 42 | §8 / §9 | `docs/integration-reference.md` updated (line 724+) | PASS |
| 43 | §8 / §9 | `docs/capabilities.md` updated (line 953, 1012) | PASS |

---

## Mechanical fixes applied

### Fix 1 — REQ #35: missing `ghl.oauth.callback_failure` log emit

**Spec quote:** §5.9 *"Mandatory events: ... `oauth.callback_failure` ..."*

**File:** `server/routes/oauthIntegrations.ts`
**Lines:** 307-394 (added `logCallbackFailure` helper at lines 311-326; called from each redirect-to-error path)
**Change:** Added a `logCallbackFailure(reason, orgId, companyId)` helper inside the `/api/oauth/callback` handler that emits the spec-named structured log entry. Wired it into every redirect-to-error path (`invalid_callback`, `invalid_state`, `token_exchange_failed`, `token_validation_failed`, `agency_already_installed`, `storage_failed`). `orgId` is `null` until the state nonce is consumed; `companyId` is `null` until the token exchange returns.

### Fix 2 — REQ #30 (UNINSTALL revoke): encrypted bearer token

**Spec quote:** §5.4 *"Best-effort revoke the agency access + refresh tokens via `POST https://services.leadconnectorhq.com/oauth/revoke`."*

**File:** `server/services/ghlWebhookMutationsService.ts`
**Lines:** 24 (added `connectionTokenService` import) and 152-167 (revoke call)
**Change:** The UNINSTALL handler was sending the raw `connection.accessToken` value as the `Authorization: Bearer` header. That field stores the encrypted ciphertext (per `upsertAgencyConnection`, line 300-301), so the revoke call could never have succeeded against GHL's API. The fix decrypts the stored token via `connectionTokenService.decryptToken` before sending — matching the established pattern in `enumerateAgencyLocations`, `getLocationToken`, and `refreshAgencyTokenIfExpired`. Best-effort failure semantics are preserved (the wrapping try/catch still logs and proceeds).

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

See `tasks/todo.md` § *Deferred from spec-conformance review — ghl-module-c-oauth (2026-05-03)*. Brief:

- **REQ #25** — `autoStartOwedOnboardingWorkflows` queues workflow tick async via `WorkflowEngineService.enqueueTick`, but `startOwedOnboardingWorkflow` performs run-row insert and template resolution inline. For a 500-location burst the OAuth callback serialises 500 round-trips before returning. Code TODO at `ghlAgencyOauthService.ts:242` acknowledges. Refactor needs decision on dispatch shape and the existing duplicate-run guard at `subaccountOnboardingService.ts:253-272`.

- **REQ #23 / REQ #30** — `notify_operator` is named in spec for enumeration truncation and UNINSTALL but exists only as a workflow-action registry entry, not a service-callable primitive. Both sites currently emit `logger.warn`/`logger.info` only. Architectural decision needed on how a service-tier caller invokes a workflow-action (direct DB insert into `agency_inbox_alerts` vs system-workflow dispatch via pg-boss).

- **REQ #33** — Missing-`webhookId` lifecycle events fall through to the location-flow gate at `ghlWebhook.ts:75` and 400 with `'Missing locationId'`. Status code is correct; the explicit `WEBHOOK_MISSING_ID` contract is not surfaced. Tightening requires splitting the lifecycle gate so a lifecycle eventType with missing `webhookId` short-circuits before the locationId fallback.

---

## Files modified by this run

- `server/routes/oauthIntegrations.ts` — added `ghl.oauth.callback_failure` logger calls (REQ #35)
- `server/services/ghlWebhookMutationsService.ts` — fixed UNINSTALL bearer-token decryption (REQ #30)
- `tasks/todo.md` — appended deferred-items section (3 entries)
- `tasks/review-logs/spec-conformance-log-ghl-module-c-oauth-2026-05-03T04-47-51Z.md` — this log

---

## Next step

CONFORMANT_AFTER_FIXES — mechanical gaps closed in-session. **Re-run `pr-reviewer` on the expanded changed-code set** before opening the PR; the reviewer needs to see the post-fix state, not the pre-fix state. Then address the 3 directional gaps tracked in `tasks/todo.md` before contacting the design-partner agency for Stage 6b.
