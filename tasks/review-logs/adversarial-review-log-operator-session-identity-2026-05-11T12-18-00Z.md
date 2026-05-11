# Adversarial Review Log — operator-session-identity

**Branch:** claude/evolve-session-identity-brief-17LO4
**Build slug:** operator-session-identity
**Spec:** docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md
**Timestamp:** 2026-05-11T12:18:00Z

**Files reviewed:**
- server/routes/operatorSessionConnections.ts
- server/services/operatorSessionService.ts
- server/services/operatorSessionConsentService.ts
- server/services/operatorSessionLifecycleService.ts
- server/services/operatorSessionLifecycleServicePure.ts
- server/services/credentialBrokerService.ts
- server/jobs/operatorSessionRefreshJob.ts
- server/lib/permissions.ts (new permission keys section)
- server/config/operatorSessionProviders.ts
- server/schemas/operatorSessionConnections.ts
- server/config/rlsProtectedTables.ts (new entries)
- migrations/0321_operator_session_consents.sql
- migrations/0322_operator_session_columns.sql
- server/db/schema/integrationConnections.ts (new columns)
- server/middleware/auth.ts (transaction model verification)
- server/lib/orgScopedDb.ts (contract verification)

**Verdict:** HOLES_FOUND (2 confirmed-holes, 3 likely-holes)

---

## 1. RLS / Tenant Isolation

### confirmed-hole — C1

**File:** `server/services/credentialBrokerService.ts` lines 4, 96, 177, 242, 307, 355, 377

`credentialBrokerService` imports and calls the bare `db` admin handle throughout — including the new `operator_session` branch of `issueCredential` (lines 116-143) and the entire new `resolveAvailableCredentials` method (lines 355-389). The project rule (DEVELOPMENT_GUIDELINES §1, §2) is explicit: services must call `getOrgScopedDb()`, not bare `db`. The bare `db` handle is not bound to an org-scoped transaction and relies entirely on the RLS policy as the single isolation control.

Attack scenario: Any future background job or system-tier caller that calls `credentialBrokerService.resolveAvailableCredentials` or `issueCredential` without an active `withOrgTx` context (e.g. a new job that forgets to set up the org tx, or a test harness running outside the request pipeline) will have no Layer A guard (the `getOrgScopedDb` missing-context throw). The RLS policy on `integration_connections` will then be the only isolation control — which is the backup layer, not the primary. More critically, if any caller acquires the service inside a `withAdminConnection` block (which uses `BYPASSRLS`), the explicit `organisationId` predicate in the query is the only guard, and there is no assertion that the `organisationId` parameter is caller-supplied and not attacker-controlled.

Suggested fix: Replace every `db.select/update/execute` call in `credentialBrokerService.ts` with `getOrgScopedDb('credentialBrokerService.<method>')`. This is the same fix applied to every other service during the 2026-04-25 audit remediation.

### likely-hole — L1

**Files:**
- `server/services/operatorSessionService.ts` line 427 (reaccept UPDATE)
- `server/jobs/operatorSessionRefreshJob.ts` line 142 (token refresh UPDATE)

Both UPDATE statements against `integration_connections` filter only by `id`, relying solely on the RLS session variable for org isolation:

- `operatorSessionService.reaccept` line 427: `UPDATE ... WHERE id = $connectionId` — no `organisationId` predicate.
- `operatorSessionRefreshJob.processRefresh` line 142: `UPDATE ... WHERE id = $connectionId` — no `organisationId` predicate.

DEVELOPMENT_GUIDELINES §1 states: "Always filter by `organisationId` in application code, even with RLS. Reads and writes by ID must include an explicit `eq(items.organisationId, organisationId)`."

Attack scenario (refresh job): The sweep job fetches `connectionId` and `organisationId` from a cross-tenant admin read, then opens `withOrgTx(orgId)` and calls `getOrgScopedDb`. If the admin-level lookup in step 1 ever returns a mismatched pair (a bug in a future sweep join, or a timing issue where the connection is reassigned), the `withOrgTx` would be set to the wrong org, and the bare-id UPDATE would overwrite that connection's tokens without any org-level application assertion catching the mismatch. The RLS policy would not catch it either because the GUC is set to the (potentially wrong) org.

