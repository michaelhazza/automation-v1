# GHL Module C — Agency-Level OAuth Flow

| Field | Value |
|---|---|
| Status | DRAFT — pending `spec-reviewer` |
| Build slug | `ghl-module-c-oauth` |
| Branch | `claude/ghl-module-c-oauth` |
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
11. Risk register

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
| `server/config/oauthProviders.ts` GHL scope list (11 scopes) | Real | **Wrong `authUrl` (`chooselocation`); `companies.readonly` missing; no `.write` scopes declared.** |
| `server/routes/ghl.ts` | **STUB** | Three TODO routes. The thing this spec replaces. |

## 4. Scope

**In:** Agency-targeted OAuth install/callback, agency token storage, sub-account enumeration via `companies.readonly`, location-token exchange helper with per-location cache, INSTALL/UNINSTALL webhook → auto-enrol/teardown, ingestion adapter switched to use the location-token helper for endpoints that require it, scope-config update, redirect-URI registration, end-to-end verification against a real external agency.

**Out:** Sub-account-level install fallback. Marketplace public listing (stay private; 5-agency cap). Re-consent flow for missing scopes (degrade gracefully per existing pattern; revisit at Phase 5 of ClientPulse). Pricing config UI. Whitelabel branding. Per-location token rotation policy beyond GHL's default (24h with refresh).

## 5. Architecture decisions

### 5.1 App target type: Agency (Company)

App registration in GHL developer portal must be set to **Company** (not Location). This changes the OAuth flow:
- Auth URL: agency-targeted apps use the same `marketplace.leadconnectorhq.com` install entrypoint, but the auth-code exchange POSTs `user_type=Company` to `services.leadconnectorhq.com/oauth/token`.
- Callback returns a token whose `userType: 'Company'` and `companyId: <agency-id>` (in addition to `access_token`, `refresh_token`, `expires_in`, `scope`).
- We persist this as the **agency token** and use `companyId` to call `/locations/search?companyId=...` to enumerate sub-accounts.

### 5.2 Token model: agency + location-token cache

- **Agency token** — one per `(organisationId, agency companyId)`. Stored in `connector_configs` with `tokenScope='agency'`. Refreshed via standard refresh_token loop.
- **Location tokens** — minted on demand by POSTing `{ companyId, locationId }` to `https://services.leadconnectorhq.com/oauth/locationToken` with the agency token as Bearer. Cached in `connector_location_tokens` (new table) with `expires_at = now() + 86400s`, refresh_token persisted. Helper `getLocationToken(connection, locationId)` returns a fresh token (cache-hit OR mint-and-store), refreshing if `expires_at < now() + 5min`.
- Adapter call sites flagged as risky (`fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`) switch to `getLocationToken` from day 1. Endpoints that demonstrably accept the agency token continue using it (notably `/locations/search` and `/saas/location/.../subscription`).

### 5.3 Required scopes

Add to `OAUTH_PROVIDERS.ghl.scopes` (current list at `server/config/oauthProviders.ts:54-66`):

| Scope | Why | New? |
|---|---|---|
| `companies.readonly` | Enumerate sub-accounts under the agency | **NEW — blocking** |
| `conversations.write` | Already called by some agent skills; declare formally | **NEW — already in use** |
| `opportunities.write` | Same | **NEW — already in use** |
| `payments/orders.readonly` | Revenue baseline metric (already pulled but undeclared) | **NEW — already in use** |

Eleven existing scopes stay (contacts read+write, opportunities read, locations.readonly, users.readonly, calendars.readonly, funnels.readonly, conversations.readonly, conversations/message.readonly, businesses.readonly, saas/subscription.readonly).

### 5.4 Install / uninstall webhook → auto-enrol

Existing mappers at `ghlWebhookMutationsPure.ts:143-170` write canonical mutation rows but stop there. Extend the post-webhook side-effect chain:

