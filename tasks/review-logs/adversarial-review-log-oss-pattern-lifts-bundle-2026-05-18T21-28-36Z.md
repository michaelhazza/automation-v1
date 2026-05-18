# Adversarial Review Log

**Build slug:** oss-pattern-lifts-bundle
**Timestamp (UTC):** 2026-05-18T21:28:36Z
**Reviewer model:** claude-sonnet-4-6 (adversarial-reviewer sub-agent)
**Phase:** Phase 1 advisory (non-blocking)

**Verdict:** HOLES_FOUND (0 confirmed-holes, 2 likely-holes, 4 worth-confirming)

## Files reviewed

- `migrations/0379_waitpoints_primitive.sql` + `.down.sql`
- `server/db/schema/waitpoints.ts`
- `server/config/rlsProtectedTables.ts` (waitpoints entry)
- `server/services/waitpointService.ts`
- `server/services/waitpointServicePure.ts`
- `server/jobs/agentRunResumeFromWaitpointJob.ts`
- `server/jobs/waitpointExpirySweepJob.ts`
- `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts`
- `server/config/jobConfig.ts`
- `server/services/agentExecutionLoop.ts` (OAuth CREATE)
- `server/services/agentResumeService.ts` (OAuth COMPLETE)
- `server/services/workflowEngine/queueLifecycle/dispatch.ts` (approval CREATE)
- `server/services/reviewService.ts` (approval COMPLETE)
- `server/services/workflowEngine/stepLifecyclePure.ts`

Supporting context: `server/lib/adminDbConnection.ts`, `server/lib/orgScopedDb.ts`, `server/lib/createWorker.ts`, `server/lib/pgBossTxSend.ts`, `server/lib/env.ts`, `shared/types/integrationCardContent.ts`, `server/services/taskConversationService.ts`, `server/routes/agentRuns.ts`, `server/routes/oauthIntegrations.ts`, `migrations/0368_rls_workflow_fk_scoped_tables.sql`.

---

## Threat-model checklist

### 1. RLS / Tenant isolation — PASS

Bulk UPDATE in `expireWaitpoints` is cross-org by design; `organisation_id` is extracted from RETURNING for all downstream operations. Every downstream SELECT and UPDATE in the per-row loop carries an explicit `AND organisation_id = ${orgId}::uuid` predicate — `waitpointService.ts:298, 338-340, 391, 430`. No bare `WHERE id = $1` lookup. `SET LOCAL ROLE admin_role` correctly scoped to single `db.transaction()` (`adminDbConnection.ts:87`). `workflow_step_runs` FORCE RLS bypassed by admin_role BYPASSRLS; org-predicate via `FROM workflow_runs WHERE wr.organisation_id = orgId` is the tenant boundary. `completeWaitpoint` UPDATE + fallback SELECT both carry `AND organisation_id` (`waitpointService.ts:129, 149`).

### 2. Auth & Permissions — PASS

No new routes. Existing resume route gated. Token format validated. Approval `waitpointId` server-set, not request body. `validateCompleteInputShapeMatchesKind` defence-in-depth.

### 3. Race conditions

**likely-hole (L1): Non-atomic waitpoint creation and agent_run block in OAuth path**

`agentExecutionLoop.ts:879` calls `waitpointService.createWaitpoint(...)` and then line 901 performs a separate `scopedDb.update(agentRuns).set({ blockedReason: 'integration_required', ... })`. These are NOT in the same transaction. If `agent_runs` UPDATE fails after INSERT INTO waitpoints commits, the waitpoint is orphaned: `status='pending'`, `bound_run_id` points to a run that was never blocked. Five minutes later the expiry sweep reads `run.status` (possibly `running` if loop was retried), then issues `UPDATE agent_runs SET status='cancelled' WHERE ... AND status=${run.status}` — silently cancelling a legitimate in-flight run.

Suggested fix: wrap `createWaitpoint` and `agent_runs` UPDATE in a single `getOrgScopedDb(...).transaction(...)` block, passing `{ tx: txHandle }` to `createWaitpoint`. The service already supports `opts.tx` at `waitpointService.ts:71-88`.

**likely-hole (L2): Single-transaction expiry sweep — one bad row poisons the entire batch**

`expireWaitpoints()` at `waitpointService.ts:241-481` runs inside ONE `withAdminConnection` transaction. Bulk UPDATE + all per-row cleanup share the same Postgres tx. If any per-row operation throws (e.g., malformed `resumePayload.workflowStepRunId` failing `::uuid` cast at line 390), the entire tx rolls back — every expired waitpoint reverts to pending. A deterministic per-row error bricks the sweep indefinitely. `DEVELOPMENT_GUIDELINES.md §2` prescribes per-org SAVEPOINT subtransactions for sweeps with partial-success semantics.

Suggested fix: (a) UUID-validate `stepRunId` at `waitpointService.ts:372-383` before SQL; and/or (b) wrap each per-row iteration in a SAVEPOINT.

**worth-confirming (W1): Two-step lookup then complete in OAuth resume**

