# Stream 2 — Sub-account optimiser finish (F2 Phases 1-4)

| Field | Value |
|---|---|
| Stream | 2 of 2 (concurrent with Stream 1) |
| Goal | Ship F2 Phases 1-4 — the optimiser agent itself, telemetry rollups, dashboard wiring, verification. Phase 0 (the generic `agent_recommendations` primitive) already shipped on main. |
| Status | READY TO START — spec revised against main 2026-05-04 |
| Branch | `claude/stream-2-optimiser-finish` |
| Worktree | `../automation-v1.stream-2-optimiser-finish` |
| Spec (canonical) | `docs/sub-account-optimiser-spec.md` |
| Existing build dir | `tasks/builds/subaccount-optimiser/` (carries Phase 0 closeout) |
| Migrations claimed | One additional — for the cross-tenant peer-medians materialised view (was reserved as `0267a` in spec; **claim next-free integer at build time**, e.g. `0281`) |
| Total estimated effort | ~19h (~3 dev-days) |

This file is the orchestration layer. Phase-level detail lives in the spec — do not duplicate it here.

---

## What's already shipped (do not rebuild)

Per `tasks/builds/subaccount-optimiser/progress.md`, **Phase 0 SHIPPED on main 2026-05-02 via PR #251**:

- Migration `0267` — `agent_recommendations` table + RLS + 4 indexes + `subaccounts.optimiser_enabled` boolean
- `server/db/schema/agentRecommendations.ts` (+ `dismissed_until` column + discriminated-union `RecommendationEvidence` type)
- `server/services/agentRecommendationsServicePure.ts` (priority comparator + drop-log helper)
- `server/skills/output/recommend.md` + executor case in `server/services/skillExecutor.ts`
- `client/src/components/recommendations/AgentRecommendationsList.tsx` + `useAgentRecommendations` hook
- Read / acknowledge / dismiss endpoints in `server/routes/agentRecommendations.ts`
- 112 tests pass; lint + typecheck unchanged

The **primitive is reusable infrastructure** — any agent can produce recommendations through `output.recommend`. Stream 2 is the first full consumer.

## Coordination with Stream 1

Stream 1 = F1 + F3 (sub-account onboarding scope). **Fully orthogonal** — different files, different services, different scope. Zero coordination required beyond final merge to main.

The one cross-stream signal: F2's `escalation.repeat_phrase` recommendation produces a better action hint when F1's brand-voice artefact is captured. F2 degrades gracefully without it. **No build-time dependency** — Stream 2 can ship before, during, or after Stream 1 without rebase pain.

## Stream 2 sequence

```
Branch claude/stream-2-optimiser-finish
  └── F2 Phases 1-4 (per spec §9)
        Phase 1 — Telemetry rollup queries + cross-tenant median view (~8h)
        Phase 2 — Optimiser agent definition + scan skills (~6h)
        Phase 3 — Home dashboard wiring (~3h)
        Phase 4 — Verification (~2h)
        PR → review + merge to main
```

## Phase summary (full detail in spec §9)

| Phase | Effort | Phase output |
|---|---|---|
| 1 — Telemetry rollups + peer-medians view | ~8h | 8 query modules under `server/services/optimiser/queries/` (`agentBudget`, `escalationRate`, `skillLatency`, `inactiveWorkflows`, `escalationPhrases`, `memoryCitation`, `routingUncertainty`, `cacheEfficiency`); cross-tenant materialised view migration + nightly refresh job; per-query unit tests (8 files). All scan SQL must include `created_at >= now() - interval '7 days'` ceiling. |
| 2 — Optimiser agent + scan skills | ~6h | `companies/automation-os/agents/subaccount-optimiser/AGENTS.md`; 8 scan skill markdown specs in `server/skills/optimiser/`; 8 evaluator modules; LLM render step (Sonnet, cached by `(category, dedupe_key, evidence_hash, render_version)`); schedule registration via `agentScheduleService`; backfill script staggered across 6h window; `subaccountService.create` hook; integration test. |
| 3 — Home dashboard wiring | ~3h | New section on `client/src/pages/DashboardPage.tsx` between "Pending your approval" and "Your workspaces". Scope-aware via `Layout.tsx` `activeClientId`. Sidebar count badge. Hide section when zero open recs. Socket subscription on `dashboard.recommendations.changed`. |
| 4 — Verification | ~2h | Lint + typecheck + targeted tests + manual E2E in BOTH org and sub-account context + cost-model sanity (<$0.10 / 5 sub-accounts × 7d) + doc updates (`capabilities.md`, `architecture.md`) + progress closeout. |

