# Adversarial Review Log

**Build slug:** workflows-v1-phase-2
**Reviewed by:** adversarial-reviewer (claude-sonnet-4-6)
**Timestamp:** 2026-05-04T07:40:00Z

**Files reviewed:** server/routes/{workflowDrafts,workflowRuns,workflowStudio,assignableUsers,teams,taskEventStream}.ts; server/services/{workflowDraftService,assignableUsersService,teamsService,workflowRunService,workflowRunStartSkillService,workflowStudioService,workflowEngineService}.ts; server/jobs/workflowDraftsCleanupJob.ts; server/websocket/{rooms,taskRoom,auth,emitters}.ts; server/middleware/auth.ts; server/config/rlsProtectedTables.ts; migrations/0276_workflows_v1_additive_schema.sql.

**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes, 3 worth-confirming)

---

## Contents

1. RLS / Tenant Isolation
2. Auth & Permissions
3. Race Conditions
4. Injection
5. Resource Abuse
6. Cross-Tenant Data Leakage
7. Additional Observations

---

## 1. RLS / Tenant Isolation

### Finding 1 — `confirmed-hole` — workflowDraftsCleanupJob uses bare `db` on FORCE RLS table without withAdminConnection

**File:line:** `server/jobs/workflowDraftsCleanupJob.ts:14,16,21–28`

