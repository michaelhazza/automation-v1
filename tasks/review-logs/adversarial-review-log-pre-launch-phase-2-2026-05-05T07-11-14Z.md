# Adversarial Review Log — pre-launch-phase-2

**Branch:** claude/pre-launch-phase-2
**Timestamp:** 2026-05-05T07:11:14Z
**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes)

---

## Contents

1. RLS / Tenant Isolation — Finding 1.1
2. Auth & Permissions — Findings 2.1, 2.2
3. Race Conditions — Finding 3.1
4. Injection — Finding 4.1
5. Resource Abuse — Finding 5.1
6. Cross-Tenant Data Leakage — Finding 6.1
7. Additional Observations (all PASS)
8. Summary

---

## 3. Race Conditions

**Finding 3.1 — `likely-hole`: Advisory lock scope ambiguity for pg-boss dispatch**

`server/services/workflowEngineService.ts:840, 1897-1924` — The concurrent-tick `pg_try_advisory_xact_lock` at line 840 is `xact`-scoped (releases on transaction commit). If `pgboss.send()` at line 1897 executes outside the same DB transaction, two concurrent worker callbacks could both acquire the advisory lock in separate transactions and both enqueue the same agent step. The `singletonKey: \`Workflow-step:${sr.id}:${sr.attempt}\`` provides pg-boss-level deduplication, collapsing duplicates to one job. This makes the race a theoretical risk given the singletonKey defence — but the advisory lock scope should be confirmed. Routed to `tasks/todo.md`.

---

## 4. Injection

**Finding 4.1 — `worth-confirming`: PII blacklist in `normaliseSecurityEvent` is exact-key-match only**

`server/services/securityAuditServicePure.ts:31-38` — `PII_BLACKLIST` matches exact keys: `password`, `token`, `secret`, `authorization`. Does not match composites like `accessToken`, `refreshToken`, `passwordHash`, `clientSecret`. Current callers pass known-safe payloads. Risk is future callers inadvertently logging credential material. Routed to `tasks/todo.md`.

**SQL injection: PASS.** All queries use parameterised Drizzle ORM or tagged `sql` template literals.

**Rate-limit key injection: PASS.** User-supplied IP/email values go through ORM parameterisation at `inboundRateLimiter.ts:110`.

---

## 5. Resource Abuse

**Finding 5.1 — `likely-hole`: Login rate limiter keyed on `ip:email` — bypassable via IP rotation**

`server/lib/rateLimitKeys.ts:24-28`, `server/routes/auth.ts:64-77` — Both short-window (10/60s) and long-window (50/3600s) limits key on `ip:email`. Each IP has its own bucket. A 50-node botnet rotating IPs submits up to 2,500 attempts per hour against the same target email, all within per-IP limits. The comment calling this "credential-stuffing prevention" implies a stronger per-email guarantee than exists. A separate email-keyed bucket (`rl:v1:auth:login:email:<email>`) would close the gap. Design-decision — routed to `tasks/todo.md`.

---

## 6. Cross-Tenant Data Leakage

**Finding 6.1 — `worth-confirming`: `connectionTokenService.refreshIfExpired` relies on caller discipline for org scoping**

`server/services/connectionTokenService.ts:147-174` — `refreshIfExpired` updates `integrationConnections` by `id` only. The `guard-ignore-next-line` comment asserts "connection object passed in by caller who obtained it via org-scoped query." No service-layer assertion enforces this. A future caller fetching by bare ID and passing to this method could update across tenant boundaries. Routed to `tasks/todo.md` for caller-discipline audit.

**Shared webhook dedup caches: PASS.** In-memory, keyed by `externalEventId`. Collision suppresses an event, does not expose data.

**Rate-limit bucket cross-tenant: PASS.** Keyed by opaque strings (user IDs, IPs, emails). No org-scoped data in bucket values.

---

## 7. Additional Observations (all PASS)

