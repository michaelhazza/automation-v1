# PR Review Log — feat/agents-are-employees (post-DE-CR fixes)

**Reviewed:** 2026-04-30T01:50:00Z
**Branch:** feat/agents-are-employees (PR #237)
**HEAD at review:** `05fff3cd`
**Verdict:** CHANGES_REQUESTED (3 blocking, 5 strong, 4 nice-to-have)

## Files inspected
- server/services/workspace/workspaceMigrationService.ts
- server/routes/workspace.ts
- server/routes/workspaceCalendar.ts
- server/routes/activity.ts
- server/services/activityService.ts
- server/services/connectorConfigService.ts
- server/services/queueService.ts
- server/lib/createWorker.ts
- server/jobs/seatRollupJob.ts
- migrations/0261_audit_events_subaccount_migration_uniq.sql
- shared/types/workspaceAdapterContract.ts
- server/services/workspace/__tests__/workspaceOnboardingService.test.ts
- client/src/components/workspace/MigrateWorkspaceModal.tsx
- client/src/components/workspace/WorkspaceTabContent.tsx
- client/src/components/workspace/IdentityCard.tsx
- client/src/components/workspace/EmailSendingToggle.tsx
- client/src/components/workspace/OnboardAgentModal.tsx
- client/src/components/agent/AgentActivityTab.tsx
- client/src/pages/SubaccountAgentEditPage.tsx
- client/src/pages/ActivityPage.tsx
- client/src/pages/OrgChartPage.tsx
- docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md (§7, §12, §13, §14)

---

## Blocking Issues

### B1 (still open from prior review) — `targetConnectorConfigId` plumbing inverts source/target

**Files:** `client/src/components/workspace/WorkspaceTabContent.tsx:200-208`, `server/routes/workspace.ts:199-230`

`WorkspaceTabContent.tsx:205` passes `targetConnectorConfigId={config.connectorConfigId ?? ''}`. `config.connectorConfigId` is the **source** backend's connector ID (from `getSubaccountWorkspaceConfig`), not the target. The modal forwards it to `POST /workspace/migrate`, which calls `workspaceMigrationService.start({ targetConnectorConfigId, ... })`, and the per-identity worker then provisions on the **target** adapter using the **source's** connector_config row.

If the target has no connector config row yet, the row is on the wrong backend, or `''` is passed when no source config exists, the migration silently provisions identities pointed at the wrong tenant configuration. The status-poll endpoint has no shape check that catches this.

**Fix:**
1. UI: Before opening `MigrateWorkspaceModal`, the user must select or create the target backend's connector config (or the modal triggers the create via an inline step). `WorkspaceTabContent` currently has only the source's `connectorConfigId` available — it must fetch / create the target config and pass *that* id.
2. Server (`POST /workspace/migrate`): Validate that `targetConnectorConfigId` belongs to a connector_config row where `organisationId = req.orgId`, `subaccountId = req.params.subaccountId`, `connectorType = targetBackend`. Reject with 400/404 otherwise. This kills S2 in the same change.

### B2 (new) — `maybeFinaliseBatch` has a count-race that can permanently strand a batch as "running"

**File:** `server/services/workspace/workspaceMigrationService.ts:273-338`, worker concurrency from `WORKSPACE_MIGRATION_CONCURRENCY` (default 8) at `queueService.ts:1140`.

Each per-identity worker runs in its own `withOrgTx` transaction. The flow is:
1. INSERT terminal audit row (own tx).
2. SELECT terminal rows for batch.
3. If `count >= migrationJobBatchSize` → INSERT `subaccount.migration_completed` (idempotent via partial unique index).

Under READ COMMITTED, if workers A and B are the last two and both reach step 2 before either has committed step 1, both see N-1 rows, both skip finalise, and the completion row is never written. The status-poll route depends entirely on the completion row to flip `status` away from `'running'`. The migration appears stuck forever.

The partial unique index in migration `0261` correctly handles the "both finalisers fire" case (DO NOTHING on collision) but does nothing for the "neither fires" case.

**Fix options:**
1. Advisory lock per batch around step 2+3 (cheapest; matches the existing primitive in `start()`).
2. Move finalisation to a separate "drain" job.
3. Use a row-level counter on a `migration_batches` table.

Recommended: option 1.

### B3 (new) — `subaccount.migration_completed` is invisible in subaccount-scoped activity feed

**File:** `server/services/activityService.ts:615-684`

The migration completion event is inserted with `entity_type = 'subaccount'`, `workspace_actor_id = NULL`. `fetchAuditEvents` joins to `workspaceActors` and, when `subaccountId` is in scope, filters with `eq(workspaceActors.subaccountId, subId)`. The LEFT JOIN of an audit row with `workspace_actor_id = NULL` produces NULL on `workspaceActors.subaccountId`, which fails the `eq(...)` predicate — the row is dropped.

**Fix:** When `subId` is set, the predicate must be `(workspaceActors.subaccountId = subId) OR (entity_type = 'subaccount' AND entity_id = subId)`.

---

## Strong Recommendations

### S1 (still open) — `boss.send` for `workspace.migrate-identity` lacks Zod validation at enqueue site

**File:** `server/services/workspace/workspaceMigrationService.ts:97-112`

The cast `(boss as any).send('workspace.migrate-identity', { … } satisfies MigrateIdentityJob, …)` provides compile-time type-shape only; `satisfies` does not survive into runtime.

**Fix:** Define `MigrateIdentityJobSchema = z.object({...})`, derive `MigrateIdentityJob = z.infer<typeof MigrateIdentityJobSchema>`, and call `MigrateIdentityJobSchema.parse(payload)` before `boss.send`.

### S2 — folded into B1

`targetConnectorConfigId` server-side validation. Listed under B1 because the fix sites are coupled.

### S3 (still open) — Org-chart endpoint can render duplicate actor rows during migration window

**File:** `server/routes/workspace.ts:647-760`

The org-chart query LEFT JOINs `workspace_identities` filtered only by `isNull(archivedAt)`. During the migration window, one actor may briefly hold both:
- the source identity in `status = 'active'`, and
- the target identity in `status = 'provisioned'`.

Both rows match the JOIN, so the query returns two rows with the same `actorId`.

**Fix:** Filter to `status IN ('active', 'suspended')` only — the workspace tab guarantee is "one active identity per actor at steady state", and the migration window's `provisioned`-but-not-yet-active identity is not user-meaningful for the org chart.

### S4 (still open) — `MigrateWorkspaceModal.handleMigrate` doesn't defensively clear interval before set

**File:** `client/src/components/workspace/MigrateWorkspaceModal.tsx:74-93`

Nothing prevents `handleMigrate` from being invoked twice. The second run overwrites `pollRef.current` and orphans the first interval — it keeps polling until unmount.

**Fix:** Clear pollRef before set + a submitting flag set immediately and cleared on either success or error.

### S5 (still open) — `WorkspaceAdapter` type extraction in test resolves to `never`

**File:** `server/services/workspace/__tests__/workspaceOnboardingService.test.ts:32-33`

`WorkspaceAdapter` is exported as `export interface WorkspaceAdapter { ... }` (a type-only export). At runtime, the imported namespace `workspaceAdapterModule` has no `WorkspaceAdapter` property — interfaces erase at compile time.

**Fix:** Use `import type { WorkspaceAdapter } from '...'`.

---

## Nice-to-have Improvements

### N1 — Inconsistent `req.userId!` vs `req.user!.id` in same file

**File:** `server/routes/workspace.ts:218` uses `req.user!.id`; lines 179, 463, 494, 539, 570, 617 use `req.userId!`. Pick one.

### N2 — `migrationRequestId` is unvalidated and unused for actual idempotency

**File:** `server/routes/workspace.ts:206-217`, `workspaceMigrationService.ts:58-116`.

Caller-side replay key isn't used for batch idempotency. Either drop or use as key on `migration_batches` table.

### N3 — Retryability classifier is a string-match heuristic

**File:** `server/routes/workspace.ts:243-267`

`classifyRetryable` does case-insensitive `includes()` on free-text. Should match on structured `failureReason` enum from spec §7.

### N4 — `seatRollupJob` writes all orgs in a single admin tx

**File:** `server/jobs/seatRollupJob.ts:25-61`

If org N's update fails, the whole batch rolls back and orgs 1..N-1 lose their snapshot. Use SAVEPOINT subtransactions per org, OR refactor to one outer tx per org. Lower priority.

---

## What I confirmed works

1. `INSERT ... ON CONFLICT ((metadata->>'batchId')) WHERE …` syntax — matches the partial unique index in `0261` exactly.
2. `migrationJobBatchSize` snapshot at `start()` — correctly excludes mid-window onboarding.
3. Cursor pagination tiebreaker — UUID lexicographic `id ASC` is consistent across sources.
4. DE-CR-3..DE-CR-10 directional fixes match the spec.
5. HMAC verification on inbound webhook — out of scope.