## Migration claim

One new migration for the cross-tenant peer-medians materialised view (referenced in spec as `0267a`, but **claim a clean next-free integer** at build time — likely `0281` if main hasn't moved, but verify via `ls migrations/`). The spec is explicit (§14): a non-suffix integer is preferred over `0267a` since the rest of the repo doesn't use lettered suffixes.

## Files touched (summary)

Server: 8 new query modules under `server/services/optimiser/queries/`, 8 evaluator modules under `server/services/optimiser/recommendations/`, `skillExecutor.ts` (8 new cases for scan skills), `agentScheduleService.ts` (register optimiser schedule), `subaccountService.ts` (create-hook), `server/jobs/refreshOptimiserPeerMedians.ts`, `scripts/backfill-optimiser-schedules.ts`, one new migration. Skills + agent: `companies/automation-os/agents/subaccount-optimiser/AGENTS.md`, 8 skill specs in `server/skills/optimiser/`. Client: `DashboardPage.tsx` (new section only — reuses existing `<AgentRecommendationsList>` component shipped in Phase 0). Full list in spec §10.

## Risks

- **Recommendation noise.** Spec §13 lists tuning levers (severity tuning, dedupe, hard cap of 10, material-change thresholds, dismiss cooldown). All baked into Phase 0 primitive — Stream 2 just needs to use them correctly.
- **Cross-tenant median leakage.** Peer-median view enforces minimum 5-tenant threshold per skill in the view definition (HAVING clause). Don't bypass at the application layer.
- **Schedule storm.** Backfill staggers daily-cron registration by `created_at` hash across 6h window. Don't parallel-register.
- **Silent scan failures.** Each scan-skill invocation wrapped in try/catch; failures emit `recommendations.scan_failed` structured log. Don't break the contract.

## Riley W3 dependency (informational, not blocking)

Spec §15 lists two recommendation categories that become trivial once Riley W3 (`context.assembly.complete` event) ships: `context.gap.persistent` and `context.token_pressure`. **Riley W3 has NOT shipped** (verified 2026-05-04 — zero matches in `server/lib/tracing.ts` and `server/services/agentExecutionService.ts`). These two categories are NOT in v1 scope. Add as Phase 5 follow-up when W3 ships.

## Done definition (Stream 2)

- F2 PR merged to main with `pr-reviewer` + `chatgpt-pr-review` clean
- All 8 scan categories produce realistic recommendations against fixture telemetry
- Home dashboard section renders correctly in BOTH org and sub-account context
- Cost stays under $0.02 per sub-account per day in measured runs
- `tasks/builds/subaccount-optimiser/progress.md` closed out (Phases 2-6 in progress.md numbering = §9 Phases 1-4 in spec — see existing offset note in progress file)
- `KNOWLEDGE.md` appended for any patterns learned
- `docs/capabilities.md` § Sub-account observability updated

## Kickoff prompt

> "load context pack: implement. Start Stream 2 — F2 optimiser finish. Spec is `docs/sub-account-optimiser-spec.md`. Phase 0 ALREADY SHIPPED on main (PR #251) — do NOT rebuild the `agent_recommendations` primitive. Build §9 Phases 1-4 only. Use `architect` to produce the plan, then `superpowers:subagent-driven-development`. Branch `claude/stream-2-optimiser-finish`. Claim next-free migration integer (likely `0281`) for the peer-medians materialised view; verify via `ls migrations/` at build start. Independent of Stream 1 — no coordination required beyond final merge."
