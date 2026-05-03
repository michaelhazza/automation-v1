# GHL Module C — Agency-Level OAuth Flow

| Field | Value |
|---|---|
| Status | READY_FOR_BUILD — spec-reviewer (3 iterations) + chatgpt-spec-review (2 rounds) complete |
| Build slug | `ghl-module-c-oauth` |
| Branch | `ghl-agency-oauth` |
| Owner | (assign at build start) |
| Last updated | 2026-05-03 |
| Related | `docs/clientpulse-ghl-dev-brief.md` §Module C, `docs/clientpulse-soft-launch-blockers-brief.md` Item 2, `docs/create-ghl-app.md`, `docs/baseline-capture-spec.md` (downstream consumer) |

---

## Contents

1. Goal
2. Why
3. State of the foundation
4. Scope
5. Architecture decisions
6. Build phases
7. Migrations
8. Files touched
9. Done definition
10. Open questions
10a. Resolved decisions
11. Risk register
12. Deferred items

---

## 1. Goal

Ship the agency-level OAuth flow end to end: an agency owner installs the app once, all their client locations are enumerated, agency + location tokens are persisted, and downstream ingestion / baseline / pulse work can target every location automatically. Deliberate v1 constraint: agency-target only, no per-location install fallback.

## 2. Why

Without this, every ClientPulse, baseline-capture, and reporting feature is gated to one manually-onboarded sub-account at a time. With this, a 30-client agency onboards in one click. This is the single highest-leverage piece of unfinished GHL work.

## 3. State of the foundation

| Layer | State | Notes |
|---|---|---|
| `server/adapters/ghlAdapter.ts` ingestion (contacts, opps, conversations, payments, locations, subscriptions) | Real HTTP | Assumes agency token works for per-location calls. **Untested.** |
| `server/services/ghlWebhookMutationsPure.ts:143-170` INSTALL / UNINSTALL / LocationCreate / LocationUpdate mappers | Real | Writes to `canonical_subaccount_mutations`. **Does not auto-enrol or persist tokens.** |
| `server/services/integrationConnectionService.ts` (591 lines) | Real | Generic OAuth token lifecycle. Reusable. |
| `server/services/connectorPollingService.ts` | Real | Scheduled sync loop. Already location-scoped. |
| `server/config/oauthProviders.ts` GHL scope list (11 scopes) | Real | **Wrong `authUrl` (`chooselocation`); `companies.readonly` missing; the existing `.write` scopes that adapters already call (`conversations.write`, `opportunities.write`, `payments/orders.readonly`) are not declared.** |
| `server/routes/ghl.ts` | **STUB** | Three TODO routes. The thing this spec replaces. |

## 4. Scope

**In:** Agency-targeted OAuth install/callback, agency token storage, sub-account enumeration via `companies.readonly`, location-token exchange helper with per-location cache, INSTALL/UNINSTALL webhook → auto-enrol/teardown, ingestion adapter switched to use the location-token helper for endpoints that require it, scope-config update, redirect-URI registration, end-to-end verification against a real external agency.

**Out:** Sub-account-level install fallback. Marketplace public listing (stay private; 5-agency cap). Re-consent flow for missing scopes (degrade gracefully per existing pattern; revisit at Phase 5 of ClientPulse). Pricing config UI. Whitelabel branding. Custom per-location token rotation policy beyond GHL's default 24h-with-refresh (the helper in §5.2 implements GHL's default refresh; "out" here means we do not rotate more aggressively, e.g. on every call or every hour).

## 5. Architecture decisions

### 5.1 App target type: Agency (Company)

App registration in GHL developer portal must be set to **Company** (not Location). This changes the OAuth flow:
- Auth URL: agency-targeted apps use the same `marketplace.leadconnectorhq.com` install entrypoint, but the auth-code exchange POSTs `user_type=Company` to `services.leadconnectorhq.com/oauth/token`.
- Callback returns a token whose `userType: 'Company'` and `companyId: <agency-id>` (in addition to `access_token`, `refresh_token`, `expires_in`, `scope`).
- We persist this as the **agency token** and use `companyId` to call `/locations/search?companyId=...` to enumerate sub-accounts.

### 5.2 Token model: agency + location-token cache

- **Agency token** — one per `(organisationId, agency companyId)`. Stored in `connector_configs` with `tokenScope='agency'`. Refreshed via standard refresh_token loop.
- **Location tokens** — minted on demand by POSTing `{ companyId, locationId }` to `https://services.leadconnectorhq.com/oauth/locationToken` with the agency token as Bearer. Cached in `connector_location_tokens` (new table) with `expires_at = now() + 86400s`, refresh_token persisted. Helper `getLocationToken(connection, locationId)` returns a fresh token (cache-hit OR mint-and-store), refreshing if `expires_at < now() + 5min`.
- Adapter call sites that target a specific location (`fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`, `fetchFunnels`, `fetchFunnelPages`, `fetchCalendars`, `fetchUsers`, `fetchLocationDetails` — 9 methods total) switch to `getLocationToken` from day 1. Endpoints that operate at the agency scope continue using the agency token: `fetchLocations` (`/locations/search`) and `fetchSubscription` (`/saas/location/.../subscription`). Phase 4 (§6) is the authoritative inventory.

