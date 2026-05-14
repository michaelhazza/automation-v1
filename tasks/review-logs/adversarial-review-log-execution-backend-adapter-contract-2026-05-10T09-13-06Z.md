# Adversarial Review Log — execution-backend-adapter-contract

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**Build slug:** `execution-backend-adapter-contract`
**Timestamp:** 2026-05-10T09:13:06Z
**Reviewer:** adversarial-reviewer (Claude Sonnet)
**Trigger:** auto-trigger surface match (migrations + server/db/schema)
**Phase:** Phase 2 branch-level review pass — §8.2

**Verdict:** HOLES_FOUND (1 confirmed-hole, 1 likely-hole, 1 worth-confirming)

## Contents

1. Files reviewed
2. RLS / Tenant Isolation (EBAC-ADV-1)
3. Auth & Permissions
4. Race Conditions (EBAC-ADV-2)
5. Injection (EBAC-ADV-3)
6. Resource Abuse
7. Cross-Tenant Data Leakage
8. Summary table + routing decisions

## 1. Files reviewed

- `migrations/0313_execution_backend_columns.sql` (+ `.down.sql`)
- `server/db/schema/agentRuns.ts`
- `server/db/schema/organisations.ts`
- `server/services/executionBackends/{types,registry,options,apiBackend,claudeCodeBackend,ieeBrowserBackend,ieeDevBackend,_ieeShared,_apiHeadlessShared}.ts`
- `server/services/agentExecutionTypes.ts`
- `server/services/agentExecutionService.ts` (dispatch site, Chunk 5)
- `server/services/agentRunFinalizationService.ts`
- `server/services/queueService.ts` (cron rename section)
- `server/jobs/ieeRunCompletedHandler.ts`

## 2. RLS / Tenant Isolation (EBAC-ADV-1)

**EBAC-ADV-1** — `confirmed-hole`

**Location:** `server/services/executionBackends/_ieeShared.ts:166-180` (parent UPDATE) and `_ieeShared.ts:187-197` (orphan-cleanup UPDATE)

**Finding:** The IEE dispatch path (`ieeDispatch`) issues two bare `db.update()` calls that write to `agent_runs` and `iee_runs` using the unscoped `db` connection (not `withOrgTx`). Neither UPDATE includes `eq(agentRuns.organisationId, input.organisationId)` (or the `ieeRuns` equivalent) as a safety predicate.

DEVELOPMENT_GUIDELINES §1: "Always filter by `organisationId` in application code, even with RLS. Reads and writes by ID must include an explicit `eq(items.organisationId, organisationId)`."

**Attack scenario:** In V1, `input.runId` is always a freshly-inserted row owned by the calling org, so the practical exploitation window is narrow. However, if any future caller path (a webhook handler, an admin-escalated path, or a middleware layer) passes an adversary-supplied `runId` into `BackendDispatchInput`, the UPDATE writes `status='delegated'`, `backendId`, and `backendTaskId` onto any matching non-terminal `agent_runs` row regardless of its `organisationId`. Defence-in-depth — not currently exploitable, but mandatory per the guideline.

**Suggested fix:** Add `eq(agentRuns.organisationId, input.organisationId)` to the WHERE at `_ieeShared.ts:176-179`, and `eq(ieeRuns.organisationId, input.organisationId)` to `_ieeShared.ts:193-197`.

**Policy coverage on new columns:** `agent_runs.backend_id` and `agent_runs.backend_task_id` columns are added via `ALTER TABLE` and inherit the existing RLS policy from `0079_rls_tasks_actions_runs.sql`. No policy was dropped. `rlsProtectedTables.ts` manifest entry for `agent_runs` references the correct policy migration. No new table created. No gap.

**`organisations.preferred_backends`:** `organisations` table is system-scoped (multi-tenant anchor, not per-tenant). The only `SELECT *` exposing this column (`organisationService.listOrganisations`) is gated by `requireSystemAdmin`. No cross-tenant leakage in V1.

## 3. Auth & Permissions

No new routes. No permission-gated endpoints changed. The `ieeRunCompletedHandler` is a pg-boss internal worker — not an HTTP route. No new HMAC surface.

No findings.

## 4. Race Conditions (EBAC-ADV-2)

**EBAC-ADV-2** — `likely-hole`

**Location:** `server/services/executionBackends/_ieeShared.ts:149-206`

**Finding:** Steps 1 (`enqueueIEETask` INSERT into `iee_runs`) and 2 (parent `agent_runs` UPDATE) execute as two separate non-transactional DB round-trips. If the application process dies between Step 1 and Step 2, an `iee_runs` row exists in `status='pending'` while the parent `agent_runs` remains in `'pending'` or `'running'`.

**Crash recovery analysis:**
- The IEE worker picks up the task, executes it, emits `iee-run-completed`. `ieeRunCompletedHandler` calls `finaliseAgentRunFromBackend`, which loads the terminal `iee_runs` row and the parent, then calls `ieeFinalise`. The parent UPDATE WHERE clause at `_ieeShared.ts:397-403` allows `['pending', 'running', 'delegated', 'cancelling']` — the event-handler path covers this crash scenario.
- The `(pending, pending)` stuck-pair scenario — IEE worker itself crashed and parent in `'pending'`/`'running'` — is invisible to `ieeReconcile`, which only matches `agentRuns.status IN ('delegated', 'cancelling')`. Recovery depends on the IEE worker's own orphan-cleanup sweep.

