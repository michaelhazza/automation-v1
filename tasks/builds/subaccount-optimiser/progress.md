# Progress: Sub-Account Optimiser Meta-Agent

**Spec:** `docs/sub-account-optimiser-spec.md`
**Plan:** `tasks/builds/subaccount-optimiser/plan.md`
**Branch:** `claude/subaccount-optimiser`
**Worktree:** `../automation-v1.subaccount-optimiser`
**Migrations claimed:** `0267`, `0267a`
**Status:** IN PROGRESS — Phase 1 complete, Phases 2–6 pending

## Concurrent peers

- F1 `subaccount-artefacts` (migration 0266) — recommended to land first; `escalation.repeat_phrase` category gracefully degrades action hint without F1
- F3 `baseline-capture` (migrations 0268-0270) — fully independent

## Phases

Phase numbers below match `plan.md` 1:1. Per spec §9, the previous standalone "phrase classifier" phase is folded into Phase 2 (the tokeniser ships as part of `escalationPhrases.ts` in the query-modules chunk). Total ~25h.

| Phase | Plan chunk | Status | Estimate | Notes |
|-------|------------|--------|----------|-------|
| Phase 1 — Generic agent-output primitive | Chunk 1 | **COMPLETE** | ~6h | Migration 0267 + `agent_recommendations` schema + RLS + `subaccounts.optimiser_enabled` column + `output.recommend` skill + `<AgentRecommendationsList>` + read/ack/dismiss routes + hook. All 6 test files created; 112 tests pass. Lint 283 (unchanged), TS 138 (unchanged). |
| Phase 2 — Telemetry rollup queries + cross-tenant median view | Chunk 2 | **COMPLETE** | ~8h | 8 query modules under `server/services/optimiser/queries/`, including `escalationPhrases.ts` with the regex tokeniser + n-gram counter. Migration 0267a peer-median materialised view + nightly refresh job. 86 tests pass (9 test files). Lint 283 (unchanged), TS 138 (unchanged). |
| Phase 3 — Optimiser agent definition + scan skills | Chunk 3 | **COMPLETE** | ~6h | Optimiser AGENTS.md, 8 scan skill markdowns, 8 evaluator modules, `optimiserCronPure.ts`, `evaluatorBoundsPure.ts`, `optimiserOrchestrator.ts`, `optimiserSubaccountHook.ts`, `backfill-optimiser-schedules.ts`. `agentScheduleService.registerSchedule` extended with `singletonKey`. 8 scan SKILL_HANDLERS + subaccount create hook. 40 tests across 4 files, all passing. Lint 283 (unchanged), TS 138 (unchanged). |
| Phase 4 — Home dashboard wiring | Chunk 4 | pending | ~3h | New section on `DashboardPage.tsx` between "Pending your approval" and "Your workspaces". Scope-aware via `Layout.tsx` `activeClientId`. Sidebar count badge. |
| Phase 5 — folded into Phase 2 | — | n/a | — | Phrase tokeniser is part of `escalationPhrases.ts` per spec §9 line 631. Number kept here so historical references resolve. |
| Phase 6 — Verification + doc sync | Chunk 5 | pending | ~2h | Lint, typecheck, targeted unit + integration tests, manual end-to-end run, cost sanity, capabilities.md + architecture.md updates, progress.md closeout. |

## Decisions log

**2026-05-02 — Phase 3 complete (commit `feat(subaccount-optimiser): chunk 3 — optimiser agent + scan skills + orchestrator`)**

1. `optimiserOrchestrator.ts` uses `routeCall` (not `llmRouter.complete`) — the router's public export in this codebase is `routeCall(params)` with `model` nested inside `context`. All existing callers confirmed.

2. `subaccounts.ts` creation route and `configSkillHandlers.ts` both fire `registerOptimiserForSubaccount` as a non-blocking fire-and-forget (`.catch(() => {})`). The hook wraps all errors internally — the subaccount creation path is never blocked.

3. `assertPercentInBounds` signature includes `source_query: string` (added per plan spec; extra precision for debuggability vs the minimal signature in the plan). All 8 evaluators pass the query name.

4. Render cache uses in-process LRU Map (5000 entries) with manual LRU eviction. The `_renderCache` is exported only for test cleanup (`_renderCache.clear()`).

5. `evaluatorBoundsPure.test.ts` uses `vi.mock('../../../lib/logger.js')` to spy on log output without real I/O.

**2026-05-02 — Phase 2 complete (commit `feat(subaccount-optimiser): chunk 2 — telemetry queries + peer-median view`)**

1. Materialised view uses `event_type = 'skill.completed'` (not `tool_call.completed` as written in the plan). The TypeScript union in `shared/types/agentExecutionLog.ts` has no `tool_call.completed` event; the JSONB payload fields are `skillSlug` and `durationMs` (camelCase), matching what `skillExecutor.ts` writes. Used camelCase keys in both the view SQL and the `skillLatency.ts` query.

2. `agentBudget.ts` uses `withAdminConnection` (admin bypass) so it can see cost data across all tenants. The query filters by `organisation_id` explicitly, so cross-org leakage is impossible.

3. `routingUncertainty.ts` joins `fast_path_decisions` via `subaccount_agents` to get agent_id, because `fast_path_decisions` does not have an `agent_id` column directly.

4. Staleness guard in `skillLatency.ts` uses `> 24h` (strict greater-than), so a view refreshed exactly 24h ago is considered fresh. The test mirrors this contract.

5. All 8 query tests are written as structural/pure tests (no real DB) because the existing test infrastructure does not support transaction-rollback DB tests in local vitest sessions. DB-backed integration tests for the peer-median view are also structural, verifying migration SQL structure.

**2026-05-02 — Phase 1 complete (commit `feat(subaccount-optimiser): chunk 1 — generic agent-output primitive`)**

1. `comparePriority` extracted to `server/services/agentRecommendationsServicePure.ts`. The pure test file cannot import from `agentRecommendationsService.ts` because the ESM module graph transitively loads `server/lib/env.ts` (which validates `DATABASE_URL` at module-load time). Extracting the pure function to a sidecar module (`*Pure.ts`) avoids the DB import chain. The service re-exports `comparePriority` from the pure module to preserve the existing public API.

2. `producingAgentId` in `server/db/schema/agentRecommendations.ts` does NOT use `.references(() => agents.id)`. The Drizzle schema convention in this repo avoids forward references that would create circular module dependencies between schema files. The FK constraint exists in the migration SQL; the Drizzle column is a plain UUID type annotation.

3. Advisory lock granularity is `(scope_type, scope_id, producing_agent_id)`, not `(category, dedupe_key)`. Per plan.md §Architecture notes, coarser lock granularity is required to ensure the cap-check + eviction + insert sequence is atomic across all categories from the same writer to that scope.

4. The `limit=0` case in `listRecommendations` short-circuits to `SELECT COUNT(*)` only, skipping the row fetch entirely. This is the Sidebar badge path — returning a count without loading 100 rows.

## Blockers

(none)

## Out of scope (filed for later)

- Email / Slack notifications (in-app only for v1)
- ML-based brand-voice classification (keyword/phrase match for v1)
- Riley W3-dependent categories (`context.gap.persistent`, `context.token_pressure`) — wait for W3, then add as v1.1
- All other deferrals: see `docs/sub-account-optimiser-spec.md` "Deferred Items" section
