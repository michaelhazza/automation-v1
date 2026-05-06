# Phase D + E Session Prompt — Agents Are Employees

## Context

You are continuing implementation of the **"agents are employees"** feature on branch `feat/agents-are-employees`. Phases A, B, and C are complete and passing review. This session implements **Phase D** (org chart + activity wiring + seats) and **Phase E** (migration runbook).

**Authoritative sources — read these before touching code:**
- Plan: `docs/superpowers/plans/2026-04-29-agents-as-employees.md` (full task breakdown — Phases D and E start at lines ~3464 and ~3888 respectively)
- Spec: `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
- Progress log: `tasks/builds/agent-as-employee/progress.md`
- Mockups: `prototypes/agent-as-employee/` (01–16 HTML files, canonical visual reference)

**Build slug:** `agent-as-employee` — update `tasks/builds/agent-as-employee/progress.md` at phase boundaries and compact-points.

## Current State

- Branch: `feat/agents-are-employees`
- Migrations committed: `0254` (canonical tables + RLS), `0255` (FK columns), `0256` (system agent renames), `0257` (workspace permission keys). **Next available: `0258`** (verify with `ls migrations | grep -E "^[0-9]{4}_" | sort | tail -3` before creating any migration file).
- All schema, adapters, pipeline, onboarding flow, Google adapter, and UI shell (identity tab, mailbox, calendar pages, onboard modal) are live.

## What Has Been Done (Phases A–C)

- **Phase A:** `workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events` tables + RLS + manifest. FK columns on `agents`, `users`, `agent_runs`, `audit_events`. System agents renamed (Sarah, Johnny, Helena, Patel, Riley, Dana). Seat-derivation pure function. Shared types.
- **Phase B:** `nativeWorkspaceAdapter`, `workspaceEmailPipeline` (outbound + inbound), `workspaceOnboardingService`, `workspaceActorService`, `workspaceIdentityService` (state machine), all workspace + mail + calendar routes, frontend UI (onboard modal, identity tab, mailbox page, calendar page, workspace tab on subaccount detail, typed API client wrappers, SubaccountAgentsPage per-row CTA).
- **Phase C:** `googleWorkspaceAdapter`, adapter contract test suite (both adapters), env vars + `.env.example` updates.

## What Remains: Phases D and E

### Phase D — Org chart + Activity wiring + seats

**Tasks (from the plan):**
- **D1:** Extend `ActivityType` union in `shared/types/activityType.ts` with workspace event types.
- **D2:** Extend `activityService.ts` — add `audit_events` query branch for workspace event types + `actorId` filter + cursor pagination.
- **D3:** Add `actorId` query param to `server/routes/activity.ts`; un-redirect `/admin/subaccounts/:saId/activity` in `client/src/App.tsx`.
- **D4:** Create `client/src/components/activity/ActivityFeedTable.tsx` — shared table primitive (no chart, no chrome).
- **D5:** Refactor `ActivityPage.tsx` to use `<ActivityFeedTable>` + add actor filter dropdown + new event types in type filter.
- **D6:** Create `client/src/components/agent/AgentActivityTab.tsx` + add `'activity'` tab to `SubaccountAgentEditPage.tsx`. Does NOT import `ActivityPage` — shares only `<ActivityFeedTable>` and API client.
- **D7:** Extend `OrgChartPage.tsx` to read from `workspace_actors` joined to `agents` + `users`; use `parent_actor_id` for hierarchy; add/extend org-chart backend endpoint.
- **D8:** Verify audit-event wiring — confirm `audit_events` rows are written for every terminal event in spec §14.4; fix any gaps.
- **D9:** Wire seat-rollup job to `deriveSeatConsumption` from `shared/billing/seatDerivation.ts` for workspace identities.
- **D10:** Phase D close-out — lint + typecheck + build:client + manual UAT (mockups 08, 14, 15) + PR.

**Phase D exit checklist:**
1. `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
2. Org chart renders humans + agents via `parent_actor_id`.
3. Subaccount Activity SPA route resolves (no redirect).
4. Activity page has actor filter; new workspace event types in dropdown.
5. Agent Activity tab shows only that agent's events, no scope chrome.
6. Seat rollup writes correct count matching `SeatsPanel`.

