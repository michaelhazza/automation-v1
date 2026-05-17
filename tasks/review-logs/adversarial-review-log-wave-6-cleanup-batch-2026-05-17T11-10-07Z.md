# Adversarial Review Log

**Branch:** claude/wave-6-cleanup-batch
**Commit:** 5cddc767
**Reviewed at:** 2026-05-17T11:10:07Z
**Reviewer:** adversarial-reviewer (Claude Sonnet 4.6)

**Files reviewed:**
- server/services/agentExecutionService/runLifecycle/persistRun.ts
- server/services/agentExecutionService/runLifecycle/complete.ts
- server/services/agentExecutionService/runLifecycle/configure.ts
- server/services/agentExecutionService/runLifecycle/loadContext.ts
- server/services/agentExecutionService/runLifecycle/prepare.ts
- server/services/workspaceMemoryService/read.ts
- server/jobs/lib/definePruneJob.ts
- server/jobs/skillAnalyzerJob.ts (re-exports)
- server/jobs/skillAnalyzerJob/orchestrator.ts
- server/jobs/skillAnalyzerJob/stage5Classify.ts (mergeRationale guard context)
- server/routes/operatorSessionConnections.ts
- server/services/operatorSessionService.ts
- server/lib/orgScopedDb.ts
- server/middleware/auth.ts
- server/instrumentation.ts (withOrgTx / getOrgTxContext)
- migrations/0325_operator_session_consents.down.sql
- migrations/0326_operator_session_columns.down.sql
- migrations/0368_agent_execution_log_edits_entity_type_check.sql
- migrations/0368_agent_execution_log_edits_entity_type_check.down.sql
- migrations/0369_operator_session_usability_state_check.sql
- migrations/0369_operator_session_usability_state_check.down.sql

---

**Verdict:** HOLES_FOUND (1 likely-hole, 2 worth-confirming)

---

## Threat-Model Checklist

### 1. RLS / Tenant Isolation

**likely-hole — operatorSessionService.listForSubaccount missing organisationId predicate**

`server/services/operatorSessionService.ts:532-546` and `557-571`

Both the initial SELECT and the re-read SELECT in `listForSubaccount` filter only on `subaccountId`, `authType`, and `connectionStatus`. The `organisationId` predicate is absent from both queries — and from the `connectForAgent` version that was fixed within this same wave-6 batch (see the explicit `Wave 6 Q pr-reviewer should-fix #1` comment at line 464 of `listAllowedSubscriptionsForAgent`, which added `eq(integrationConnections.organisationId, input.organisationId)`).

Attack scenario: `integration_connections` is RLS-protected (in `rlsProtectedTables.ts` with policy from migration 0168), so the RLS layer will silently enforce the org boundary at the Postgres layer. However, DEVELOPMENT_GUIDELINES §1 requires application-code `organisationId` filtering even with RLS. The absence here means a hypothetical RLS misconfiguration or bypass on `integration_connections` would expose all-subaccount connections across orgs. The co-located fix in `listAllowedSubscriptionsForAgent` was applied in this exact wave but the sibling method was missed — an inconsistency introduced in the same batch that drew attention to the gap.

Suggested fix: Add `eq(integrationConnections.organisationId, input.organisationId)` to both WHERE clauses in `listForSubaccount` (lines 537 and 562), matching the pattern applied to `listAllowedSubscriptionsForAgent`.

---

### 2. Auth & Permissions

No new routes added in this diff. All existing routes in `operatorSessionConnections.ts` correctly chain `authenticate → requireSubaccountPermission → resolveSubaccount`. The UUID validation added at `operatorSessionConnections.ts:495` (`z.string().uuid().parse(req.params.agentId)`) for OSI-DEF-7 is correctly placed before the service call.

No confirmed or likely holes in auth/permissions from this diff.

---

### 3. Race Conditions

**worth-confirming — make-default FOR UPDATE relies on outer request transaction**

`server/routes/operatorSessionConnections.ts:263-344`

The `make-default` handler uses `FOR UPDATE` locking. It relies on `getOrgScopedDb()` returning the request-scoped transaction opened by `authenticate` (via `withOrgTx`). The `FOR UPDATE` lock and subsequent UPDATEs ARE within the same Postgres transaction (the outer request tx). This is architecturally correct.