What would confirm: Whether the admin-level lookup in `processOperatorSessionRefresh` is guaranteed to always return `(id, organisation_id)` from the same physical row, with no race between the lookup and the org-tx open.

### likely-hole — L2

**File:** `server/routes/operatorSessionConnections.ts` lines 120-124

The re-read after `detectAndTransitionStaleDisclosure` filters only by connection id:

```typescript
const [fresh] = await db
  .select()
  .from(integrationConnections)
  .where(eq(integrationConnections.id, conn.id))  // no organisationId filter
  .limit(1);
```

Within the active request `withOrgTx` context, RLS enforces org scoping. However, DEVELOPMENT_GUIDELINES §1 requires an explicit `organisationId` predicate on every by-ID query. If the RLS policy on `integration_connections` is ever dropped or misconfigured (e.g. during a corrective migration that forgets to recreate it), this re-read would return rows from any tenant matching the ID.

Suggested fix: Add `eq(integrationConnections.organisationId, req.orgId!)` to the re-read WHERE clause.

## 2. Auth & Permissions

No confirmed or likely holes. Permission keys are correctly named, registered in `ALL_PERMISSIONS`, and applied consistently to all 10 new routes. All routes call `resolveSubaccount` before consuming `:subaccountId`.

### worth-confirming — W1

**File:** `server/routes/operatorSessionConnections.ts` lines 432-447

`GET /api/subaccounts/:subaccountId/agents/:agentId/allowed-subscriptions` passes `req.params.agentId` directly to the service without validating that the agent belongs to the calling subaccount. The `agentId` is used only inside a JSONB containment filter (`allowedAgentIds ? $agentId::text`) to determine which `specific_agents` connections to include. The data returned is scoped to the resolved subaccount, so no credential material from other subaccounts is exposed. However, a caller who knows an agent UUID from a different subaccount could probe whether that agent is in any `specific_agents` allowlist on the target subaccount, potentially confirming a cross-subaccount agent-identity relationship.

What would confirm: Whether cross-subaccount agent UUIDs are considered sensitive identifiers in this access model.

## 3. Race Conditions

### confirmed-hole — C2

**File:** `server/routes/operatorSessionConnections.ts` lines 248-304

The `POST make-default` handler uses a `SELECT ... FOR UPDATE` on the _current_ default row to prevent concurrent make-default races, then clears it, then promotes the new target. The `FOR UPDATE` has a structural gap:

1. When no row currently has `isDefault = true` (e.g. first-time default assignment or after a clear), the `FOR UPDATE` locks nothing — two concurrent requests can both proceed past the lock step simultaneously.
2. The promoted row itself is never locked before the promote UPDATE. Two concurrent requests promoting the same target could both see `isDefault = false` on the target row and both execute the promote, reaching the partial unique index constraint at the same time.

The partial unique index `ic_subaccount_operator_session_default_unique` (`WHERE auth_type = 'operator_session' AND is_default = true`) serves as the reactive guard and the `23505` catch block converts this to a 409. However, the window between the clear-old-default and the promote-new-default has no preventive subaccount-level lock, and the promote predicate does not include `AND is_default = false` (which would make it a CAS operation and make the 409 path unnecessary for the concurrent-promote case).

Attack scenario: Two concurrent users hit make-default simultaneously with different `connId` values. Both pass the `FOR UPDATE` guard (no current default), both execute the clear (no-op), and both execute the promote in a race. If the unique index constraint is checked at commit time (deferred scenario) or if Postgres serializes them differently, the result could briefly have two default rows before the constraint fires.

Suggested fix: (a) Add `SELECT id FROM integration_connections WHERE id = $connId FOR UPDATE` to lock the target row at the start; (b) add `AND is_default = false` to the promote predicate so it is a conditional update; (c) optionally use `pg_try_advisory_xact_lock(hashtext(subaccount_id || ':make_default'))` for a subaccount-level mutex.

## 4. Injection