- **`INSTALL`** (payload includes `appId`, `installType`, `companyId`, `locationId?`, `userId`):
  - If `installType === 'Company'`: persist agency token (already in callback path), enumerate `/locations/search?companyId=...` with pagination (limit=100, offset loop), insert one `subaccounts` row per location, fire `subaccountOnboardingService.autoStartOwedOnboardingWorkflows()` per new sub-account. Side-effect events drive baseline-capture (F3) downstream.
  - If `installType === 'Location'`: reject (we don't support per-location installs in v1). Log + ack the webhook to prevent retry storms.
- **`UNINSTALL`**: revoke agency token, mark `connector_configs.status='disconnected'`, stop scheduled syncs (set `connector_configs.poll_enabled=false`), notify org admins via `notify_operator` skill (already wired in ClientPulse). Do NOT delete sub-accounts or canonical data; that's a separate user action.

### 5.5 Pagination for >100 sub-accounts

`/locations/search` returns max 100 per page. Loop with offset until response length < limit. Cap at 1000 sub-accounts per agency (configurable; if exceeded, log and process first 1000, surface warning to operator).

### 5.6 Redirect URI

Single redirect URI: `${APP_BASE_URL}/api/oauth/callback` (generic, not GHL-specific — passes GHL's URL validator which forbids `ghl`/`gohighlevel`/`highlevel`/`hl`/`leadconnector` substrings). Reuses the existing generic OAuth callback at `server/routes/oauthIntegrations.ts`; we extend that handler with a `provider==='ghl'` branch that sets `user_type=Company` and writes to `connector_configs` (not `integrationConnections`).

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

- [ ] New migration **0268** `connector_configs` columns: `token_scope text not null default 'agency'`, `company_id text`, `agency_id text` (alias surfaced in callback), `installed_at timestamptz`, partial unique index on `(organisation_id, provider, company_id) where token_scope='agency' and deleted_at is null`
- [ ] Replace `server/routes/ghl.ts` stub with thin redirector to generic `/api/oauth/callback`. Keep state-nonce logic; move token exchange into `oauthIntegrationsService.exchangeGhl()` with `user_type=Company` body param
- [ ] On callback success: `connectorConfigService.upsertAgencyConnection({ orgId, companyId, accessToken, refreshToken, expiresAt, scope })`
- [ ] Refresh-token loop: extend existing token-refresh job to handle `token_scope='agency'`
- [ ] Unit tests: token exchange, expiry math, refresh path, CSRF state validation
- [ ] Integration test (mocked GHL): full callback round-trip

### Phase 3 — Sub-account enumeration + auto-enrol (~1.5 days)

- [ ] Helper `enumerateAgencyLocations(connection): Promise<Location[]>` — paginated `/locations/search?companyId=...&limit=100&skip=N`, returns flat list, handles 401 (token expired), 429 (rate-limited; reuses existing rate limiter)
- [ ] Service `autoEnrolAgencyLocations(orgId, agencyConnection)` — for each location: upsert `subaccounts` row with `name`, `slug` (derived from location name), GHL `external_id`, link to `connector_configs.id`. Idempotent (re-runs are safe). Calls existing `subaccountOnboardingService.autoStartOwedOnboardingWorkflows()` only on first creation.
- [ ] Wire `autoEnrolAgencyLocations` to fire (a) once at the end of the OAuth callback, (b) on every `INSTALL` webhook (`installType=Company`) as a redundancy mechanism
- [ ] Unit tests: pagination edge cases (0, 1, 100, 101, 1000, 1001 locations), idempotency, 401 retry, 429 backoff
- [ ] Integration test: mocked enumerate-then-enrol with a fixture of 250 locations

### Phase 4 — Location-token helper + adapter rewire (~2 days)

- [ ] New migration **0269** `connector_location_tokens` table: `(id, connector_config_id fk, location_id text, access_token, refresh_token, expires_at, scope, created_at, updated_at)` with unique `(connector_config_id, location_id) where deleted_at is null` and index on `expires_at`
- [ ] Helper `getLocationToken(connection, locationId): Promise<string>` — cache-hit fast path, mint-and-store on miss, refresh when `expires_at < now() + 5min`. Per-location async lock to prevent thundering-herd minting on cold start.
- [ ] Rewire `ghlAdapter.fetchContacts/fetchOpportunities/fetchConversations/fetchRevenue/fetchSubscription/fetchFunnels/fetchFunnelPages/fetchCalendars/fetchUsers/fetchLocationDetails` to call `getLocationToken(connection, locationId)` and pass that token in the `Authorization` header. Keep `fetchLocations` (i.e. `/locations/search`) on the agency token.
- [ ] Unit tests: cache hit, cache miss, expiry refresh, lock contention, 401 invalidation
- [ ] Integration test: end-to-end fetch with mock that asserts the location-token endpoint is called exactly once per (location, day)

### Phase 5 — Install / uninstall webhook side effects (~1 day)

- [ ] Extend webhook router post-mapping chain with side-effect dispatch:
  - `INSTALL` + `installType=Company` → trigger `autoEnrolAgencyLocations`
  - `INSTALL` + `installType=Location` → log + reject
  - `UNINSTALL` → mark `connector_configs.status='disconnected'`, set `poll_enabled=false`, soft-delete location tokens, fire `notify_operator` (org-admin recipient)
- [ ] Idempotency: webhook handlers must be safe under retry (GHL retries on 5xx). Use `gohighlevel_webhook_id` as dedupe key (existing infra at `server/services/ghlWebhookMutationsService.ts`)
- [ ] Unit tests: each event type, each idempotency case
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
| 0268 | `connector_configs` extension: `token_scope`, `company_id`, `agency_id`, `installed_at`, partial unique index | 2 |
| 0269 | `connector_location_tokens` table + indexes | 4 |

## 8. Files touched

**New:** `server/services/ghlAgencyOauthService.ts`, `server/services/locationTokenService.ts`, `server/services/__tests__/ghlAgencyOauthServicePure.test.ts`, `server/services/__tests__/locationTokenServicePure.test.ts`, `server/db/schema/connectorLocationTokens.ts`, `tasks/builds/ghl-module-c-oauth/{plan.md, progress.md, test-agency-decision.md, verification-report.md}`.

**Modified:** `server/config/oauthProviders.ts` (scopes + maybe authUrl), `server/routes/ghl.ts` (replace stub with thin redirector), `server/routes/oauthIntegrations.ts` (add GHL Company branch), `server/services/connectorConfigService.ts` (agency upsert), `server/db/schema/connectorConfigs.ts` (new columns), `server/services/ghlWebhookMutationsService.ts` (side-effect dispatch), `server/adapters/ghlAdapter.ts` (location-token wiring on 10 fetch methods).

## 9. Done definition

- [ ] All 6 phases complete; tests pass (lint + typecheck baseline maintained)
- [ ] Verification gate Stage 6a (trial agency) passed: zero permission errors, all sub-accounts enumerable, INSTALL + UNINSTALL flows work end-to-end
- [ ] Verification gate Stage 6b (design-partner agency) passed against real client data
- [ ] `tasks/builds/ghl-module-c-oauth/verification-report.md` written
- [ ] `docs/clientpulse-soft-launch-blockers-brief.md` Item 2 marked CLOSED
- [ ] `docs/capabilities.md` updated: GHL connector listed as agency-level production-ready
- [ ] `docs/integration-reference.md` GHL section updated with the agency vs location token model
- [ ] `pr-reviewer` clean

## 10. Open questions (business + ops)

1. **Test agency — RESOLVED (two-stage):** GHL Agency Pro 14-day trial for Stage 6a (own account, no risk to real clients), design-partner agency for Stage 6b (real-world validation). Cutover criterion: all 6a checks green before contacting partner.
2. **Agency-token scope on read endpoints** — until Stage 6a verifies, we don't know which endpoints accept the agency token directly vs require location-token swap. Default posture: assume swap required; revisit if 6a shows the agency token works on a given endpoint.
3. **`choosecompany` URL** — GHL docs ambiguous on whether agency-targeted apps use a different install URL or just the `user_type=Company` token-exchange parameter. Resolve empirically in Phase 0 (the developer portal will tell us when we configure the app).
4. **Marketplace listing path** — out of scope for this spec; tracked separately at Phase 5 of ClientPulse.

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agency token doesn't work on per-location endpoints | Medium | High (Phase 4 forced) | Build location-token helper from day 1; assume swap is required |
| GHL API version drift between dev and verification | Low | Medium | Pin `Version: 2021-07-28` header on all calls (already convention) |
| Pagination edge cases on large agencies | Medium | Medium | Cap at 1000 with operator warning; full pagination test in Phase 3 |
| Webhook retry storms on transient 5xx | Low | Medium | Idempotency via webhook_id dedupe (existing) |
| Trial agency expires mid-build | Low | Medium | Stage 6a is short; if trial lapses, start a new one. Build does not depend on persistent trial state. |
| Design-partner agency unavailable when 6b is ready | Low | Medium | Surface 1 week before 6b in user check-in; if unavailable, hold at 6a-green and ship behind a feature flag for the partner-only later |
| `companies.readonly` not granted on existing tokens | High | Low (no installs yet) | Re-consent flow deferred to ClientPulse Phase 5; net-new installs land with the right scope |