- `oauthIntegrations.ts:169-170`: `errorReturnPath` extracted from a server-signed JWT (verified before use). Open-redirect not feasible without forging the server JWT. PASS.
- `oauthIntegrations.ts:159-170`: `oauthError` passed to `encodeURIComponent` before appending to redirect URL. No reflected XSS. PASS.
- `ghlOAuthStateStore.ts:23-34`: `consumeGhlOAuthState` uses `DELETE ... RETURNING` for atomic single-use nonce consumption. PASS.
- `middleware/auth.ts:104-106`: System admin org override correctly records `targetOrganisationId` in audit and security events. PASS.
- `actionCallAllowlist.ts`: Zero production callers — gate not yet wired. Known open item per plan. Advisory only.

---

## 8. Summary

| Finding | Severity | Status |
|---------|----------|--------|
| 2.1 — Signup JWT revoked on first use (clock skew) | confirmed-hole | Fixed in-session |
| 3.1 — Advisory lock scope for pg-boss dispatch | likely-hole | Routed to todo.md |
| 5.1 — Login rate limiter bypassable via IP rotation | likely-hole | Routed to todo.md |
| 1.1 — Sentinel UUID for login-failure audit rows | worth-confirming | Routed to todo.md |
| 2.2 — `requireSubaccountPermission` no audit event | worth-confirming | Routed to todo.md |
| 4.1 — PII blacklist exact-match only | worth-confirming | Routed to todo.md |
| 6.1 — `connectionTokenService` caller discipline | worth-confirming | Routed to todo.md |

---

## 1. RLS / Tenant Isolation

**Finding 1.1 — `worth-confirming`: `security_audit_events` login-failure rows use sentinel UUID `00000000-0000-0000-0000-000000000000`**

`server/routes/auth.ts:92` — On login failure the service records a security event with `organisationId: '00000000-0000-0000-0000-000000000000'`. The RLS `WITH CHECK` passes because the GUC matches the row field. No FK constraint on `security_audit_events.organisation_id` — intentional for pre-auth events. Consequence: any future join on `organisations.id` silently drops login-failure rows; org-scoped admin queries are blind to them. Logging-completeness concern only — no tenant isolation hole today.

**Migration 0281 RLS shape: PASS.** `FORCE ROW LEVEL SECURITY` present; canonical `WITH CHECK` clause matches existing policy template; `rlsProtectedTables.ts` entry added.

**Migration 0282 backfill: PASS.** Existing users backfilled to epoch (`1970-01-01`), preventing JWT revocation on deploy.

---

## 2. Auth & Permissions

**Finding 2.1 — `confirmed-hole`: Signup JWT revoked on first use under DB/Node clock skew**

`server/services/authService.ts:277-288` — `signup()` inserts the user without explicitly setting `passwordChangedAt`, relying on the column default `now()`. JWT is then signed at Node.js application time. The forced-logout check at `server/middleware/auth.ts:90` fires when `userRow.passwordChangedAt.getTime() > issuedAtMs`. Because `passwordChangedAt` is microsecond-precision from the DB clock and JWT `iat` is second-precision from the Node.js clock, even millisecond drift causes the new user's very first authenticated request to return HTTP 401 `token_revoked`. Security audit event fires as if password was changed — noise that could train operators to ignore real events.

Same root cause applies to the `acceptInvite` path (`authService.ts:101-116`) at lower probability.

Fix: set `passwordChangedAt: new Date(0)` (epoch) in both `signup()` and `acceptInvite()` inserts/updates, matching the migration-0282 backfill pattern. **Fixed in this session.**

---

**Finding 2.2 — `worth-confirming`: `requireSubaccountPermission` emits no `auth.permission_denied` security event**

`server/middleware/auth.ts:349-394` — `requireOrgPermission` (line 318-328) records `auth.permission_denied` on denial; `requireSubaccountPermission` does not. Subaccount denials are a lateral-movement surface (attacking from one subaccount context into another). The check fires correctly — this is an audit-stream gap, not a direct hole.

---