**Location-token refresh.** Refresh follows GHL's standard OAuth2 path: `POST services.leadconnectorhq.com/oauth/token` with `grant_type=refresh_token`, `refresh_token=<persisted>`, `client_id`, `client_secret`. On success, **update the existing `connector_location_tokens` row in place** (`access_token`, `refresh_token`, `expires_at`, `scope`, `updated_at = now()`) — always persisting the `scope` returned by GHL (scope sets can change between refresh cycles); do not soft-delete and remint, because soft-delete is reserved for the 401-invalidation path (§6 Phase 4). On refresh failure (401/403), soft-delete the row and remint via `/oauth/locationToken` with the agency token; on any second failure surface a typed `LOCATION_TOKEN_INVALID` error.

### 5.3 Required scopes

Add to `OAUTH_PROVIDERS.ghl.scopes` (current list at `server/config/oauthProviders.ts:54-66`):

| Scope | Why | New? |
|---|---|---|
| `companies.readonly` | Enumerate sub-accounts under the agency | **NEW — blocking** |
| `conversations.write` | Already called by some agent skills; declare formally | **NEW — already in use** |
| `opportunities.write` | Same | **NEW — already in use** |
| `payments/orders.readonly` | Revenue baseline metric (already pulled but undeclared) | **NEW — already in use** |

Eleven existing scopes stay (contacts read+write, opportunities read, locations.readonly, users.readonly, calendars.readonly, funnels.readonly, conversations.readonly, conversations/message.readonly, businesses.readonly, saas/subscription.readonly).

**Final scope list — 15 total** (11 existing + 4 new). The complete array that ships in `OAUTH_PROVIDERS.ghl.scopes`:

```
contacts.readonly
contacts.write
opportunities.readonly
opportunities.write              ← NEW
locations.readonly
users.readonly
calendars.readonly
funnels.readonly
conversations.readonly
conversations.write              ← NEW
conversations/message.readonly
businesses.readonly
saas/subscription.readonly
companies.readonly               ← NEW
payments/orders.readonly         ← NEW
```

### 5.4 Install / uninstall webhook → auto-enrol