**Attack scenario:** The daily cleanup job imports bare `db` and runs `db.delete(workflowDrafts).where(...)` with no admin connection and no `app.organisation_id` session variable set. Migration 0276 applied `FORCE ROW LEVEL SECURITY` to `workflow_drafts` with a policy that gates all rows on `current_setting('app.organisation_id', true)` being a non-empty UUID. In a background pg-boss handler there is no `withOrgTx` context — `current_setting('app.organisation_id', true)` returns an empty string. The policy condition `current_setting(...) <> ''` is false, so every row is invisible and the DELETE affects 0 rows on every daily run. Unconsumed drafts accumulate indefinitely. The `payload` column stores orchestrator-authored workflow configuration that is never reclaimed. The companion job `agentRunCleanupJob.ts` documents this exact requirement and uses `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass RLS; this job omits that pattern.

**Suggested fix:** Import `withAdminConnection` from `server/lib/adminDbConnection.js` and wrap the delete inside it, mirroring `agentRunCleanupJob.ts`.

---

### Finding 2 — `worth-confirming` — workflowDraftService, teamsService, assignableUsersService use bare `db` on FORCE-RLS tables

**File:line:**
- `server/services/workflowDraftService.ts:7`
- `server/services/teamsService.ts:1`
- `server/services/assignableUsersService.ts:1`

**What raised the flag:** All three services call bare `db.select()` / `db.update()` / `db.insert()` rather than `getOrgScopedDb()`. The `authenticate` middleware binds `app.organisation_id` with `is_local = true` — scoped to the middleware's transaction only. Bare `db` calls acquire separate pool connections with no session variable. `workflow_drafts`, `teams`, and `team_members` all have `FORCE ROW LEVEL SECURITY`. If the app connection role lacks `BYPASSRLS`, all these queries silently return empty / affect 0 rows, breaking the workflows-v1 API surface. Pre-existing services (e.g. `taskService.ts`) also use bare `db`, so the app role may have `BYPASSRLS` — in which case these are convention violations without a functional break, but they remove the RLS safety net.

**What would confirm:** Inspect the DB role for the `DATABASE_URL` connection — does it have `BYPASSRLS`? If not, the `/api/workflow-drafts/*` and `/api/orgs/:orgId/teams/*` endpoints are silently broken.

---

### Finding 3 — `likely-hole` — assignableUsers route does not call resolveSubaccount, enabling cross-org subaccount membership disclosure

**File:line:** `server/routes/assignableUsers.ts:11–43` and `server/services/assignableUsersService.ts:67–102`

**Attack scenario:** The route `/api/orgs/:orgId/subaccounts/:subaccountId/assignable-users` validates that `req.params.orgId === req.orgId!` but never calls `resolveSubaccount(subaccountId, orgId)` to verify the `:subaccountId` belongs to the caller's org. `DEVELOPMENT_GUIDELINES.md §1` mandates this call on every route with `:subaccountId`.

In the org-level caller path (org_admin, manager, system_admin): `assignableUsersService` correctly scopes the user list to `users.organisationId = organisationId`. But it LEFT JOINs `subaccountUserAssignments` on the attacker-controlled `subaccountId` (line 79–83) to compute the `is_subaccount_member` field. Passing a foreign org's subaccount UUID causes the response to reveal which users in org A are also assigned to that foreign subaccount — a cross-tenant membership oracle. An org-admin at org A can enumerate whether their own users have assignments in subaccounts belonging to org B by probing arbitrary subaccount UUIDs.

**Suggested fix:** Add `await resolveSubaccount(req.params.subaccountId, req.orgId!)` before line 28, following the pattern in `workflowRuns.ts` lines 30 and 44.

(Duplicate of pr-review B3 — same root cause; addressing one closes both.)

---

### Finding 4 — `worth-confirming` — streamEventsByTask has no explicit organisationId filter on agentExecutionEvents

**File:line:** `server/services/agentExecutionEventService.ts:689–702` and `server/routes/taskEventStream.ts:53–58`

**What raised the flag:** The task ownership check (lines 41–47 of `taskEventStream.ts`) correctly verifies `tasks.organisationId = orgId`. But the subsequent `agentExecutionEvents` query on lines 53–58 filters only by `taskId`, and `streamEventsByTask` at line 694 similarly filters only by `taskId`. The `DEVELOPMENT_GUIDELINES.md §1` rule says to "always filter by organisationId in application code, even with RLS." A future refactor removing the task-ownership guard, or a path that bypasses it, would leak execution events for that taskId across orgs. Currently safe because taskId is pre-validated — but relies entirely on RLS rather than application-layer defence-in-depth.

---

## 2. Auth & Permissions

### Finding 5 — `likely-hole` — POST /api/workflow-runs/:runId/replay uses AGENTS_VIEW for a write operation

**File:line:** `server/routes/workflowRuns.ts:153–166`

**Attack scenario:** The replay endpoint creates a new `workflow_runs` row, dispatches agent steps, and consumes LLM budget — a full write operation. Its permission gate is `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (line 156). Every other mutating endpoint in this file (cancel line 147, input submission line 170, output editing line 196, approval line 241) uses `AGENTS_EDIT`. A user with a view-only permission set can trigger unlimited workflow replays, exhausting the org's LLM budget without needing edit rights.

**Suggested fix:** Change line 156 to `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)`.

---

## 3. Race Conditions

No confirmed or likely holes. The partial unique index `workflow_runs_one_active_per_task_idx` is correctly intercepted via structured error in `workflowRunService.ts:274–289`. The `markConsumed` update uses `isNull(consumedAt)` in the WHERE clause — safe under concurrent requests (optimistic lock).

---

## 4. Injection

No confirmed holes. The workflow templating engine (`server/lib/workflow/templating.ts`) uses a strict whitelist of prefixes and a prototype-pollution blocklist. User-supplied `bulkTargets` (string array) is stored in `_meta.bulkTargets` — outside the whitelisted template namespace. The `readExistingWorkflow` slug is sanitized via `/[^a-z0-9_-]/g` replacement plus a `startsWith(WorkflowS_DIR)` path boundary check, and is behind `requireSystemAdmin`.

---

## 5. Resource Abuse

### Finding 6 — `worth-confirming` — Depth guard only enforced at skill layer; direct HTTP startRun does not initialise workflowRunDepth baseline

**File:line:** `server/routes/workflowRuns.ts:74` and `server/services/workflowEngineService.ts:1750–1769`

**What raised the flag:** `POST /api/subaccounts/:subaccountId/workflow-runs` calls `WorkflowRunService.startRun` without passing `workflowRunDepth`, so `_meta.workflowRunDepth` is stored as `undefined`. The engine's `agent_call` step dispatch at lines 1750–1768 of `workflowEngineService.ts` sends a `workflow-agent-step` queue job without including `workflowRunDepth` in the payload. When the dispatched agent calls `workflow.run.start`, the skill guard at `workflowRunStartSkillService.ts:28` throws `MissingWorkflowDepthError` — this is fail-closed (hard error, not a depth bypass), but it surfaces as a 500 rather than a graceful `max_workflow_depth_exceeded` response and it reveals the depth guard is not initialised for HTTP-started runs. The guard is enforced correctly only when the orchestrator seeds `workflowRunDepth: 1` at `orchestratorFromTaskJob.ts:286`.

**What would confirm:** Verify whether the `workflow-agent-step` worker reads `workflowRunDepth` from `run.contextJson._meta` and passes it to `agentExecutionService` as `request.workflowRunDepth`. If it does not, HTTP-started workflow chains cannot call `workflow.run.start` at all (hard error, not bypass).

---

## 6. Cross-Tenant Data Leakage

Finding 3 is the primary cross-tenant finding. Remaining surfaces are clean:

**WebSocket rooms:** `server/websocket/taskRoom.ts` validates `tasks.organisationId = orgId` before joining `task:${taskId}`. `rooms.ts` validates workflow-run and subaccount rooms similarly. `authenticateSocket` derives `orgId` from the JWT payload. No cross-tenant broadcast vectors found.

**Teams member listing:** `teamsService.listMembers` filters by `teamMembers.organisationId = organisationId` — cross-org user enumeration is not possible.

**Workflow draft ID disclosure:** GET draft route returns identical 404 for "not found" and "wrong org" — no enumeration oracle.

**Approver pool:** `workflowRuns.ts:262` calls `WorkflowRunService.assertCallerInApproverPool` server-side before any approval action — pool membership is not trusted from the request body.

---

## 7. Additional Observations (not expanded)

- `workflowStudioService.ts` uses bare `db` for session reads (line 35); gated on `requireSystemAdmin` so blast radius is limited.
- `workflowRunService.ts:158–163`: subaccount-to-org check uses bare `db` with a guard-ignore annotation — acceptable as a read-only membership probe with explicit app-layer org filter.
- `getOrgTemplateLatestVersion` (workflowTemplateService.ts:277) does not filter by `organisationId` — safe only because the template ID is pre-validated in `getOrgTemplate(orgId, id)` on the same code path; a minor TOCTOU window between the two calls is present but unexploitable without a separate template deletion race.
