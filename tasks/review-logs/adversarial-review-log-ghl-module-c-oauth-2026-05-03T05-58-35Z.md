# Adversarial Review Log — ghl-module-c-oauth

**Build slug:** ghl-module-c-oauth
**Branch:** ghl-agency-oauth
**Reviewed at:** 2026-05-03T05:58:35Z
**Reviewer:** `adversarial-reviewer` (Phase 1 advisory; non-blocking)
**Spec:** `docs/ghl-module-c-oauth-spec.md`

**Verdict:** HOLES_FOUND (2 confirmed-holes, 3 likely-holes, 5 worth-confirming)

**Reviewed files:** migrations 0268/0269 (+ _down), server/adapters/ghlAdapter.ts, server/config/{oauthProviders,rlsProtectedTables}.ts, server/db/schema/{connectorConfigs,connectorLocationTokens}.ts, server/jobs/connectorPollingTick.ts, server/lib/{ghlOAuthStateStore,webhookDedupe}.ts, server/routes/{ghl,oauthIntegrations,webhooks/ghlWebhook}.ts, server/services/{connectorConfigService,ghlAgencyOauthService,ghlAgencyOauthServicePure,ghlWebhookMutationsService,ghlWebhookMutationsPure,locationTokenService}.ts.

---

## Contents

1. RLS / Tenant Isolation
2. Auth & Permissions
3. Race Conditions
4. Injection
5. Resource Abuse
6. Cross-Tenant Data Leakage
7. Summary Table
8. Additional Findings (not expanded)

---

## 1. RLS / Tenant Isolation

### confirmed-hole — UNINSTALL handler writes to RLS-protected tables without an admin connection

**File:line:** `server/services/ghlWebhookMutationsService.ts:169-181`

**Attack scenario:** The UNINSTALL handler runs inside `dispatchWebhookSideEffects` which is called from the unauthenticated webhook route. There is no `app.organisation_id` session variable set on the `db` connection. Both `connector_configs` and `connector_location_tokens` have `FORCE ROW LEVEL SECURITY` enabled (migration 0269; rlsProtectedTables.ts). Drizzle's `db.update()` calls at lines 169-175 and 176-181 will be silently filtered to zero rows by RLS — the connector's status is never set to `disconnected` and the location tokens are never soft-deleted. A GHL UNINSTALL webhook therefore leaves the agency token and all location tokens alive in the database. An attacker who uninstalls the GHL app while retaining the raw agency token (or who replays an UNINSTALL event) can cause the platform to believe the connection is still active while GHL considers it revoked, leading to repeated failed outbound API calls. The encryption-at-rest tokens remain readable to the platform indefinitely.

**Contrast:** `connectorConfigService.ts:408-416` (the 401-revoke path) correctly uses `withAdminConnection` for the identical status update. The UNINSTALL handler does not.

**Severity: CRITICAL**

### likely-hole — `enumerateAgencyLocations` does not validate `loc.companyId` matches the agency connection

**File:line:** `server/services/ghlAgencyOauthService.ts:148-151`

**Attack scenario:** `GhlLocation` has a `companyId` field. The GHL `/locations/search` API is queried with a `companyId` filter parameter, but if GHL ever returns locations whose `companyId` differs from `agencyConnection.companyId` (server-side bug, token mis-routing, future API change), those locations are upserted into `subaccounts` under Org A's `connector_config_id` without any check. A rogue GHL agency token that somehow has cross-company scope would enroll another company's locations as sub-accounts of the wrong org. The fix is a server-side filter: `page.filter(loc => loc.companyId === companyId)` before `all.push(...)`.

**Severity: HIGH**

### worth-confirming — `refreshLocationToken` writes by row ID without `isNull(deletedAt)` guard

**File:line:** `server/services/locationTokenService.ts:212-220`

The `UPDATE connector_location_tokens SET ... WHERE id = tokenRowId` does not include `AND deleted_at IS NULL`. If the token row is soft-deleted between the time `getLocationToken` reads it (line 44) and the time `refreshLocationToken` writes to it (line 212), the update lands on a soft-deleted row — invisible to future reads. The next `getLocationToken` call mints a new row (parallel double-mint). Adding `isNull(connectorLocationTokens.deletedAt)` to the WHERE clause closes the window.

