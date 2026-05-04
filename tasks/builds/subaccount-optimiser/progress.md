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
| Phase 2 — Telemetry rollup queries + cross-tenant median view | Chunk 2 | pending | ~8h | 8 query modules under `server/services/optimiser/queries/`, including `escalationPhrases.ts` with the regex tokeniser + n-gram counter. Migration 0267a peer-median materialised view + nightly refresh job. |
| Phase 3 — Optimiser agent definition + scan skills | Chunk 3 | pending | ~6h | Optimiser AGENTS.md, 8 scan skill markdowns, 8 evaluator modules, schedule registration, backfill script, `subaccountService.create` hook. First consumer of the Phase 1 primitive. |
| Phase 4 — Home dashboard wiring | Chunk 4 | pending | ~3h | New section on `DashboardPage.tsx` between "Pending your approval" and "Your workspaces". Scope-aware via `Layout.tsx` `activeClientId`. Sidebar count badge. |
| Phase 5 — folded into Phase 2 | — | n/a | — | Phrase tokeniser is part of `escalationPhrases.ts` per spec §9 line 631. Number kept here so historical references resolve. |
| Phase 6 — Verification + doc sync | Chunk 5 | pending | ~2h | Lint, typecheck, targeted unit + integration tests, manual end-to-end run, cost sanity, capabilities.md + architecture.md updates, progress.md closeout. |

## Decisions log

**2026-05-02 — Phase 1 complete (commit `feat(subaccount-optimiser): chunk 1 — generic agent-output primitive`)**

1. `comparePriority` extracted to `server/services/agentRecommendationsServicePure.ts`. The pure test file cannot import from `agentRecommendationsService.ts` because the ESM module graph transitively loads `server/lib/env.ts` (which validates `DATABASE_URL` at module-load time). Extracting the pure function to a sidecar module (`*Pure.ts`) avoids the DB import chain. The service re-exports `comparePriority` from the pure module to preserve the existing public API.

2. `producingAgentId` in `server/db/schema/agentRecommendations.ts` does NOT use `.references(() => agents.id)`. The Drizzle schema convention in this repo avoids forward references that would create circular module dependencies between schema files. The FK constraint exists in the migration SQL; the Drizzle column is a plain UUID type annotation.

3. Advisory lock granularity is `(scope_type, scope_id, producing_agent_id)`, not `(category, dedupe_key)`. Per plan.md §Architecture notes, coarser lock granularity is required to ensure the cap-check + eviction + insert sequence is atomic across all categories from the same writer to that scope.

4. The `limit=0` case in `listRecommendations` short-circuits to `SELECT COUNT(*)` only, skipping the row fetch entirely. This is the Sidebar badge path — returning a count without loading 100 rows.

## Stream 2 Closeout (2026-05-04)

### Status: COMPLETE

### Phases completed (Stream 2)
- Phase 2 — Migration 0268: peer-medians materialised view + system_agents seed (Chunk 1)
- Phase 2 — Peer-medians nightly refresh job (Chunk 2)
- Phase 2 — 7 non-peer query modules + evaluators (Chunk 3)
- Phase 2 — skillLatency + skillSlow (peer-dependent) (Chunk 4)
- Phase 3 — Orchestration: runOptimiserScan, renderRecommendation, AGENTS.md, 8 scan skills (Chunk 5)
- Phase 3 — Scheduling: registerOptimiserSchedule, backfill script, subaccount-create hook (Chunk 6)
- Phase 4 — Dashboard wiring + zero-state non-mount (Chunk 7)
- Phase 4 — Verification matrix + doc updates (Chunk 8)

### Decisions made in Stream 2
- median_version carried inside evidence JSONB — no second migration required
- escalationRate groups by workflow_name (not ID) — flow_runs has no stable FK to a workflows table
- routingUncertainty resolves agent_id via fast_path_decisions.briefId to tasks.assignedAgentId
- Materialised view emptiness signals partial-mode (not failure) per invariant 22
- Integration tests deferred to CI gate — local session runs pure/mock tests only

### Cost measurement
- Integration cost gate (<$0.02/subaccount/day) deferred to CI with live DB + LLM access
- renderRecommendation.ts logs optimiser.render.tokens_used on every call for observability

---

## Blockers

(none)

## Out of scope (filed for later)

- Email / Slack notifications (in-app only for v1)
- ML-based brand-voice classification (keyword/phrase match for v1)
- Riley W3-dependent categories (`context.gap.persistent`, `context.token_pressure`) — wait for W3, then add as v1.1
- All other deferrals: see `docs/sub-account-optimiser-spec.md` "Deferred Items" section
