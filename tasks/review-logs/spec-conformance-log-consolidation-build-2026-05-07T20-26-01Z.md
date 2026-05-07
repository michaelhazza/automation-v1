# Spec Conformance Log

**Spec:** `tasks/builds/consolidation-build/spec.md`
**Spec commit at check:** `8ae2e7bb` (HEAD of `ui-consolidation-build`)
**Branch:** `ui-consolidation-build`
**Base:** merge-base with `origin/main`
**Scope:** all-of-spec — single-phase build, all 13 chunks completed (C1, C2, C3, C3b, C4, C5, C5b, C6, C7, C8, C9, C10, C11). Operator confirmed all-of-spec coverage at handoff.
**Changed-code set:** 67 files
**Run at:** 2026-05-07T20:26:01Z

---

## Summary

- Requirements extracted: 38 (concrete + named)
- PASS: 36
- DIRECTIONAL_GAP: 2 (both already documented in `migration-gaps.md`)
- AMBIGUOUS / OUT_OF_SCOPE: 0

**Verdict:** CONFORMANT (no mechanical fixes applied; deferred items recorded in `migration-gaps.md` rather than `tasks/todo.md` to avoid duplication).

---

## Requirements verified (by spec section)

### §4.1 Agents list
- AgentListItem export at `shared/types/build.ts:1-24` — PASS
- `GET /api/agents?scope=&q=` consumed by `AgentsListPage.tsx` — PASS

### §4.2 Agent edit (GET /:id/full + tab-scoped writers + ETag)
- `GET /:id/full` route + service — PASS (`agentTabs.ts:25-35`, `agentService.getFull` line 1814)
- 4 PATCH (configure/behaviour/personality/budget) + 3 PUT (skills/data-sources/triggers) endpoints — PASS (`agentTabs.ts:39-181`)
- ETag = sha256 canonical JSON — PASS (`server/lib/agentEtag.ts:30-33`, tests at `agentEtagPure.test.ts`)
- 428 on If-Match missing, 409 ETAG_MISMATCH on conflict, 200 with new etag on success — PASS (`agentEtagPrecondition.ts`, `agentService.ts:2026`)
- Full-replacement deletion safeguard (`force=true`) — PASS (`identityKeyDiff.ts` + `replaceSkills/DataSources/Triggers`)

### §4.3 Agent test-run async
- `POST /:id/test` returns 202 with runId — PASS (`agents.ts:195-249`)
- `GET /api/agent-runs/:id?shape=test` returns AgentTestResult — PASS (`agentRuns.ts:167-198`, `agentTestRunMapperPure.ts`)
- Idempotency via `deriveTestRunIdempotencyCandidates` — PASS
- Rate-limit on test runs — PASS (`TEST_RUN_RATE_LIMIT_PER_HOUR`)

### §4.4 Recurring tasks aggregator
- `GET /api/recurring-tasks` route — PASS (`server/routes/recurringTasks.ts`)
- RecurringTask shape exported — PASS (`shared/types/build.ts:138-150`)
- Union over triggers + scheduled_tasks + manual runs with three parallel queries — PASS (`recurringTasksService.ts:37-167`)
- Sort with id tiebreaker, faceted `filterOptions`, cursor pagination — PASS (`recurringTasksServicePure.ts`)
- 400 on cursor decode error — PASS (`recurringTasks.ts:62-71`)

### §4.5 Project PATCH expansion
- All 10 fields accepted — PASS (`projectService.ts:24-39`, `routes/projects.ts:30-37`)
- linkedAgents validated against existing agents (422 on unknown) — PASS (`projectService.ts:108-118`)
- Explicit null clears, omitted = no-op — PASS (`fromApiPatch:62-83`)
- Migration 0286 adds `objective`, `linked_agent_ids` (with GIN index), `migrated_from_goals_at` — PASS

### §4.6 FormFooter usage
- AgentEditPage + ProjectEditPage use `<FormFooter>` with `bottomPadding={100}` — PASS

### §4.7 Inline TestRunnerCard
- Inline `section-card` (not modal) — PASS (`TestRunnerCard.tsx:67`)
- In-flight guard disables Run during polling — PASS (`TestRunnerCard.tsx:47`)

### §4.8 SearchBox + Empty/ErrorState
- AgentsListPage + RecurringTasksPage wire SearchBox + EmptyState + ErrorState — PASS

### §4.9 formatFireCondition()
- Pure helper at `recurringTasksServicePure.ts:177-233` — PASS (UTC, deterministic, 80-char truncation, manual/event/schedule branches; tests at line 658 of test file)

### §4.10 AgentVersionChip
- `vN` chip with `Math.max(1, count)` floor — PASS (`AgentVersionChip.tsx:10`)
- Tooltip with editedAt + author — PASS (line 11-14)
- Wired on Agents list — PASS (`AgentsListPage.tsx:41`)

### §4.11 Confirmation dialogs
- Type-to-confirm Delete agent — PASS (`DeleteAgentDialog.tsx:13`)
- Conditional type-to-confirm Delete project (linked agents > 0) — PASS (`DeleteProjectDialog.tsx:16-18`)

### §4.12 Tab UX details
- Skills tier chips with system/org/workspace tooltip strings — DIRECTIONAL_GAP (see deferred items)
- Runs tab cost column + 30d cost summary — PASS (`RunsTab.tsx:46,65`)

### §5 File inventory
- All 19 created files exist with named exports — PASS
- All 8 modified files touched — PASS
- All 9 retired legacy pages deleted (AdminAgentEditPage, AdminAgentsPage, AdminSkillEditPage, AdminSkillsPage, GoalsPage, ScheduledTasksPage, SkillAnalyzerPage, SkillStudioPage, SystemAgentsPage) — PASS

### §6 Permissions / RLS / execution model
- AGENTS_VIEW reads / AGENTS_EDIT writes on tab routes — PASS
- No new tables; column-level RLS unchanged — PASS
- ETag concurrency on writes; idempotency-key on test runs — PASS

### §8 Testing posture
- Colocated pure tests for ETag, identity-key diff, recurring-tasks aggregator, test-run mapper, project service — PASS

---

## Mechanical fixes applied

None. The branch went through per-chunk fix rounds in prior commits (`a1c006e0`, `fadcba36`, `546f9939`, `484e340d`, `0440876b`, `8ae2e7bb`) before this verification. No mechanical gaps remained.

---

## Directional gaps (deferred — already in migration-gaps.md)

1. **REQ #37 — Skills tier chips with tier-source tooltips (spec §4.12)**. Current `SkillsTab.tsx` shows status pills only. Tier resolution requires joining `skills` against `system_skills` / `subaccountSkills` plus UI rewiring — architectural choice. Documented as a follow-up; not blocking.
2. **REQ #10 partial — Budget tab persistence (spec §4.2 / §4.12)**. `patchBudget` accepts payloads but `agents` table lacks `daily_cap_usd` / `monthly_cap_usd` / `warn_threshold_pct` columns. Already in `migration-gaps.md` § "AgentFull.budget — no backing schema". UI is read-only (`BudgetTab.tsx:9-18`) so no user-facing inconsistency.

Both items are recorded in `tasks/builds/consolidation-build/migration-gaps.md` (committed at `8ae2e7bb`). Not appending to `tasks/todo.md` to avoid duplication. The operator should grep `migration-gaps.md` post-merge for follow-up planning.

---

## Files modified by this run

None.

---

## Next step

CONFORMANT — proceed to `pr-reviewer`.
