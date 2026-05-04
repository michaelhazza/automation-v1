# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Spec commit at check:** `f4ebd0c97931ba92f7782a26e4ac55587315721d`
**Branch:** `feat/agents-are-employees`
**Base:** `b1e5d29da5e1b7c3b58c849bf69fa84fcd91083b` (merge-base with main)
**Scope:** Phases D + E only (Phases A-C reviewed in prior sessions; spot-checked where Phase D/E touches them)
**Changed-code set:** 224 files (whole branch); audit narrowed to the 8 areas named by caller
**Run at:** 2026-04-30T00:38:18Z
**Build slug:** `agent-as-employee`
**Commit at finish:** `473786cdc0d5c1a7629cf303ec6c60f621988f4b`

---

## Contents

1. Summary
2. Areas audited
3. Mechanical fixes applied
4. Directional gaps routed to tasks/todo.md
5. Files modified by this run
6. Re-verification
7. Next step

---

## 1. Summary

- Subcomponents audited (per caller's 8 areas):  8
- PASS:                       3
- MECHANICAL_GAP → fixed:     2 (covering 5 sites)
- DIRECTIONAL_GAP → deferred: 10
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0 (Phases A-C explicitly out per caller)

**Verdict:** NON_CONFORMANT — 10 directional gaps require resolution by the main session. Two of them (DE-CR-1 worker wiring, DE-CR-2 RLS-blocked rollup) are runtime bugs that block the migration runbook and the seat-billing snapshot from working at all in production.

---

## 2. Areas audited

### 2.1 Activity feed — PARTIAL

- `activityService.ts` extended with workspace event types — **PASS**.
  - Evidence: `server/services/activityService.ts:25–49` (24-type `ActivityType` union), `:509–528` (`WORKSPACE_EVENT_TYPES` set), `:554–620` (`fetchAuditEvents` with `actorId` filter).
- `GET /api/subaccounts/:saId/activity?actorId=` — **PASS**.
  - Evidence: `server/routes/activity.ts:28` (parseFilters), `:44–58` (route handler).
- `ActivityFeedTable`, `ActivityPage` — **PASS**.
- `AgentActivityTab` — **MECHANICAL_GAP → FIXED** (see §3).
- DIRECTIONAL: pagination is offset-based — spec §12 forbids. Routed as DE-CR-7.
- DIRECTIONAL: tiebreaker is `id DESC`; spec §12 says `id ASC`. Routed as DE-CR-8.

### 2.2 Org chart — PASS (with directional gaps)

- `GET /api/subaccounts/:saId/workspace/org-chart` exists; reads `workspace_actors`; uses `parent_actor_id`; cycle detection + cross-subaccount-parent guards.
  - Evidence: `server/routes/workspace.ts:583–695`.
- `OrgChartPage` consumes the route and deduplicates against `subaccount_agents`.
  - Evidence: `client/src/pages/OrgChartPage.tsx:217–273`.
- **MECHANICAL_GAP → FIXED**: missing `resolveSubaccount`. Applied here.
- DIRECTIONAL: viewer permission too restrictive (`WORKSPACE_CONNECTOR_MANAGE`). Routed as DE-CR-9.

### 2.3 Seat rollup — NON-FUNCTIONAL (routed)

- `seatRollupJob.ts` calls `countActiveIdentities`, writes `org_subscriptions.consumed_seats`, scheduled hourly.
- `org_subscriptions.consumed_seats` column added by migration 0260 + drizzle schema. **PASS**.
- `SeatsPanel` reads live from `/workspace` config. **PASS**.
- **DIRECTIONAL (runtime bug)**: rollup uses bare `db` against `workspace_identities` (FORCE RLS) — query returns 0 rows. Routed as DE-CR-2.

### 2.4 Migration service — NON-FUNCTIONAL (routed)

- `workspaceMigrationService.start`: advisory lock, deterministic order, per-identity enqueue. **PASS**.
- `processIdentityMigration`: provision → activate → archive ordering matches §9.3. Audit events for each terminal state. **PASS** at function level.
- **DIRECTIONAL (runtime bug)**: pg-boss worker registered with bare `boss.work` — no `withOrgTx`. `getOrgScopedDb()` will throw. Migration runbook non-functional. Routed as DE-CR-1.
- DIRECTIONAL: per-step failure types not in spec §14.4 / activity union. Routed as DE-CR-5.
- DIRECTIONAL: `subaccount.migration_completed` from §14.4 never written. Routed as DE-CR-6.

### 2.5 Migration routes — PASS (with contract divergence)

- `POST /workspace/migrate` returns 202 with `{ migrationJobBatchId, total }` per §13. **PASS**.
- `GET /workspace/migrate/:batchId` polls audit_events for batch status. **PASS** at wiring.
- **MECHANICAL_GAP → FIXED**: missing `resolveSubaccount` on both endpoints.
- DIRECTIONAL: response shape diverges from §12 `MigrateSubaccountResponse`. Routed as DE-CR-3.

### 2.6 MigrateWorkspaceModal — PASS

- 5-state flow (`confirm` → `migrating` → `success | partial | failed`) matches mockup 16.
- Type-the-keyword (`MIGRATE`) gate ✓. 2s polling ✓. Per-failed-identity list with reason ✓. Retry on `partial`/`failed` ✓.
- Evidence: `client/src/components/workspace/MigrateWorkspaceModal.tsx`.

### 2.7 WorkspaceTenantConfig — PARTIAL

- `getWorkspaceTenantConfig(orgId, subaccountId)` resolver in `connectorConfigService`. **PASS**.
- Wired through send pipeline via `signatureContext` in `workspaceMail.ts:152–163`. **PASS**.
- DIRECTIONAL: contract diverges from §12 — missing `backend`, `connectorConfigId`, `domain`. Routed as DE-CR-4.

### 2.8 Adapter contract tests — PASS

- `canonicalAdapterContract.test.ts` exercises native_mock + google_mock against shared scenarios.
- Migration scenario: 3 actors native → google with `migrationRequestId:actorId` idempotency, retries stable. ✓
- Failure injection: F1 (provision), F2 (sendEmail), F3 (archiveIdentity). ✓
- Evidence: `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts:112–247`.

---

## 3. Mechanical fixes applied

### Fix 1 — `AgentActivityTab` parameter contract aligned with route

```
[FIXED] DE-MECH-1 — AgentActivityTab sent param names that the activity route does not parse
  File: client/src/components/agent/AgentActivityTab.tsx
  Lines: 62–125
  Spec quote: "Hits the existing GET /api/subaccounts/:saId/activity endpoint (with actorId locked)"
  Change: rename `after` → `from`, `types` → `type`; switch cursor pagination to offset/hasMore
  matching the route's `{ items, total, hasMore }` response.
```

Result before fix: date-range and event-type filters silently ignored; "Load more" never fires because `nextCursor` never appears in the response.

### Fix 2 — `resolveSubaccount` added to four `:subaccountId` routes

```
[FIXED] DE-MECH-2 — Routes with :subaccountId did not call resolveSubaccount before consuming the param
  File: server/routes/workspace.ts
  Lines: 199–210, 233–242, 583–595, 700–712 (4 sites)
  Spec quote: "Routes with :subaccountId must call resolveSubaccount(req.params.subaccountId, req.orgId!)
  before consuming the ID" (DEVELOPMENT_GUIDELINES.md §1; referenced by spec §10.5 multi-tenant safety checklist)
  Change: insert `await resolveSubaccount(subaccountId, req.orgId!);` immediately after destructuring
  `req.params` for: POST /workspace/migrate, GET /workspace/migrate/:batchId, GET /workspace/org-chart,
  GET /workspace/actors.
```

---

## 4. Directional gaps routed to tasks/todo.md

All routed under heading `## Deferred from spec-conformance review — agent-as-employee phases D+E (2026-04-30)`:

| ID | One-line summary | Severity |
|---|---|---|
| DE-CR-1 | `processIdentityMigration` worker missing `createWorker`/`withOrgTx` | RUNTIME BUG |
| DE-CR-2 | `seatRollupJob` reads RLS-FORCED table via bare `db`, returns 0 rows | RUNTIME BUG |
| DE-CR-3 | Migration status-poll response shape diverges from §12 contract | Contract |
| DE-CR-4 | `WorkspaceTenantConfig` missing spec-named fields | Contract |
| DE-CR-5 | Per-step migration failure event types not in spec §14.4 | Contract |
| DE-CR-6 | `subaccount.migration_completed` terminal event never written | Contract |
| DE-CR-7 | Activity feed pagination is offset-based; spec §12 forbids | Contract |
| DE-CR-8 | Activity feed tiebreaker is `id DESC`; spec §12 says `id ASC` | Contract |
| DE-CR-9 | Org-chart/actors viewer routes use management-level permission | Permissioning |
| DE-CR-10 | `seatRollupJob` and `activityService.fetchAuditEvents` use `db` directly | Guideline |

---

## 5. Files modified by this run

- `client/src/components/agent/AgentActivityTab.tsx`
- `server/routes/workspace.ts`
- `tasks/todo.md`

---

## 6. Re-verification (Step 5)

Both mechanical fixes re-read after Edit:

- `AgentActivityTab.tsx`: `from`, `type`, `offset`, `hasMore` all present; cursor state removed; `nextCursor` no longer referenced. ✓
- `workspace.ts`: `await resolveSubaccount(subaccountId, req.orgId!);` is the first line after `req.params` destructuring at all four sites. ✓

`npx tsc --noEmit` — clean (no output on full repo). ✓

---

## 7. Next step

**NON_CONFORMANT** — 10 directional gaps must be addressed by the main session before `pr-reviewer`. Two are blocking runtime bugs (DE-CR-1, DE-CR-2) that prevent the migration runbook and the seat-billing snapshot from operating at all in production. The other eight are contract divergences that should land before the PR is opened or be explicitly accepted as deviations in `progress.md`.

Mechanical fixes were applied during this run; if the main session opts to ship without resolving the directional fixes, re-run `pr-reviewer` on the expanded changed-code set so it sees the post-fix state of `AgentActivityTab.tsx` and `workspace.ts`.

See `tasks/todo.md` under "Deferred from spec-conformance review — agent-as-employee phases D+E (2026-04-30)" for the full list with suggested approaches.
