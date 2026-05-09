# PR Review Log

```pr-review-log
**Branch:** `ui-consolidation-build`
**Base:** `origin/main` (HEAD `8ae2e7bb` at review)
**Review run at:** 2026-05-07T20:30:27Z
**Files reviewed:** 67 (full branch diff: 7842 insertions / 4711 deletions)
**Reviewer:** pr-reviewer (parent-session playbook execution)

**Verdict:** CHANGES_REQUESTED (1 blocking, 2 strong)

---

## Blocking Issues (must fix)

### B1 — Wrong post-delete navigation target on AgentEditPage

**File:** `client/src/pages/build/AgentEditPage.tsx:163`

After successful agent deletion, the page calls `navigate('/build/agents')`, but the new consolidated route registered in `client/src/App.tsx:396` is `/agents` (no `/build` prefix). The user lands on an unmatched route after deleting an agent.

**Proposed fix:** change line 163 to `navigate('/agents');` to match the route registered in App.tsx.

---

## Strong Recommendations (should fix)

### S1 — Project routes lack permission gate beyond `authenticate`

**Files:** `server/routes/projects.ts:17-37`

`GET /api/projects/:id` and `PATCH /api/projects/:id` only have `authenticate` middleware. There is no `requireOrgPermission(...)` gate. Org-scoping is enforced inside `projectService.getById` / `patch` via `organisationId` filter, so cross-org access is prevented, but any authenticated user inside the org can read or PATCH any project — including users who would not have `org.projects.edit` if such a permission key existed.

The legacy subaccount-scoped route at line 117 follows the same pattern (no `requireOrgPermission`), so this is consistent with the existing convention and not a regression. But it is weaker than what spec §6 names ("`requirePermission('projects:write')`"). The codebase does not currently expose a `PROJECTS_EDIT` ORG_PERMISSIONS key — adding one is a small uplift; alternatively gate the new routes behind an existing key like `AGENTS_EDIT` (consistent with how org-admin features are surfaced today) until a dedicated key is added.

**Proposed fix:** either (a) add an explicit `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)` gate on PATCH, OR (b) introduce `PROJECTS_EDIT` and apply it on PATCH plus document the new key in the architecture. Option (a) is non-breaking; option (b) is the long-term answer and out of scope for this build.

### S2 — `outputSize` enum mismatch between spec and schema

**Files:** `server/db/schema/agents.ts:52` vs `shared/types/build.ts:36-37` (and spec §4.2)

Schema defines `outputSize` as `'standard' | 'extended' | 'maximum'`, but spec §4.2 / `shared/types/build.ts` say `'compact' | 'standard' | 'extended'`. The service at `server/services/agentService.ts:1955` papers this over by falling back to `'standard'` for any value not in the spec set, so existing rows with `'maximum'` silently downcast to `'standard'` on read. PATCH writes accept `'compact'` even though the DB enum doesn't store it (`server/services/agentService.ts:2068` writes `outputSize` directly via Drizzle, which will succeed because the column is `text`).

This is not breaking — it works — but the schema-vs-API drift will produce surprising round-trip behaviour ("I set `compact`, the row got it, but reads claim `standard`"). The cleanest fix is a follow-up migration aligning the column enum with the API enum, OR an explicit comment in the schema noting the API → DB mapping.

**Proposed fix:** add a code comment to `server/db/schema/agents.ts` line 52 documenting that the API contract uses a different value set and the service layer normalises. Defer the schema migration to a follow-up.

---

## Non-Blocking Improvements

### N1 — `BehaviourTab.constraints` is accepted but discarded

`server/services/agentService.ts:2092-2094` notes that `constraints` is intentionally not persisted in Phase 1 (`additionalPrompt` is a single text field). The frontend `AgentBehaviourPatch` type still exposes `constraints?: string[]` (`shared/types/build.ts:84`). This isn't a bug — the comment captures it — but a future reader will wonder. Consider either omitting `constraints` from the type entirely until persistence lands, or marking it `@deprecated until-Phase-2` in the type.

### N2 — `RecurringTasksPage` does not surface `filterOptions` from the backend

`server/services/recurringTasksService.ts` returns `filterOptions` (faceted facets), but `RecurringTasksPage.tsx` only renders `filterable: true` on the `status` column and never wires the `filterOptions` into the `<SortableTable>` filter dropdown options. Spec §4.4 + plan name `filterOptions` as part of the response. This is a UX gap — the filter dropdown shows whatever values appear in the current page rather than the full faceted set. Acceptable for Phase 1; flag for Phase 2 polish.

### N3 — Potential dead code in `client/src/pages/build/AgentEditPage.tsx`

The TAB_ORDER includes `'budget'` but WRITE_ORDER excludes it, so any "dirty" budget patch (set via the disabled tab) would never get sent. Since `BudgetTab.tsx` has the inputs disabled and the tab is read-only, no patch can actually be set, so the omission is a defence-in-depth measure rather than dead code. Worth a one-line comment confirming this is intentional rather than a typo.

---

## Positive observations (no action)

- `asyncHandler` is wrapped on every new route handler. No manual try/catch except the intentional cursor-decode catch in `recurringTasks.ts:62-71` (which is correct — converting a domain error class into a 400).
- `isNull(table.deletedAt)` filter applied on every query into `agents`, `projects`, `subaccounts`, `agentTriggers` in the new code paths. Verified via grep across `agentService`, `projectService`, `recurringTasksService`.
- Org-scoping (`organisationId` filter) is enforced at the service layer for every read and write. ETag concurrency is enforced before any write proceeds.
- Pure-helper tests are colocated for `agentEtag`, `identityKeyDiff`, `recurringTasksServicePure` (658 lines), `agentTestRunMapperPure`, `projectServicePure`. Posture matches `static_gates_primary` + `pure_function_only`.
- Lazy-loaded route entries with Suspense in `App.tsx` for all four new build pages.
- Migration 0286 is additive only (three new columns + one GIN index), no destructive changes; down-migration ships.
- Three-tier agent model preserved — `_assertNotSystemManaged` guard called on every tab-scoped writer (`agentService.ts:2038, 2087, 2111, 2141, 2178, 2235, 2302`). System agents remain read-only for non-system-admin actors.
- Legacy redirects in App.tsx cover `/admin/agents`, `/admin/skills`, `/admin/skill-studio`, `/system/skill-analyser`, `/admin/subaccounts/:saId/scheduled-tasks`, `/admin/subaccounts/:saId/goals` — bookmarks won't 404.
- ADR 0007 captures the consolidation decision with rationale; doc-sync of architecture.md / capabilities.md / KNOWLEDGE.md committed in `74239a9f`.
```