**Webhook → org mapping.** Every GHL webhook payload carries `companyId` (the GHL agency identifier). The router resolves `(companyId)` to `(orgId, connectorConfigId)` by looking up the agency-token row: `SELECT organisation_id, id FROM connector_configs WHERE connector_type='ghl' AND token_scope='agency' AND company_id=$1 AND status<>'disconnected'`. **Migration 0268 must add a global partial unique index `(connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected'`** — a single GHL agency belongs to a single Automation OS organisation; cross-org collision indicates a misconfiguration, not a legitimate install. The index makes that lookup O(1) and guarantees one match. If zero matches: HTTP 200 ack + log `webhook-orphan-companyId` (the install row hasn't landed yet — see the INSTALL race below). If a future tenant model needs the same GHL agency under multiple Automation OS orgs, the index becomes per-org and webhook routing acquires a disambiguation step — out of scope here.

Existing mappers at `ghlWebhookMutationsPure.ts:143-170` write canonical mutation rows but stop there. Extend the post-webhook side-effect chain:

- **`INSTALL`** (payload includes `appId`, `installType`, `companyId`, `locationId?`, `userId`; **does NOT include `access_token` / `refresh_token`** — token persistence happens in the OAuth callback path):
  - If `installType === 'Company'`:
    - Look up the existing agency connection by `(orgId, companyId)`. If absent (webhook arrived before callback persistence — race window), **ack with HTTP 200** and return; the OAuth callback will trigger enrolment. Do NOT mint or write a partial connection from the webhook payload.
    - If present, call `autoEnrolAgencyLocations` (idempotent — see §6 Phase 3) as a redundancy mechanism. Side-effect events drive baseline-capture (F3) downstream.
  - If `installType === 'Location'`: **HTTP 200 ack** + write an `ignored` log row (`reason='per-location-install-not-supported-v1'`). Never reject at the HTTP layer — rejection invites retry storms.
- **`UNINSTALL`** (idempotent — re-running on an already-disconnected connection is a no-op):
  1. Best-effort revoke the agency access + refresh tokens via `POST https://services.leadconnectorhq.com/oauth/revoke`. On revoke failure (network / 5xx / 4xx), log and proceed — the disconnect must complete locally regardless.
  2. Mark `connector_configs.status='disconnected'`, set `poll_enabled=false`, set `disconnected_at=now()`.
  3. Soft-delete location tokens (`UPDATE connector_location_tokens SET deleted_at=now() WHERE connector_config_id=? AND deleted_at IS NULL`).
  4. Fire `notify_operator` (org-admin recipient) — existing skill in ClientPulse.
  - Do NOT delete `subaccounts` rows or canonical data; that's a separate user action.
  - **Partial-failure resilience:** Step 2 (mark disconnected) is the sentinel — once it commits, no downstream adapter will request new location tokens for this connector. If step 3 (soft-delete tokens) fails transiently, orphan `connector_location_tokens` rows are inactive (unreachable through any live code path) and can be cleaned up by re-delivering the UNINSTALL event (idempotent) or a one-time cleanup query. The full handler is safe to replay from any step.
- **`LocationCreate`** (a new sub-account was added inside an already-connected agency): map `companyId → (orgId, connectorConfigId)` per the lookup above; upsert one `subaccounts` row keyed on `(connector_config_id, external_id)` (same idempotency key as `autoEnrolAgencyLocations`); fire `autoStartOwedOnboardingWorkflows` only when the upsert actually inserted a row. Effectively a single-location version of the bulk enrolment in §6 Phase 3 — share the upsert primitive.
- **`LocationUpdate`**: existing canonical-mutation row is sufficient; no new side effect required (subaccount metadata refresh happens via the next polling tick).

**Webhook idempotency.** Dedupe key is `gohighlevel_webhook_id` (existing infra at `server/services/ghlWebhookMutationsService.ts`). The dedupe row is **committed only after side effects succeed** — failed-side-effect paths (anything that returns HTTP 503 per §6 Phase 3) leave the dedupe key absent so GHL's retry will re-process the same `webhookId`. The §6 Phase 3 upsert-with-xmax guarantee makes this safe (replays are no-ops). Events missing `webhookId` are rejected with **HTTP 400** (no dedupe key = no safe processing); GHL's webhook contract guarantees the field on real events, so absence indicates a malformed or replayed payload that should not be processed. **Hard invariant:** the dedupe row for a given `webhookId` MUST NOT be written until all side effects for that event have committed successfully. Any code path that exits before completing side effects must leave the dedupe key absent so GHL's retry will re-deliver the event. If `ghlWebhookMutationsService.ts` currently commits the dedupe key before side effects, this ordering MUST be reversed in this build — it is not optional. Verify against the current implementation at the start of Phase 5 and document the finding in the phase notes.

### 5.5 Pagination for >100 sub-accounts

`/locations/search` returns max 100 per page. Loop using GHL's `skip` parameter (`limit=100&skip=0`, then `skip=100`, etc.) until response length < limit. Cap at 1000 sub-accounts per agency (defensive; no real agency we onboard is anywhere near this).

**Truncation contract.** If pagination reaches the cap (1000 returned by GHL with the loop still finding `skip=1000` non-empty), stop the loop, process the first 1000 locations through `autoEnrolAgencyLocations`, and emit a single `notify_operator` event (`reason='enumeration_truncated'`, `details={agencyCompanyId, processed: 1000}`). No new persisted column or status enum — the operator notification is the durable signal. Downstream baseline / pulse work targets the 1000 enrolled sub-accounts; the remainder are invisible until the cap is raised in a follow-up.

### 5.6 Redirect URI

Single redirect URI: `${APP_BASE_URL}/api/oauth/callback` (generic, not GHL-specific — passes GHL's URL validator which forbids `ghl`/`gohighlevel`/`highlevel`/`hl`/`leadconnector` substrings). Reuses the existing generic OAuth callback at `server/routes/oauthIntegrations.ts`; we extend that handler with a `provider==='ghl'` branch that sets `user_type=Company` on the token-exchange POST and writes to `connector_configs` (not `integrationConnections`). The GHL-specific code-exchange logic lands as a private helper `exchangeGhlAuthCode(code, redirectUri)` inside `server/routes/oauthIntegrations.ts` — no new service file is introduced **for the callback flow itself**. The new `ghlAgencyOauthService.ts` / `ghlAgencyOauthServicePure.ts` files in §8 own a different responsibility: post-callback orchestration (sub-account enumeration, idempotent `subaccounts` upsert, `autoStartOwedOnboardingWorkflows` dispatch — all the work in §6 Phase 3). The two responsibilities are separated cleanly: the route module owns the HTTP/OAuth boundary, the new service owns the business workflow.

### 5.7 Contracts

Three external shapes cross service boundaries; the rest of the spec assumes these.

**`AgencyTokenResponse`** — JSON returned by `POST services.leadconnectorhq.com/oauth/token` with `user_type=Company`. Producer: GHL. Consumer: `exchangeGhlAuthCode` and the agency-token refresh job.

```jsonc
{
  "access_token": "eyJ...",          // string, required
  "refresh_token": "eyJ...",         // string, required
  "expires_in": 86399,               // number (seconds), required
  "scope": "contacts.readonly conversations.write ...",  // space-delimited
  "userType": "Company",             // string, must equal "Company"
  "companyId": "abc123XYZ",          // string, GHL agency id, required
  "userId": "user_456",              // string, optional
  "locationId": null                 // string|null — null for Company-target installs
}
```

**`LocationTokenResponse`** — JSON returned by `POST services.leadconnectorhq.com/oauth/locationToken` with the agency token as Bearer. Producer: GHL. Consumer: `getLocationToken` helper.

```jsonc
{
  "access_token": "eyJ...",          // string, required
  "refresh_token": "eyJ...",         // string, required
  "expires_in": 86399,               // number (seconds), required
  "scope": "contacts.readonly ...",  // space-delimited (subset of agency scopes)
  "userType": "Location",            // string, must equal "Location"
  "companyId": "abc123XYZ",          // string, parent agency id
  "locationId": "loc_789"            // string, GHL location id, required
}
```

**`LocationTokenResponse` validation (hard).** After receiving this payload, `getLocationToken` MUST assert before persisting:
1. `response.companyId === agencyConnection.companyId` — the token belongs to the same agency.
2. `response.locationId === requestedLocationId` — the token is for the location we requested.

If either assertion fails → typed error `LOCATION_TOKEN_MISMATCH`; **do not persist the token**; surface to caller immediately. A mismatch indicates a GHL API anomaly or token-routing bug and must be logged with full context (`{ requestedLocationId, returnedLocationId, requestedCompanyId, returnedCompanyId }`).

**`Location`** (entry in the `locations` array returned by `GET /locations/search?companyId=...&limit=100&skip=N`). Producer: GHL. Consumer: `enumerateAgencyLocations` and `autoEnrolAgencyLocations`.

```jsonc
{
  "id": "loc_789",                   // string, required — used as `subaccounts.external_id`
  "name": "Acme Co",                 // string, required — used to derive slug
  "businessId": "biz_123",           // string|null
  "companyId": "abc123XYZ",          // string, parent agency id (always == query param)
  "address": "...",                  // string|null — informational only
  "timezone": "America/New_York"     // string|null — informational only
}
```

Fields not listed above are ignored. If a future GHL API change adds a required field we depend on, this section is the place to update first.

**Source-of-truth precedence.** When the agency-token row in `connector_configs` and the most recent INSTALL webhook payload disagree on `companyId`, the OAuth-callback-persisted row wins (it is the only path that handles the bearer-token auth roundtrip). Webhook payloads may surface stale `companyId` after re-installs; see §5.4 for the recovery path.

### 5.8 Retry classification

Global rule for all outbound GHL API calls in this build. Implementers must not scatter bespoke retry logic — use these tiers and `withBackoff` (existing primitive).

| HTTP status | Behaviour |
|---|---|
| 401 | Refresh token once (agency or location, per call site); retry exactly once. Second 401 → typed error (`AGENCY_TOKEN_INVALID` or `LOCATION_TOKEN_INVALID`); surface to caller; no further retry. |
| 429 | `withBackoff` — 3 retries, exponential (1s / 2s / 4s). After exhaustion → typed `AGENCY_RATE_LIMITED` or `LOCATION_RATE_LIMITED`; surface to caller. Webhook-path callers respond HTTP 503 so GHL retries. |
| 5xx | `withBackoff` — 3 retries, exponential (1s / 2s / 4s). After exhaustion → surface typed error. |
| 4xx (non-401) | Fail fast — no retry. Surface typed error immediately. |

`withBackoff` is the only retry primitive permitted (at `server/lib/withBackoff.ts`). Do not hand-roll sleep loops.

### 5.9 Logging contract

Every key event in this build emits a structured log entry with the following shape:

```jsonc
{
  "event": "ghl.<domain>.<action>",   // e.g. "ghl.oauth.callback_success"
  "orgId": "...",
  "companyId": "...",
  "locationId": "..." | null,          // null for agency-scope events
  "result": "success" | "failure",
  "error": { "code": "...", "message": "..." } | null
}
```

**Mandatory events:** `oauth.callback_success`, `oauth.callback_failure`, `enumeration.start` (+ `count` field), `enumeration.end` (+ `enrolled` count), `token.mint`, `token.refresh`, `token.refresh_failure`, `webhook.install_company`, `webhook.install_location_ignored`, `webhook.uninstall`, `webhook.location_create`. These are minimum — implementers may add more; they must not omit these.

## 6. Build phases

### Phase 0 — Spec review + dev-portal config (parallel)

- [ ] `spec-reviewer` pass on this doc (max 5 iterations)
- [ ] (User + Claude pair) Walk through `docs/create-ghl-app.md` to finish app registration: target=Company, client_id/secret captured, redirect URI registered, scope list set, webhook URL registered, INSTALL+UNINSTALL+LocationCreate+LocationUpdate events enabled
- [ ] Set env vars: `OAUTH_GHL_CLIENT_ID`, `OAUTH_GHL_CLIENT_SECRET`, `OAUTH_GHL_REDIRECT_URI`, `WEBHOOK_SECRET`
- [ ] **Test agency strategy (two-stage):** during dev verification (Phase 6 first pass) use a fresh GHL Agency Pro 14-day trial — own account, no risk to real client data. Once the app is stable end-to-end on the trial, switch to the design-partner agency (already lined up) for real-world validation. Document the trial-vs-partner cutover criteria in `tasks/builds/ghl-module-c-oauth/test-agency-decision.md` (e.g. "all Phase 6 checks green on trial → invite partner; if any check fails on trial, do not contact partner").

### Phase 1 — Scope list + redirect-URI plumbing (~0.5 day)

- [ ] Add 4 new scopes to `OAUTH_PROVIDERS.ghl.scopes`
- [ ] Confirm `OAUTH_GHL_REDIRECT_URI` defaults align with `${APP_BASE_URL}/api/oauth/callback`
- [ ] Update `oauthProviders.ts` GHL `authUrl` if portal config requires `choosecompany` over `chooselocation` (verify empirically — GHL docs are ambiguous; one URL with `user_type=Company` may suffice)
- [ ] Unit test: scope serialisation + URL construction round-trip

### Phase 2 — Agency OAuth callback + token persistence (~2 days)

- [ ] New migration **0268** `connector_configs` columns: `token_scope text not null default 'agency'`, `company_id text`, `installed_at timestamptz`, `disconnected_at timestamptz`. Two partial unique indexes:
  - `(organisation_id, connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected'` — one agency per org per connector type.
  - `(connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected'` — **global**: a single GHL agency cannot be installed under two different Automation OS orgs simultaneously (see §5.4 webhook→org mapping). If a re-install happens after `UNINSTALL`, the prior row's `status='disconnected'` clears the index slot.
  
  (`agency_id` is NOT a separate column — `companyId` is the GHL agency identifier; if a domain alias is needed in TypeScript types, surface it at the API layer only. The existing `connectorConfigs.connectorType` column is reused — there is no separate `provider` column.)
- [ ] Rework `server/routes/ghl.ts`: keep `GET /api/ghl/oauth-url` as the **initiation** endpoint that issues the GHL install URL and stores the CSRF state nonce. **Response shape:** `{ "url": "https://marketplace.leadconnectorhq.com/oauth/..." }` — no other fields. The endpoint requires an authenticated session (org context) to record `orgId` in the state. **State payload:** `{ orgId, nonce }` (nonce = cryptographically random 32-byte hex). **State storage:** in-process memory map keyed by nonce, TTL = 10 minutes; entries are deleted on first use (one-shot) or on TTL expiry. Drop the in-file `GET /api/ghl/oauth/callback` stub — the **callback** is now the generic `${APP_BASE_URL}/api/oauth/callback` in `server/routes/oauthIntegrations.ts`, where the new `provider==='ghl'` branch: (1) validates the nonce against the state store — reject HTTP 400 if missing, expired, or not found; (2) extracts `orgId` from the validated state entry — reject HTTP 400 if `orgId` is absent; (3) calls the private `exchangeGhlAuthCode(code, redirectUri)` helper (see §5.6). **Invariant: the `orgId` from the validated state is the sole authoritative identity for the rest of the callback — never derive it from the request session, query param, or any other source.** **Deployment caveat:** in-process memory state is only valid for single-instance deployments. If the app runs behind multiple instances before this ships (load balancer, auto-scaling), the state store must move to a shared store (DB or Redis) or sticky sessions must be configured — otherwise a callback arriving on a different instance will fail the nonce lookup with HTTP 400. This is not in scope for this spec; verify the deployment topology before shipping.
- [ ] On callback success: `connectorConfigService.upsertAgencyConnection({ orgId, companyId, accessToken, refreshToken, expiresAt, scope })`. Upsert semantics: `INSERT ... ON CONFLICT (organisation_id, connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected' DO UPDATE SET access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at, scope=EXCLUDED.scope, installed_at=COALESCE(connector_configs.installed_at, EXCLUDED.installed_at), disconnected_at=NULL, status='active', updated_at=now()`. Re-installs are **idempotent** — caller receives **HTTP 200** with the existing-or-refreshed connection. **23505 mapping:** a unique-violation on the global index `(connector_type, company_id) WHERE ...` surfaces as **HTTP 409 `agency_already_installed_under_different_org`** with the conflicting `companyId` redacted in the user-facing response (operator gets the full detail in the log). A bubbled `23505` from the per-org index would indicate a logic bug (the upsert covers it) — never let it surface as a 500. **409 operational resolution:** if a 409 occurs in practice (e.g., QA org vs prod org both holding the same `companyId`), resolve by executing `UPDATE connector_configs SET status='disconnected' WHERE connector_type='ghl' AND company_id=<companyId> AND token_scope='agency' AND organisation_id=<the-other-org-id>` — this clears the global-index slot so the new install proceeds. Document this query in the operator runbook. No UI escape hatch is provided in v1.
- [ ] Refresh-token loop: `connector_configs` rows with `token_scope='agency'` do not currently have a refresh job (the existing `connectionTokenService.refreshIfExpired` handles `IntegrationConnection`, not `ConnectorConfig`). Add the agency-token refresh path to `server/services/connectorConfigService.ts` (new method `refreshIfExpired(configId)`) and wire it into `server/jobs/connectorPollingTick.ts` so every poll tick refreshes near-expiry agency tokens before issuing API calls. Same `expires_at < now() + 5min` predicate as location tokens.
- [ ] Unit tests: token exchange, expiry math, refresh path, CSRF state validation
- [ ] Integration test (mocked GHL): full callback round-trip

### Phase 3 — Sub-account enumeration + auto-enrol (~1.5 days)

- [ ] Helper `enumerateAgencyLocations(connection): Promise<Location[]>` — paginated `/locations/search?companyId=...&limit=100&skip=N`, returns flat list. **401 handling:** token-expiry path triggers a single refresh via the existing refresh-token loop and one retry; second 401 → typed `AGENCY_TOKEN_INVALID` error surfaced to caller. **429 handling:** wrap the call in `withBackoff` (existing primitive at `server/lib/withBackoff.ts`) with 3 retries and exponential backoff (1s / 2s / 4s); after exhaustion, surface a typed `AGENCY_RATE_LIMITED` error and let the caller decide:
  - **Callback path** (synchronous OAuth callback): log + `notify_operator`, redirect the user back to onboarding with a "we will retry shortly" notice. **The agency connection row (`connector_configs`) remains `status='active'` regardless of enrolment outcome** — the OAuth token is valid even when sub-account enumeration fails; the operator never needs to re-consent. Recovery happens via the redundant `INSTALL` webhook (§5.4) — that path will land within seconds-to-minutes and re-trigger `autoEnrolAgencyLocations` against the now-quiet rate limiter. If the webhook also fails repeatedly, the operator notification is the manual-recovery signal; we do NOT add a polling-tick enrolment retry in this build (would conflict with the existing `connectorPollingTick` responsibility, which is sync only — no enrolment).
  - **Webhook path** (async, GHL-driven): respond **HTTP 503** so GHL re-delivers the webhook per its retry policy. (HTTP 200 ack tells GHL the event is durably handled; using it here would lose the work.) The GHL retry will hit the dedupe key (`gohighlevel_webhook_id`) — handlers must therefore be safe to invoke twice with the same key, which the §6 Phase 3 upsert-with-xmax already guarantees.
  
  **Truncation cap:** see §5.5 — stop at 1000, fire `notify_operator(reason='enumeration_truncated')`.
- [ ] Service `autoEnrolAgencyLocations(orgId, agencyConnection)` — for each location: upsert into `subaccounts` keyed on `(connector_config_id, external_id)` (where `external_id` is the GHL `locationId`). The DB-level upsert is the **idempotency primitive** (`INSERT ... ON CONFLICT (connector_config_id, external_id) DO UPDATE SET name=EXCLUDED.name, updated_at=now() RETURNING (xmax = 0) AS inserted`). `autoStartOwedOnboardingWorkflows()` fires **only when `inserted = true`** (first creation); this is the single concurrency guard for the callback-vs-webhook race in §5.4. **Queue invariant: `autoStartOwedOnboardingWorkflows` MUST enqueue each workflow job via pg-boss — never execute inline.** This makes a 500-location burst safe: the callback returns promptly and pg-boss processes jobs at its configured concurrency limit. Implementers must confirm the existing `autoStartOwedOnboardingWorkflows` implementation dispatches via pg-boss and not direct inline execution; if it does not, fix it in this build. Migration 0268 must add the partial unique index `(connector_config_id, external_id) WHERE deleted_at IS NULL` to `subaccounts` if it does not already exist (verify against current schema before drafting the migration).
- [ ] Wire `autoEnrolAgencyLocations` to fire (a) once at the end of the OAuth callback, (b) on every `INSTALL` webhook (`installType=Company`) as a redundancy mechanism. Both paths share the upsert above; the second-arriver always sees `inserted = false` and skips `autoStartOwedOnboardingWorkflows()`.
- [ ] Unit tests: pagination edge cases (0, 1, 100, 101, 1000, 1001 locations), upsert idempotency (assert `autoStartOwedOnboardingWorkflows` fires exactly once across two concurrent calls), 401-then-refresh-then-401 path, `withBackoff` retry budget exhaustion
- [ ] Integration test: mocked enumerate-then-enrol with a fixture of 250 locations

### Phase 4 — Location-token helper + adapter rewire (~2 days)

- [ ] New migration **0269** `connector_location_tokens` table: `(id uuid pk, connector_config_id uuid fk, location_id text, access_token text, refresh_token text, expires_at timestamptz, scope text, created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz)` with **unique partial index** `(connector_config_id, location_id) WHERE deleted_at IS NULL` and **secondary index** on `expires_at WHERE deleted_at IS NULL`. **RLS posture:** tenant-scoped via `connector_config_id → connector_configs.organisation_id`; add a `USING` clause in the policy that joins to `connector_configs` and filters by `current_setting('app.org_id')`. **Register in `server/config/rlsProtectedTables.ts`** in the same commit as migration 0269 (the manifest is TypeScript code; the migration is SQL. The `verify-rls-coverage.sh` gate fails if the SQL lands without the manifest update.) No direct HTTP route surface; access is helper-only via `getLocationToken`.
- [ ] Helper `getLocationToken(connection, locationId): Promise<string>` — cache-hit fast path, mint-and-store on miss, refresh when `expires_at < now() + 5min`. **Concurrency primitive: the DB unique partial index is the authoritative guard.** The mint path uses `INSERT ... ON CONFLICT (connector_config_id, location_id) WHERE deleted_at IS NULL DO NOTHING RETURNING *`; if the insert returns 0 rows the mint racer lost — re-read the existing row and use its token. The optional in-process per-location lock (e.g. an `AsyncLock` keyed on `connector_config_id:location_id`) is a perf optimisation only (avoids redundant cold-start mints in a single worker); correctness does not depend on it.
- [ ] **401 handling for cached location tokens:** soft-delete the cached row (`UPDATE connector_location_tokens SET deleted_at=now() WHERE id=?`), remint exactly once via the cache-miss path, and retry the original adapter call. A second 401 after remint → typed `LOCATION_TOKEN_INVALID` error surfaced to caller; do not retry further.
- [ ] Rewire `ghlAdapter.fetchContacts/fetchOpportunities/fetchConversations/fetchRevenue/fetchFunnels/fetchFunnelPages/fetchCalendars/fetchUsers/fetchLocationDetails` (9 methods) to call `getLocationToken(connection, locationId)` and pass that token in the `Authorization` header. **Keep on the agency token:** `fetchLocations` (`/locations/search`) and `fetchSubscription` (`/saas/location/.../subscription`) — both are documented to accept the agency token. **Enforcement invariant:** no adapter method may call a location-scoped GHL endpoint with an agency token. Enforce via a central request-helper wrapper (preferred) or lint rule — exact mechanism deferred to implementer. The 9-method list above is the authoritative boundary; Stage 6a verifies each with zero permission errors.
- [ ] Unit tests: cache hit, cache miss, expiry refresh, race-loser re-read path (assert `INSERT ... ON CONFLICT` returns 0 rows on the loser), 401-then-soft-delete-then-remint, second-401 typed-error path
- [ ] Integration test: end-to-end fetch with mock that asserts the location-token endpoint is called exactly once per (location, day)

### Phase 5 — Install / uninstall webhook side effects (~1 day)

- [ ] Extend webhook router post-mapping chain with side-effect dispatch (full semantics in §5.4):
  - `INSTALL` + `installType=Company` → look up existing agency connection by `(orgId, companyId)`; if absent, **HTTP 200 ack** (callback path will drive enrolment); if present, trigger `autoEnrolAgencyLocations`
  - `INSTALL` + `installType=Location` → **HTTP 200 ack** + write an `ignored` log row (`reason='per-location-install-not-supported-v1'`); never reject at the HTTP layer
  - `UNINSTALL` → in order: (1) best-effort revoke via `POST services.leadconnectorhq.com/oauth/revoke` (failures logged, do not block subsequent steps); (2) `UPDATE connector_configs SET status='disconnected', poll_enabled=false, disconnected_at=now() WHERE organisation_id=? AND company_id=? AND token_scope='agency'`; (3) `UPDATE connector_location_tokens SET deleted_at=now() WHERE connector_config_id=? AND deleted_at IS NULL`; (4) fire `notify_operator` (org-admin recipient). Idempotent — re-running on an already-disconnected connection is a no-op (steps 2 and 3 update zero rows).
- [ ] Idempotency: webhook handlers safe under retry (GHL retries on 5xx). Dedupe key is `gohighlevel_webhook_id` (existing infra at `server/services/ghlWebhookMutationsService.ts`); events missing `webhookId` are rejected with **HTTP 400** (no dedupe key = no safe processing — see §5.4).
- [ ] Unit tests: each event type, each idempotency case (replay returns same result), missing-`webhookId` → 400 path
- [ ] Integration test: simulated INSTALL → enrol → UNINSTALL → cleanup

### Phase 6 — Verification gate (real external agency) (~1-2 days)

Two-stage execution per Phase 0 decision:

**Stage 6a — GHL trial (own account, no risk):**
- [ ] Stand up fresh GHL Agency Pro 14-day trial; create 3-5 dummy sub-accounts inside it
- [ ] Install app from scratch on the trial
- [ ] Confirm OAuth completes, `companyId` returned, agency token persisted
- [ ] Confirm `/locations/search` returns all sub-accounts; rows appear in `subaccounts` table; `autoStartOwedOnboardingWorkflows` fires per sub-account
- [ ] Confirm `INSTALL` webhook arrives, `LocationCreate` events flow when locations are added agency-side
- [ ] Run `fetchContacts`/`fetchOpportunities`/`fetchConversations`/`fetchRevenue` for each sub-account — confirm zero permission errors
- [ ] Confirm `getLocationToken` mints location tokens and caches them (assert exactly-one mint per location per day)
- [ ] Run `UNINSTALL` flow; confirm cleanup
- [ ] Pagination check: fixture-mock the enumerate path with 250 rows once
- [ ] All checks green → proceed to 6b. Any check red → fix and re-run on the trial; do not contact partner.

**Stage 6b — Design-partner agency (real-world):**
- [ ] Schedule install with the design partner; install app fresh on their agency
- [ ] Re-run all 6a checks against real client data
- [ ] Capture issues with real-world scale (real sub-account counts, real data volumes, real network latency)
- [ ] Document findings + any required spec deltas in `tasks/builds/ghl-module-c-oauth/verification-report.md`

## 7. Migrations

| # | Description | Phase |
|---|---|---|
| 0268 | `connector_configs` extension: `token_scope`, `company_id`, `installed_at`, `disconnected_at`. Two partial unique indexes: `(organisation_id, connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected'` (per-org) and `(connector_type, company_id) WHERE token_scope='agency' AND status<>'disconnected'` (global — see §5.4). Also add `subaccounts` partial unique index `(connector_config_id, external_id) WHERE deleted_at IS NULL` if not already present (verify against current schema before drafting). | 2 |
| 0269 | `connector_location_tokens` table (incl. `deleted_at timestamptz`); partial unique index `(connector_config_id, location_id) WHERE deleted_at IS NULL`; secondary index on `expires_at WHERE deleted_at IS NULL`; RLS policy joining to `connector_configs` for org-scoped access. The `RLS_PROTECTED_TABLES` manifest entry in `server/config/rlsProtectedTables.ts` lands in the same commit as the migration (TypeScript code, not SQL). | 4 |

## 8. Files touched

**New:**
- `server/services/ghlAgencyOauthService.ts` (IO-having: orchestration + DB writes)
- `server/services/ghlAgencyOauthServicePure.ts` (pure: scope-list serialisation, OAuth-URL construction, token-expiry math, payload validation)
- `server/services/locationTokenService.ts` (IO-having: cache lookup, mint, refresh, soft-delete on 401)
- `server/services/locationTokenServicePure.ts` (pure: expiry-window math, race-loser detection, token-shape validation)
- `server/services/__tests__/ghlAgencyOauthServicePure.test.ts` (pure-function unit tests)
- `server/services/__tests__/locationTokenServicePure.test.ts` (pure-function unit tests)
- `server/services/__tests__/ghlAgencyOauthService.test.ts` (in-process tests with mocked HTTP — callback round-trip per §6 Phase 2; enumerate-then-enrol with 250-fixture per §6 Phase 3)
- `server/services/__tests__/locationTokenService.test.ts` (in-process tests with mocked HTTP — mint, refresh, soft-delete-on-401 per §6 Phase 4)
- `server/services/__tests__/ghlWebhookMutationsService.test.ts` (in-process tests with mocked HTTP — INSTALL/UNINSTALL/LocationCreate side-effect chain per §6 Phase 5)
- `server/db/schema/connectorLocationTokens.ts`
- `migrations/0268_connector_configs_agency_columns.sql` (+ `migrations/_down/0268_connector_configs_agency_columns.sql`)
- `migrations/0269_connector_location_tokens.sql` (+ `migrations/_down/0269_connector_location_tokens.sql`)
- `tasks/builds/ghl-module-c-oauth/{plan.md, progress.md, test-agency-decision.md, verification-report.md}`

**Modified:**
- `server/config/oauthProviders.ts` (final 15-scope list per §5.3 + maybe `authUrl`)
- `server/routes/ghl.ts` (replace stub with thin redirector to generic `/api/oauth/callback`)
- `server/routes/oauthIntegrations.ts` (add `provider==='ghl'` branch + private `exchangeGhlAuthCode` helper — see §5.6)
- `server/services/connectorConfigService.ts` (`upsertAgencyConnection` per §6 Phase 2)
- `server/db/schema/connectorConfigs.ts` (new columns: `token_scope`, `company_id`, `installed_at`, `disconnected_at`)
- `server/services/ghlWebhookMutationsService.ts` (side-effect dispatch per §5.4 / §6 Phase 5 — INSTALL Company / Location, UNINSTALL, LocationCreate)
- `server/jobs/connectorPollingTick.ts` (call `connectorConfigService.refreshIfExpired(configId)` before each poll tick — see §6 Phase 2)
- `server/adapters/ghlAdapter.ts` (location-token wiring on 9 fetch methods per §6 Phase 4 — `fetchSubscription` and `fetchLocations` keep the agency token)
- `server/config/rlsProtectedTables.ts` (add `connector_location_tokens` entry — must land in migration 0269)
- `docs/capabilities.md` (mark GHL connector agency-level production-ready when Stage 6b passes)
- `docs/integration-reference.md` (add GHL agency-vs-location token model section)

## 9. Done definition

- [ ] All 6 phases complete; lint + typecheck baseline maintained
- [ ] Targeted unit tests authored under each phase (per `docs/spec-context.md` testing posture: pure-function unit tests in `*Pure.test.ts` files exercising the new `*Pure.ts` modules, plus the small set of in-process tests with mocked HTTP that the phases name explicitly). Each test file the phases call out exists and runs green via `npx tsx <path>`. CI runs the full suite — local dev does not.
- [ ] Verification gate Stage 6a (trial agency) passed: zero permission errors, all sub-accounts enumerable, INSTALL + UNINSTALL flows work end-to-end
- [ ] Verification gate Stage 6b (design-partner agency) passed against real client data
- [ ] `tasks/builds/ghl-module-c-oauth/verification-report.md` written
- [ ] `docs/clientpulse-soft-launch-blockers-brief.md` Item 2 marked CLOSED
- [ ] `docs/capabilities.md` updated: GHL connector listed as agency-level production-ready
- [ ] `docs/integration-reference.md` GHL section updated with the agency vs location token model
- [ ] `pr-reviewer` clean

## 10. Open questions (business + ops)

1. **`choosecompany` URL** — GHL docs ambiguous on whether agency-targeted apps use a different install URL or just the `user_type=Company` token-exchange parameter. Resolve empirically in Phase 0 (the developer portal will tell us when we configure the app).
2. **Marketplace listing path** — out of scope for this spec; tracked separately at Phase 5 of ClientPulse.

## 10a. Resolved decisions

- **Test agency strategy (two-stage).** GHL Agency Pro 14-day trial for Stage 6a (own account, no risk to real clients); design-partner agency for Stage 6b (real-world validation). Cutover criterion: all 6a checks green before contacting partner.
- **Token-swap surface.** 9 adapter methods use location tokens (`fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`, `fetchFunnels`, `fetchFunnelPages`, `fetchCalendars`, `fetchUsers`, `fetchLocationDetails`); 2 stay on the agency token (`fetchLocations`, `fetchSubscription`). Stage 6a (§6 Phase 6) verifies the two agency-token exceptions empirically — if either fails on the trial agency, move it to the location-token list and re-run.

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agency token doesn't work on per-location endpoints | Medium | High (Phase 4 forced) | Build location-token helper from day 1; assume swap is required |
| GHL API version drift between dev and verification | Low | Medium | Pin `Version: 2021-07-28` header on all calls (already convention) |
| Pagination edge cases on large agencies | Medium | Medium | Cap at 1000 with operator warning; full pagination test in Phase 3 |
| Webhook retry storms on transient 5xx | Low | Medium | Idempotency via webhook_id dedupe (existing) |
| Trial agency expires mid-build | Low | Medium | Stage 6a is short; if trial lapses, start a new one. Build does not depend on persistent trial state. |
| Design-partner agency unavailable when 6b is ready | Low | Medium | Surface 1 week before 6b in user check-in; if unavailable, hold at 6a-green (Done definition NOT met until 6b passes — see §9). Re-check weekly. No feature flag — `docs/spec-context.md` rules out rollout-gating flags in pre-prod; the build simply waits. |
| `companies.readonly` not granted on existing tokens | High | Low (no installs yet) | Re-consent flow deferred to ClientPulse Phase 5; net-new installs land with the right scope |

## 12. Deferred items

- **Sub-account-level install fallback.** This spec ships agency-target only. Sub-account installs would need a separate token-storage shape and a different webhook routing model. Reason: every prospect we've spoken to is an agency; a per-location install path is unused surface today.
- **Re-consent flow for missing scopes.** The scope-gating enforcement point is `server/adapters/ghlAdapter.ts` (the `mapGhlAvailability` helper near line 504, which returns `{ availability: 'unavailable_missing_scope' }` on 401/403 from per-endpoint calls). That helper already runs for `connector_configs`-backed agency calls and `connector_location_tokens`-backed location calls — no separate gating layer is needed. A formal re-consent UI is deferred to ClientPulse Phase 5; net-new installs land with the right 15-scope list, so this only affects pre-existing legacy `IntegrationConnection` rows (which this build does not touch).
- **Marketplace public listing.** App stays private (5-agency cap) for the foreseeable future. Public listing tracked separately at Phase 5 of ClientPulse.
- **Pricing config UI.** Out of scope; agencies onboard at a single pricing tier configured manually for now.
- **Whitelabel branding.** Out of scope; the GHL Module shows our brand throughout.
- **Custom per-location token rotation policy.** Out of scope; the helper in §5.2 implements GHL's default 24h-with-refresh. Custom rotation (e.g. force-refresh every hour for paranoid tenants) is deferred until a real customer requests it.
- **Lifting the 1000-location enumeration cap.** Defensive cap in §5.5; no real agency we've spoken to is anywhere near 1000 locations. Lift the cap when the first agency hits the truncation `notify_operator` event.
- **Persisted enumeration-status / truncation column on `subaccounts`.** Considered during review; the operator notification (§5.5) is the durable signal. Re-evaluate if downstream chains need to query truncation history without scanning logs.
