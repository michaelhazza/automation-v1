# Adversarial Review Log — synthetos-foundation-refactor

**Reviewed files:** migrations 0307/0308/0309 (.sql + .down.sql); server/db/schema/agentRuns.ts, subaccountAgents.ts, subaccountAgentsGovernance.test.ts; server/routes/agentRuns.ts, credentials.ts, integrationConnections.ts, webLoginConnections.ts; service-layer reads of runTraceService.ts, credentialBrokerService.ts, policyEnvelopeResolver.ts, controllerStyleResolver.ts, subaccountAgentService.ts; shared/types/runTraceEvent.ts; server/schemas/subaccountAgents.ts.
**Timestamp:** 2026-05-09T13:15:00Z
**Branch:** claude/openclaw-worker-mode-VnjQT
**Build slug:** synthetos-foundation-refactor
**Reviewer model:** claude-sonnet-4-6
**Verdict:** HOLES_FOUND (1 confirmed-hole + 2 likely-holes routed to tasks/todo.md; 3 worth-confirming observations)

---

## Threat-model checklist

### 1. RLS / Tenant Isolation — no findings

`agent_runs` and `subaccount_agents` are already in `RLS_PROTECTED_TABLES`; spec INV-7 confirms new columns inherit existing policies. The three migrations add columns only; no policy changes required. The Run Trace UNION ALL query in `runTraceService.ts:111` runs on `db` directly but verifies `agent_runs.organisationId = orgId` at line 305 before any sub-query uses the runId. Application-level isolation is sound.

### 2. Auth & Permissions

#### Finding ADV-A — confirmed-hole — FIXED IN-BRANCH

`credentialBrokerService.revoke` accepted only `(organisationId, credentialId)` and the fallback UPDATE for subaccount-scoped connections filtered by `id + organisationId`, missing the subaccount predicate. The DELETE route at `server/routes/integrationConnections.ts:147` resolved subaccount-A but did not pass it to revoke. An actor with `CONNECTIONS_MANAGE` on subaccount-A could call `DELETE /api/subaccounts/<sub-A>/connections/<sub-B-connection-id>` and revoke a sibling subaccount's credential within the same org.

`webLoginConnections.ts:181` had a partial mitigation via `webLoginConnectionService.getById(req.params.id, req.orgId!, subaccount.id)` at line 187 (404s when connection isn't in subaccount), but the service-layer hole would still bite any future caller that skipped that pre-check.

**Fix applied:** `revoke` now requires `subaccountId: string | null`; the fallback UPDATE filters on `subaccountId` (and uses `IS NULL` when `null` for org-level revokes). Both DELETE routes pass `subaccount.id`. Test file updated. Lint + typecheck pass.

### 3. Race Conditions — no findings

Policy Envelope `persist` (policyEnvelopeResolver.ts:190-217) implements first-resolver-wins correctly: state-based `UPDATE WHERE policy_envelope_snapshot IS NULL`, re-read on zero rows, `PolicyEnvelopePersistFailedError` only when re-read fails. Both concurrent-resolver and deleted-row paths handled.

### 4. Injection — no findings

Run Trace UNION ALL uses Drizzle `sql` template tag; cursor decode uses base64 + NUL split on opaque parts and never interpolates into SQL. Malformed cursors throw `InvalidRunTraceCursorError` mapped to HTTP 400.

### 5. Resource Abuse — no findings

Run Trace caps `MAX_LIMIT = 200`; credential audit caps Zod `.max(200)` and service-layer default 50.

### 6. Cross-Tenant Data Leakage

#### Finding ADV-B — likely-hole — DEFERRED

`credentialBrokerService.injectIntoEnvironment` fetches connection by `connectionId` alone (lines 124-128) — no `organisationId` or `subaccountId` filter. Today only the unit-test file calls this method; the spec lists it as a `CredentialBroker` facade method but no production callers exist yet. The first production caller could pass an attacker-controlled `connectionId` (e.g., from a deserialized job payload) and decrypt another org's secret material into their environment dict.

**Severity:** medium. **Likelihood today:** low (no production callers). **Action:** defense-in-depth fix scheduled in tasks/todo.md before the first production caller lands.

#### Finding ADV-C — likely-hole — DEFERRED

`credentialBrokerService.audit` (lines 191-237) fetches the latest `limit` audit rows ordered by `createdAt DESC` filtered only by `organisationId + entityType = 'integration_connection'`, then applies the subaccount filter in application memory using `metadata.subaccountId` (a JSONB-extracted value). Two concerns:

1. **Pagination correctness.** In a high-event org the first 50 rows can be entirely from other subaccounts, returning zero rows to the caller — silently masking subaccount-A's audit history.
2. **JSONB-source filter.** Trust in `metadata.subaccountId` requires every `auditService.log` call site for `entityType: 'integration_connection'` to set `metadata.subaccountId` from a server-validated `subaccount.id`. If any caller writes user-controlled data into that field, the filter can be bypassed.

**Severity:** medium for correctness, lower for injection (depends on call-site audit). **Action:** push the subaccount filter into SQL via `metadata->>'subaccountId' = $`, or carry a first-class `subaccount_id` column on `audit_events` for credential events. Routed to tasks/todo.md.

---

## Other observations (not separate findings)

- **`claude-code` executionMode derives `native` not `operator`** (`server/services/controllerStyleResolver.ts`). Spec §4.1.6 maps `claude-code → operator`; implementation only maps `iee_browser` and `iee_dev`. Conservative-but-divergent. Correctness gap, not a security gap. Routed to spec-conformance follow-up consideration.
- **`controllerStyle` route param not validated against closed enum.** `server/routes/agentRuns.ts:39` types as `string` and a non-`'native' | 'operator'` value silently maps to the `default` branch in `deriveControllerStyle`. Should reject with 400. Correctness only.
- **`require_approval_at_tier` CHECK 0–7 vs spec text 0–6.** `migrations/0307_subaccount_agents_governance.sql:14` allows 7 as a sentinel ("never require"). Implementation is internally consistent; spec SQL block contradicts itself between §3.6 narrative and §5.2.9 SQL.

---

## Summary table

| # | Label | Area | Status |
|---|-------|------|--------|
| ADV-A | confirmed-hole | Auth / cross-subaccount revoke | FIXED IN-BRANCH (this commit) |
| ADV-B | likely-hole | Auth / scope bypass on inject | DEFERRED to tasks/todo.md |
| ADV-C | likely-hole | Cross-tenant leakage / audit JSONB | DEFERRED to tasks/todo.md |

**Verdict:** HOLES_FOUND. ADV-A closed in-branch; ADV-B and ADV-C routed to tasks/todo.md for follow-up. Phase 1 advisory; non-blocking for the current pipeline.