**What would confirm:** Review the IEE worker repo's "cleanup orphaned tasks" sweep to verify it emits `iee-run-completed` for tasks enqueued but never picked up. If the worker only emits events for tasks it picked up, this is a silent run leak.

**Cron rename idempotency:** `boss.unschedule('maintenance:iee-main-app-reconciliation').catch(() => undefined)` then `boss.schedule('maintenance:backend-reconciliation', ...)`. Different string literals; idempotent. No accidental self-cancellation.

## 5. Injection (EBAC-ADV-3)

**EBAC-ADV-3** — `worth-confirming`

**Location:** `server/services/agentExecutionService.ts:1570` and `server/services/executionBackends/claudeCodeBackend.ts:76-83`

**Finding:** `taskPrompt` forwarded to the Claude Code subprocess is `workspaceContext || 'Review the current workspace and report status.'` where `workspaceContext` is LLM-generated content from workspace memory. Passed through `claudeCodeRunner.execute({ taskPrompt: ctx.taskPrompt, ... })`.

If `claudeCodeRunner` uses `child_process.exec` with a concatenated shell string rather than `execFile` / `spawn` with an argument array, workspace-memory content with shell metacharacters could inject shell commands — a prompt-injection-to-shell-injection pivot.

**What would confirm:** Read `server/services/claudeCodeRunner.ts` to verify `execFile` / `spawn` (safe) rather than `exec` (unsafe). If safe, this is a non-finding.

No raw SQL string concatenation found. No user-controlled regex. No new SSRF surface (`startUrl: z.string().url()` validates format but not private-IP range — pre-existing pattern, not introduced by this diff).

## 6. Resource Abuse

- `ieeReconcile` includes `.limit(100)`. Each delegated adapter processes at most 100 stuck pairs per cron tick. Bounded.
- `reconcileBackends()` iterates only registered adapters. Adding a new adapter requires a code change at boot — no runtime-injectable amplification.
- `iee-run-completed` payload validated by Zod before processing. No unbounded fields.

No findings.

## 7. Cross-Tenant Data Leakage

Cross-reference EBAC-ADV-1 — the missing `organisationId` predicate is the primary cross-tenant risk. All other writes in this diff include org-scoped predicates or operate inside `db.transaction(FOR UPDATE)` paths.

**Post-commit websocket emissions:** `ieeFinalise`'s post-commit closure calls `emitAgentRunUpdate`, `emitOrgUpdate`, `emitSubaccountUpdate` with values loaded from the parent `agent_runs` row fetched under `FOR UPDATE` — org-scoped by FK. No shared-cache keying issue.

**`preferred_backends` SELECT * exposure:** Only `SELECT *` exposing this column is system-admin-gated. The `.$type<Record<string, string>>()` Drizzle annotation is not enforced at the DB layer; when the first reader lands, Zod validation is mandatory before using keys as routing decisions. (Forward note, not a V1 finding.)

No additional cross-tenant findings.

## 8. Summary table + routing decisions

| ID | Label | Category | Location | Severity |
|----|-------|----------|----------|----------|
| EBAC-ADV-1 | confirmed-hole | RLS / Tenant Isolation | `_ieeShared.ts:166-197` | High (defence-in-depth) |
| EBAC-ADV-2 | likely-hole | Race Conditions | `_ieeShared.ts:149-206` | Medium |
| EBAC-ADV-3 | worth-confirming | Injection | `claudeCodeRunner.ts` (read it to confirm) | Low |

**Additional observations:**
- `agentRunId: row.agentRunId ?? ''` at `_ieeShared.ts:240` maps a DB-null `agentRunId` to `''`. The orchestrator's `if (!terminalState.agentRunId)` correctly fires for standalone IEE runs. No bug.
- The registry's V1 enforcement (`EXECUTION_MODES` set) correctly blocks OpenClaw id registration at boot. Must be updated in Phase 3.
- The `BackendTaskAlreadyClaimed` error class and the partial UNIQUE index are consistent. No caller path in V1 throws or catches it (duplicate-enqueue handled upstream by `enqueueIEETask`'s `ON CONFLICT DO NOTHING`).
- Migration `0313` modifies `organisations` (existing table) — no `-- system-scoped:` header required.

**Routing decisions:**
- **EBAC-ADV-1** — fix inline now (one-line predicates added, defence-in-depth, runs through G3 + pr-reviewer).
- **EBAC-ADV-2** — defer to `tasks/todo.md`. Confirmation requires reading the IEE worker repo (out of scope for this branch).
- **EBAC-ADV-3** — defer to `tasks/todo.md`. Confirmation requires reading `claudeCodeRunner.ts`; non-blocking for V1.

**Verdict:** HOLES_FOUND (1 confirmed-hole, 1 likely-hole, 1 worth-confirming) — non-blocking advisory.