Note: the comment at `auth.ts:59` says "Data-consistency boundaries (atomic writes across multiple tables) should use a nested `db.transaction()` call inside the service, not rely on this outer tx." The make-default handler does NOT use a nested `db.transaction()`. Not directly exploitable; downgrade to worth-confirming.

**workspaceMemoryService.updateSummary SELECT FOR UPDATE — TOCTOU confirmed closed**

`server/services/workspaceMemoryService/read.ts:129-162`

The `SELECT ... FOR UPDATE` at line 133-134 is correctly placed inside `getOrgScopedDb(...).transaction()`. Concurrent writers serialize correctly. TOCTOU is closed.

---

### 4. Injection

**worth-confirming — extraWhere regex `/i` flag over-permissiveness**

`server/jobs/lib/definePruneJob.ts:55`

The `/i` (case-insensitive) flag applies to the entire pattern, including the column-name character class `[a-z][a-z0-9_]*`. With `/i`, uppercase column names like `Status`, `PinnedAt` would pass validation. Postgres case-folds identifiers, so this is not an injection vector but is a slight over-acceptance.

The string-literal branch `'[^';\\]*'` correctly blocks semicolons, backslashes, and single-quote escape sequences. No injection bypass is possible via the regex itself.

`preDeleteGUC.name` and `.value` at `definePruneJob.ts:112,142` are passed as parameterized bindings in drizzle's `sql` template literal (not `sql.raw()`), so SQL injection via the GUC path is not possible.

---

### 5. Resource Abuse

No new loops, queue payloads, or recursive invocation paths introduced. The `skillAnalyzerJob` short-circuit guard for null `mergeRationale` is a resource-conservation fix.

---

### 6. Cross-Tenant Data Leakage

Cross-references the RLS/tenant finding above (Category 1). The `listForSubaccount` missing `organisationId` predicate is the only finding in this category.

---

## STRIDE Sweep

**Spoofing:** UUID validation on `agentId` path param (OSI-DEF-7) tightens one surface. No applicable spoofing risk introduced.

**Tampering:** The `organisationId` predicate added to the `agentRuns` UPDATE-claim path (`persistRun.ts:73-76`) is correctly applied. The `extraWhere` allowlist tightening removes a class of injection-based tamper vectors.

**Repudiation:** The `agentExecutionLogEdits` audit row in `updateSummary` is correctly inserted within the same transaction as the UPDATE. The CHECK constraint in migration 0368 tightens the `entity_type` enum on the audit table.

**Information disclosure:** `listForSubaccount` is the only candidate, already flagged.

**Denial of service:** No new unbounded loops or quota bypass vectors introduced.

**Elevation of privilege:** Token encryption assertion in `operatorSessionService.ts:224-226` (`token_encryption_required` guard) is correctly placed.

---

## Explicit Answers to the Five Caller Questions

1. **organisationId predicate siblings:** The W5K-ADV-2 fix in `persistRun.ts:73-76` is the only UPDATE in that file. Sibling UPDATE paths in `complete.ts` and `prepare.ts` do NOT have `organisationId` predicates — pre-existing patterns; RLS provides the backstop.

2. **SELECT FOR UPDATE TOCTOU closure:** Confirmed closed for the primary path.

3. **extraWhere regex bypasses:** No injection bypass is possible. Anchors `^...$` prevent multi-clause smuggling. `/i` flag is a minor over-acceptance, not exploitable.

4. **Down-migration ordering guards:** `0325.down.sql` uses `RAISE EXCEPTION` (hard guard). `0326.down.sql` uses `RAISE NOTICE` (soft warning). The asymmetry is intentional but a NOTICE could be missed by an operator.

5. **CHECK constraint migration safety:** Both 0368 and 0369 scan existing rows at migration time. Both values are exclusively written by TypeScript application code (closed enum); risk of orphaned values is low.

---

## Additional Observations

- `operatorSessionService.ts:75-94` (`mapToAiSubscriptionConnection`): `planTier` and `planVerificationStatus` are cast from the DB row without validation. Not exploitable but worth noting.

- `complete.ts:437-440` (`subaccountAgents.lastRunAt` UPDATE): Uses only `eq(subaccountAgents.id, request.subaccountAgentId)`. Pre-existing pattern; not introduced by this diff.