### Phase E — Migration runbook

**Tasks (from the plan):**
- **E1:** Create `server/services/workspace/workspaceMigrationService.ts` — `start()` acquires advisory lock, enqueues per-identity pg-boss jobs; `processIdentityMigration()` handles provision → activate → archive loop with per-step audit events and idempotency. Register pg-boss handler in `server/jobs/index.ts`.
- **E2:** Replace Phase B stub (`POST /workspace/migrate` returned 501) with full implementation (202 + batchId). Add `GET /workspace/migrate/:batchId` status-poll endpoint to `server/routes/workspace.ts`.
- **E3:** Create `client/src/components/workspace/MigrateWorkspaceModal.tsx` (mockup 16, states: select-target → confirm → migrating → success/partial/failed). Wire from `WorkspaceTabContent.tsx` replacing the stub "Migrate" button.
- **E4:** Extend `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` with migration scenario + failure-injection tests (provision fail, activate fail, archive fail, retry idempotency).
- **E5:** Phase E close-out — all exit checks + manual UAT + runbook update + PR.

**Phase E exit checklist:**
1. `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
2. Adapter contract test migration scenario passes.
3. Manual UAT: native → Google migration, partial-failure + retry.

**Targeted tsx tests (run before Phase E PR):**
- `tsx` test: four terminal per-identity audit event actions (`identity.migrated`, `identity.migration_failed`, `identity.migration_activation_failed`, `identity.migration_archive_failed`).
- `tsx` test: retry after partial completion is idempotent.
- `tsx` test: rate-limit window boundary uses DB time, not `Date.now()`.

## Cross-Cutting Invariants (apply to every task)

These are non-negotiable — reviewers reject violations. Full details in the plan preamble (lines ~20–60):

1. **Pre-send orphan-detection:** The `audit_events` row is committed in its own TX before the adapter call. TX2 writes the canonical message mirror after adapter success. If TX2 fails, log `{ externalMessageId, auditEventId }` and return failure — never rethrow.
2. **DB time for ordering:** `created_at` columns use `DEFAULT now()`. Never pass `new Date()` for canonical timestamps or rate-limit window anchors.
3. **Metadata namespacing:** Keys are pipeline-owned (no prefix), provider-owned (`gmail_`, `postmark_`, etc.), or skill-owned (`skill_`). Max 8 KB per value.
4. **State-dependent writes are predicate-guarded:** Use `WHERE status = <expected>` and treat 0 rows-affected as `noOpDueToRace: true`. No `SELECT FOR UPDATE`.
5. **Rate-limit scopes:** Per-identity AND per-org. Reuse `inboundRateLimiter` + `rateLimitKeys.workspaceEmailIdentity/Org`.
6. **No throws past an external side-effect** (see plan invariant #6 for per-operation-type rules).
7. **`audit_events` is append-only.**
8. **Structured log fields:** Every `log.error`/`log.warn` includes `{ organisationId, operation, actorId? }` + anchor fields. Flat — no nested objects.
9. **All workspace operations are retry-safe (N-times idempotency).**
10. **Happy-path INFO log at start of every entry point** with the 10 canonical fields (see plan invariant #10 for the exact shape).

## Execution Instructions

1. Use `superpowers:executing-plans` skill to drive task-by-task execution, OR use `superpowers:subagent-driven-development` to parallelize independent tasks. Per CLAUDE.md, the plan file is the authoritative source — proceed immediately using that skill (do not ask the user which execution mode to use).
2. After both phases are complete, run `spec-conformance` then `pr-reviewer`.
3. Update `tasks/builds/agent-as-employee/progress.md` as phases complete.
4. The spec file is large — use offset/limit reads when you need spec sections.