**Severity: MEDIUM**

---

## 2. Auth & Permissions

### confirmed-hole — OAuth callback does not verify current session org matches state nonce org

**File:line:** `server/routes/oauthIntegrations.ts:307-414`

**Attack scenario:** The `/api/oauth/callback` route is unauthenticated by design. The state nonce encodes an `orgId`. At callback time the route calls `consumeGhlOAuthState(state)` which returns the `orgId` and immediately uses it to upsert the agency connection. There is no check that the browser session at callback time belongs to a user who is a member of `ghlOrgId`.

Steps:
1. Attacker (Org A) starts OAuth flow, receives nonce N bound to orgA (10-min TTL).
2. Before completion, attacker copies the GHL redirect URL (which contains `state=N`).
3. Victim user (Org B) is tricked into visiting it (phishing, iframe).
4. GHL exchanges the code; callback fires; `consumeGhlOAuthState(N)` returns `orgA`; the agency token GHL granted (against Org B's GHL account if Org B was the GHL-side authoriser) is stored under Org A.

The real risk is the reverse — Org B completing Org A's install — which leaks Org B's GHL credentials into Org A's namespace.

**Mitigation:** Add a secondary verification that the user completing the callback is authenticated and belongs to `ghlOrgId`. Alternatively, bind the nonce to a session fingerprint and verify it at callback time.

**Severity: HIGH**

### likely-hole — Lifecycle HMAC verification skips when `GHL_WEBHOOK_SIGNING_SECRET` is unset, with no hard-block in production

**File:line:** `server/routes/webhooks/ghlWebhook.ts:50-66`

**Attack scenario:** If `GHL_WEBHOOK_SIGNING_SECRET` is not set (deployment env-var drift, misconfiguration), the code logs a warning and processes the lifecycle event without signature verification. An attacker who can POST to `/api/webhooks/ghl` can forge INSTALL/UNINSTALL events for any `companyId`, triggering `autoEnrolAgencyLocations` or marking the connection `disconnected`. Missing-env drift is a realistic production scenario.

**Severity: HIGH**

### worth-confirming — HMAC comparison could throw on length mismatch before `timingSafeEqual` (handled by catch but timing-observable)

**File:line:** `server/adapters/ghlAdapter.ts:286-295`

`crypto.timingSafeEqual` requires equal-length Buffers. A non-64-char-hex header makes lengths differ and `timingSafeEqual` throws — the `try/catch` returns `false`. Functionally correct but the throw path is timing-observable. Worth confirming the timing channel is not exploitable.

---

## 3. Race Conditions

### worth-confirming — Lifecycle dedupe store call discards the return value

**File:line:** `server/routes/webhooks/ghlWebhook.ts:91`

`webhookDedupeStore.isDuplicate(webhookId);` discards the return. On first delivery this marks-and-returns-false (correct). The dedupe check is reached only AFTER side effects succeed, so first-delivery is fine. But within the in-process TTL window, two requests passing `lifecycleTypes.has` concurrently can both reach dispatch. Worth confirming dedupe is checked BEFORE dispatch.

### worth-confirming — `refreshLocationToken` and `getLocationToken` are not transactionally coupled

**File:line:** `server/services/locationTokenService.ts:47-51` (read) vs `152-220` (refresh write)

Two concurrent callers for the same `(configId, locationId)` could both read the near-expiry row, both enter `refreshLocationToken`, and both call GHL's `/oauth/token` with the same refresh token. GHL may rotate refresh tokens on use → the second caller gets 401 → 401 handler soft-deletes and re-mints, burning a new token. The in-process `mintInFlight` map guards minting, not refreshing — a parallel refresh guard is absent.

---

## 4. Injection

No confirmed injection holes. All SQL uses Drizzle parameterised calls or `sql\`...\`` tagged templates. Webhook body parsing does not propagate user-controlled strings into SQL fragments.

### worth-confirming — prompt injection surface via `loc.name` in `subaccounts.name`

**File:line:** `server/services/ghlAgencyOauthServicePure.ts:116-119` / `server/services/ghlAgencyOauthService.ts:196`

`generateSubaccountSlug` sanitises the name via regex (`[^a-z0-9]+`), so SQL/path injection is not possible. But the raw location name is stored as-is in `subaccounts.name`. If `loc.name` is later rendered in an agent prompt or log without escaping, it is a prompt-injection surface. Out of scope for this review — flag for downstream awareness.

---

## 5. Resource Abuse

### worth-confirming — `enumerateAgencyLocations` cap can briefly overflow

**File:line:** `server/services/ghlAgencyOauthService.ts:100-151`

The while-loop exits when `all.length >= GHL_LOCATION_CAP` (1000) or `page.length < GHL_PAGINATION_LIMIT` (100). If GHL returns more than 100 items in a page (ignoring `limit`), each push could briefly exceed 1000 (e.g. 990 + 200 = 1190). `all.push(...page)` does not slice to the remaining cap budget. Over-enrollment risk.

### worth-confirming — `withBackoff` retries up to 4 attempts × 10 pages = 40 calls per enumeration

**File:line:** `server/services/ghlAgencyOauthService.ts:136-147`

Worst-case wall time ~10 pages × (4 attempts × up to 4s delay) = 160s per enumeration. The OAuth callback wraps it in a 15s timeout (line 403-408), but the `install_company` webhook path does not. No global circuit breaker.

---

## 6. Cross-Tenant Data Leakage

### note — `findAgencyConnectionByCompanyId` filters status≠disconnected; no `deletedAt`-based leak

**File:line:** `server/services/connectorConfigService.ts:346-360`

`connector_configs` is a hard-delete table; the `ne(connectorConfigs.status, 'disconnected')` filter is sufficient. However, since the UNINSTALL handler has the RLS bug (#1 above), rows are never updated to `disconnected`, so `findAgencyConnectionByCompanyId` could return a still-`active` row for an uninstalled agency indefinitely. Cross-references finding #1.

No log lines were found that include raw tokens or credentials. The 409 error message `agency_already_installed_under_different_org` does not leak which other org has it.

---

## 7. Summary Table

| # | Category | Label | File:line | Severity |
|---|----------|-------|-----------|----------|
| 1 | RLS/Tenant Isolation | confirmed-hole | ghlWebhookMutationsService.ts:169-181 | CRITICAL |
| 2 | Auth/Permissions | confirmed-hole | oauthIntegrations.ts:307-414 | HIGH |
| 3 | RLS/Tenant Isolation | likely-hole | ghlAgencyOauthService.ts:148-151 | HIGH |
| 4 | Auth/Permissions | likely-hole | ghlWebhook.ts:50-66 | HIGH |
| 5 | RLS/Tenant Isolation | worth-confirming | locationTokenService.ts:212-220 | MEDIUM |
| 6 | Race Conditions | worth-confirming | ghlWebhook.ts:91 (webhookDedupe) | LOW |
| 7 | Race Conditions | worth-confirming | locationTokenService.ts:44-51 | LOW |
| 8 | Injection | worth-confirming | ghlAgencyOauthServicePure.ts:116-119 | LOW |
| 9 | Resource Abuse | worth-confirming | ghlAgencyOauthService.ts:100-151 | LOW |
| 10 | Resource Abuse | worth-confirming | ghlAgencyOauthService.ts:136-147 | LOW |

---

## 8. Additional Findings (not expanded)

- `ghlOAuthStateStore.ts` is in-memory, not cluster-safe — documented in a comment, but no runtime assertion guards against multi-instance deployment.
- `connectorPollingTick.ts:65-70` uses the plain `db` handle (no org context) to read `integrationConnections`. Pre-existing cross-org read with no RLS bypass guard. Inconsistent with the new `refreshNearExpiryAgencyTokens` which correctly uses `withAdminConnection`.
- `locationTokenService.ts:149` returns the unencrypted `data.access_token` directly after a successful mint rather than decrypting from the inserted row. Functionally correct but bypasses symmetric round-trip verification.