`agentResumeService.ts:66-91` reads bound_run_id then calls `completeWaitpoint` in separate statements. Race window covered by `completeWaitpoint`'s optimistic predicate — 0 rows → `RESUME_TOKEN_EXPIRED` (410). Safe and idempotent; flagged for clarity since it diverges from the approval path's single-tx approach.

### 4. Injection — PASS (1 worth-confirming)

No raw SQL string concatenation. All variables bound via Drizzle `sql` tagged-templates. `::uuid` casts validate type at Postgres layer.

**worth-confirming (W2): `getJobConfig(resumeQueue as JobName)` with DB-sourced queue name**

`waitpointService.ts:191`: `getJobConfig(resumeQueue as JobName)` — `as JobName` is a runtime no-op. Unknown queue name → `JOB_CONFIG[name]` returns undefined → `jobCfg.retryLimit` throws TypeError, crashing `completeWaitpoint` AFTER the waitpoint was marked completed but BEFORE the resume job was enqueued. Single in-tree call site hardcodes `'agent-run-resume-from-waitpoint'`, so in-flight risk is low.

Suggested fix: add runtime guard before line 191: `if (!(resumeQueue in JOB_CONFIG)) throw failure('INTERNAL_ERROR', 'unknown resumeQueue')`.

### 5. Resource abuse — PASS

No new unbounded loops or recursive invocation. Expiry sweep has no LIMIT but follows `blockedRunExpiryJob` precedent. DoS risk via L2 covered above.

### 6. Cross-tenant data leakage

No new shared caches. Logs at `waitpointService.ts:93-100` exclude plaintext. `tokenHashPrefix` uses 8 hex chars only.

**worth-confirming (W3): Misleading comment vs actual plaintext-token storage in `agent_messages.meta`**

`shared/types/integrationCardContent.ts:21` comment says `// plaintext bearer token; never stored in DB column`. Both legacy and waitpoint paths store `cardContent.resumeToken = resumePlaintext` in `agent_messages.meta` (`agentExecutionLoop.ts:896, 950`). JSONB column is returned by the conversation API and fed to the LLM message-history builder. Same-org users with `BRIEFS_READ` can read the plaintext within the 3600-second window.

Pre-existing condition — not introduced by this diff. Suggested action: update comment to reflect reality, or strip `resumeToken` from persisted `cardContent` and deliver out-of-band only.

**worth-confirming (W4): Schema/migration drift on `boundRunIdx` partial index**

`server/db/schema/waitpoints.ts:38`: `index('waitpoints_bound_run_idx').on(table.boundRunId)` — no WHERE filter. SQL migration creates a partial index `WHERE bound_run_id IS NOT NULL`. `db:generate` will detect mismatch and emit a corrective migration that loses the partial filter.

Suggested fix: `server/db/schema/waitpoints.ts:38` — use `.where(isNotNull(table.boundRunId))` (Drizzle partial-index syntax).

---

## STRIDE sweep

| Category | Verdict |
|---|---|
| Spoofing | no new risk |
| Tampering | no new gaps |
| Repudiation | worth-confirming — `expireWaitpoints` mutations not written to `audit_events`; documented architectural constraint in `adminDbConnection.ts:27-29` |
| Information disclosure | W3 above; no new cross-tenant leakage |
| Denial of service | L2 above |
| Elevation of privilege | no new risk; flag read from env not request body |

---

## Trust boundaries

| Boundary | Enforcement |
|---|---|
| external OAuth callback → server | JWT state verify + 64-hex token format + org-id predicate |
| client → resume route | authenticate + requireOrgPermission(AGENTS_CHAT) + token format |
| background job → tenant data (resume) | createWorker withOrgTx default |
| background job → tenant data (sweep) | withAdminConnection + admin_role + explicit org predicates |
| client → completeWaitpoint (approval) | waitpointId server-set in metadataJson, action row org-scoped |
| plaintext → agent_messages.meta | **no enforcement** — same-org BRIEFS_READ can read (W3) |

---

## Additional observations

- `0379_waitpoints_primitive.down.sql` — `DROP POLICY` before `DROP TABLE IF EXISTS` is redundant but harmless.
- `waitpointServicePure.ts:112` re-exports `deriveTokenHash` from `agentResumeService` — creates a pure-module import edge into a service module.
- `WAITPOINT_PRIMITIVE_ENABLED` defaults to `false` — new code dormant by default.

---

## Disposition recommendations (for feature-coordinator / pr-reviewer routing)

- **L1 (atomic CREATE + run-block)** — RECOMMEND fix in this build. Real correctness risk; service supports `opts.tx`; fix is mechanical (≤20 lines).
- **L2 (sweep transaction poisoning)** — RECOMMEND at minimum: add UUID validation guard (≤3 lines). SAVEPOINT-per-row is a larger refactor — DEFER to follow-up unless operator wants both.
- **W1 (OAuth two-step idempotency)** — INFORMATIONAL; no fix required.
- **W2 (unknown queue name TypeError)** — DEFER to follow-up; in-tree call site is safe.
- **W3 (plaintext in agent_messages.meta)** — PRE-EXISTING; surface in tasks/todo.md for follow-up consideration.
- **W4 (Drizzle partial-index drift)** — RECOMMEND fix in this build (one-line change).