No confirmed or likely injection holes. Drizzle's `sql` tagged template literal parameterizes all interpolated values including the JSONB containment operator query (`allowedAgentIds ? ${input.agentId}::text`). The `consentText` snapshot is stored verbatim but never executed, only returned as audit evidence.

### worth-confirming — W2

**File:** `server/routes/operatorSessionConnections.ts` line 442

`req.params.agentId` is passed to `listAllowedSubscriptionsForAgent` without UUID format validation at the route layer. It is subsequently interpolated into a parameterized JSONB `?` query — no SQL injection is possible — but a non-UUID agentId string would silently return an empty `specific_agents` result rather than a 400. Consider adding `z.string().uuid()` validation at the route level for consistency with other param-validation patterns in the codebase.

## 5. Resource Abuse

### likely-hole — L3

**File:** `server/jobs/operatorSessionRefreshJob.ts` lines 253-259

`runOperatorSessionRefreshSweep` issues an unbounded SQL scan with no LIMIT:

```sql
SELECT id, organisation_id
FROM integration_connections
WHERE auth_type = 'operator_session'
  AND connection_status = 'active'
  AND usability_state = 'connected_usable'
  AND token_expires_at <= $expiryThreshold
```

Attack scenario: At scale, if 50,000 operator_session connections are expiring in the same 30-minute window (plausible if a large org bulk-enrolls users), the sweep:
1. Holds a long-lived admin connection while fetching all rows into memory.
2. Enqueues all N jobs inside a single `withAdminConnection` transaction, potentially timing out the transaction or exhausting the pg-boss job queue write throughput.
3. The 5-minute bucket `singletonKey` deduplicates same-connection re-enqueues but does not cap the total number of distinct connections processed per sweep tick.

Per the architecture rule: "Maintenance jobs that advertise per-org partial-success use one admin transaction per organisation" — this sweep uses a single shared admin transaction across all orgs.

Suggested fix: Add `LIMIT 500` (configurable) to the sweep query and loop in batches, or restructure to process one org at a time per the `memoryDedupJob.ts` pattern.

## 6. Cross-Tenant Data Leakage

### worth-confirming — W3

**File:** `server/routes/integrationConnections.ts` lines 36-45

The existing `GET /api/subaccounts/:subaccountId/connections` generic list route (guarded by `CONNECTIONS_VIEW`) now returns operator_session rows after migration 0322, including `consentRecordId`, `usabilityState`, `planTier`, and `planVerificationStatus` fields. The `sanitizeConnection` function strips `accessToken`, `refreshToken`, and `secretsRef` but does NOT strip operator_session-specific columns.

`consentRecordId` is a UUID pointing into the legally-sensitive `operator_session_consents` consent audit table. Returning this to all `CONNECTIONS_VIEW` holders (not just `OPERATOR_SESSION_VIEW` holders) exposes consent record identifiers on the generic surface.

What would confirm: Whether the generic connections route is intended to expose operator_session rows at all, or whether those rows should be excluded from the generic list (`WHERE auth_type != 'operator_session'`) and served only through the dedicated operator session routes.

## Additional observations

- `migrations/0322_operator_session_columns.sql` — `usability_state` is added as unconstrained `text` with no `CHECK` constraint. The state machine enforcement is TypeScript-only. A raw DBA update or future migration bug could write an invalid state string without any DB-level rejection. The `auth_type CHECK` constraint in the same migration demonstrates the pattern is available and should be applied to `usability_state` as well.
- `server/services/operatorSessionConsentService.ts` line 197-209 — `minimisePiiForDeletedUser` is a V1 stub that throws `501`. If a user deletion flow calls this (or is expected to call this), the thrown 501 will propagate to the caller. Confirm the user deletion flow handles the 501 gracefully rather than failing the deletion.
- The `OPERATOR_SESSION_DISCLOSURE_VERSION = 1` constant in `server/config/operatorSessionProviders.ts` is hard-coded and requires a code deploy to bump. If the disclosure text changes urgently (e.g. a legal update), there is no DB-config or feature-flag path to increment the version without a deploy. Advisory only.
