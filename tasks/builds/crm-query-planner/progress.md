# CRM Query Planner — build progress

**Branch:** `claude/crm-query-planner-WR6PF`
**PR:** #177 — https://github.com/michaelhazza/automation-v1/pull/177
**Spec:** `tasks/builds/crm-query-planner/spec.md`
**Status:** MERGE-READY (2026-04-22)

---

## Phases delivered

### P1.0 — Skeleton
Shared types, empty pipeline, route wiring, `crm.query` action registered in `actionRegistry.ts`. Smoke test: route returns error artefact end-to-end.

### P1.1 — Stage 1 golden path
- `normaliseIntentPure.ts` + `registryMatcherPure.ts`
- Canonical query registry + alias collision detection
- Stage 1 deterministic pipeline
- `scripts/verify-crm-query-planner-read-only.sh` CI guard

### P1.2 — Stage 2 plan cache
- `planCache.ts` + `planCachePure.ts` with LRU + TTL tiers
- Full alias coverage tests, settings keys added
- Discriminated hit/miss result

### P2 — LLM fallback + live executor
- `llmPlannerPromptPure.ts` + `schemaContextPure.ts` + `schemaContextService.ts`
- `llmPlanner.ts` (single-escalation retry, `wasEscalated` propagation)
- `ghlReadHelpers.ts` (4 new GHL read helpers)
- `liveExecutorPure.ts` + `liveExecutor.ts` (rate-limiter keyed on real GHL locationId)

### P3 — Hybrid executor + observability
- `hybridExecutorPure.ts` + `hybridExecutor.ts` (row-count guard, cap errors)
- `getPlannerMetrics` in `systemPnlService.ts`
- `/api/admin/llm-pnl/planner-metrics` route
- `SystemPnlPage.tsx` CRM Query Planner metrics subsection
- `live_call_failed` error code on `BriefErrorCode`

---

## Review rounds (logs in `tasks/review-logs/`)

1. **spec-conformance** — 2 mechanical fixes (`BudgetExceededError` branch, `cost_prediction_drift` warn) + 6 directional gaps routed to todo.md. Log: `spec-conformance-log-crm-query-planner-2026-04-22T09-17-12Z.md`.
2. **Directional gap fixes (in-session)** — all 6 closed: PlannerEvent `at` scalar, discriminated cache-miss reason, three-case canonical-precedence, RLS wrapping on `runQuery`, PlannerTrace accumulator, real capability check in route.
3. **pr-reviewer round 1** — 6 blockers (B1 BudgetExceededError shape match, B2 wasEscalated, B3 rate-limiter key, B4 test seam, B5 RLS integration test, B6 skillExecutor handler). Log: `pr-review-log-crm-query-planner-2026-04-22T09-45-00Z.md`.
4. **B1–B6 fixes (in-session)** — all 6 closed.
5. **pr-reviewer round 2** — 1 new blocker (B7 cross-subaccount guard in skillExecutor) + strong recs. Log: `pr-review-log-crm-query-planner-2-2026-04-22T10-30-00Z.md`.
6. **B7 + S11–S16 fixes (in-session)** — all closed.
7. **dual-reviewer** — 2 iterations + partial 3rd, 6 accepted / 2 deferred. Canonical-resolvable base guard extended across sort/projection/aggregation; `BUDGET_EXCEEDED` vs `RATE_LIMITED` 402 discriminator; `withPrincipalContext` snapshot-and-restore; integration test ALS wiring. Log: `dual-review-log-crm-query-planner-2026-04-22T10-57-26Z.md`.
8. **ChatGPT final review rounds 1–3** — 10 implemented / 4 rejected / 4 deferred. Rounds 1 + 2 + 3 + finalisation all appended to a single log: `chatgpt-pr-review-crm-query-planner-2026-04-22T11-07-47Z.md`. KNOWLEDGE.md pattern extraction complete.

---

## Verification

- **Typecheck:** clean (only pre-existing unrelated client errors in `ClarificationInbox.tsx` and `SkillAnalyzerExecuteStep.tsx`).
- **Planner unit tests:** 233/233 across 13 suites.
- **Integration test:** skips cleanly without `DATABASE_URL`; verifies session-variable propagation via `current_setting(...)` on the active tx when run.

---

## Deferred (captured in `tasks/todo.md`)

1. ID-scoped live fetch for hybrid execution (canonical-base + per-row live join)
2. Runtime read-only adapter enforcement (complements the structural CI guard)
3. Live executor retry taxonomy (retryable vs terminal classification)
4. Principal `teamIds` resolution (cross-cutting, needs shared resolver in auth middleware)
5. Stage-hit-rate + cache-hit-rate dashboard metrics
6. Hybrid executor's under-fetching for untranslated live-only fields (pagination or promotion whitelist)
7. Spec §16.1 `systemCallerPolicy` self-contradiction (`'strict'` vs `'bypass_routing'`) — spec-only fix

---

## Commits (head first)

- `bd73deec` chore(review): finalise chatgpt-pr-review session — KNOWLEDGE.md + deferred-sweep + totals
- `4bd6ea78` fix(crm-query-planner): round-3 polish — executionMode trace, cache-version + retry-posture docs
- `51e2a691` fix(crm-query-planner): round-2 polish — single terminal forwarding, error-subcategory split, orchestration cache tests
- `a1bb8663` fix(crm-query-planner): round-1 — capability-skip log, filter-drop diagnostics, hybrid row-count guard
- `0bdc61b6` fix(crm-query-planner): close spec-conformance + pr-review + dual-review findings
- `60bda7a1` feat(crm-query-planner): implement P2 + P3 — LLM fallback, live/hybrid executors, observability
- `7b2694fa` docs(todo): defer crm-query-planner RLS integration test
- `e590ac2c` feat(crm-query-planner): add resolveAmbientRunId helper (spec §18.1)
- `2c2d6978` feat(crm-query-planner): P1.2 final — full alias coverage tests + settings keys
- `051ebfc5` feat(crm-query-planner): P1.2 — Stage 2 cache read + alias collision fixes
- `f6f308c6` feat(crm-query-planner): P1.1 audit — add missing pure modules, tests, and static gate
- `03a218b9` feat(crm-query-planner): P1.0 + P1.1 golden path — Stage 1 deterministic pipeline
