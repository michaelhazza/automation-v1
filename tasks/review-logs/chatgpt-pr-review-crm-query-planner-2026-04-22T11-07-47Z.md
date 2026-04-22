# ChatGPT PR Review Session — crm-query-planner — 2026-04-22T11-07-47Z

## Session Info
- Branch: `claude/crm-query-planner-WR6PF`
- PR: #177 — https://github.com/michaelhazza/automation-v1/pull/177
- Spec: `tasks/builds/crm-query-planner/spec.md`
- Started: 2026-04-22T11:07:47Z
- Prior review artefacts consulted:
  - `tasks/review-logs/spec-conformance-log-crm-query-planner-2026-04-22T09-17-12Z.md`
  - `tasks/review-logs/pr-review-log-crm-query-planner-2026-04-22T09-45-00Z.md`
  - `tasks/review-logs/pr-review-log-crm-query-planner-2-2026-04-22T10-30-00Z.md`
  - `tasks/review-logs/dual-review-log-crm-query-planner-2026-04-22T10-57-26Z.md`

---

## Round 1 — 2026-04-22T11:07:47Z

### ChatGPT Feedback (raw)

> Executive summary: high-quality PR, architecturally solid, unusually well-tested. Four areas flagged before "production-grade": subtle correctness risks in hybrid + live execution, enforcement gaps (read-only, capability, cost semantics), observability gaps, architectural inconsistencies.

What's strong (keep as-is):
1. Clean staged architecture (Stage 1 deterministic → Stage 2 structured → Stage 3 LLM, hybrid as controlled escape hatch)
2. Registry design — alias normalisation + collision detection, explicit allowedFields, forward-looking capability model
3. Pure function separation (*_Pure.ts pattern)
4. Test coverage: planner logic, registry matching, hybrid splitting, cost calc, RLS isolation
5. CI guard `scripts/verify-crm-query-planner-read-only.sh` for read-only enforcement

Key issues flagged (priority order given at end):

1. [Must fix] Hybrid executor operationally naïve — fetches all live data in one call, filters in memory, cap based on number of filters rather than data volume. Will break at scale: latency, memory, rate limits. Short-term: row-count guard before live execution + max-payload heuristic. Mid-term: ID-scoped live fetch (pass canonical IDs into live query).

2. [Must fix] Read-only guarantee strong in CI, weak at runtime. Grep-based CI guard + import discipline don't catch indirect writes via shared helpers or future adapter changes. Recommend marking executor context as `readOnly = true` and having adapters throw on write in that context.

3. [Should fix] Capability model intentionally bypassed — `canonicalExecutor.ts` skips `canonical.*` as forward-looking. Future contributors will assume caps are enforced; silent privilege expansion risk. At minimum log when skipped + metric `planner.capability_skipped_rate`. Better: feature flag `ENFORCE_CANONICAL_CAPS=false` for safe future rollout.

4. [Should fix] Plan cache lacks poisoning protection — low-confidence Stage 3 plans get cached. Recommend threshold: only cache when `confidence === high` OR validated hybrid plans. Right now low-quality LLM outputs can persist in the cache.

5. [Must fix] Observability gap — `/api/admin/llm-pnl/planner-metrics` exists but no per-query trace visibility. Can't see intent → stage decision, registry match vs LLM, fallback reason, execution path. Already have `plannerEvents.ts` → expand aggressively (stage1_hit, stage3_invoked, hybrid_used, fallback_reason).

6. [Should fix] Live executor lacks retry/resilience — rate-limiter acquire is good, but no retry on transient failure, no fallback behaviour, no partial result handling. Even a minimal "1 retry on rate-limited + distinguish retryable vs terminal errors" would help.

7. [Minor] Translation layer in `liveExecutorPure.ts` silently drops filters — `query: extractFilterValue(filters, 'email') ?? …` assumes single-filter priority, ignores multi-filter composition. At least log when filters are ignored, or explicitly restrict allowed combinations.

Smaller observations:
- `withPrincipalContext` snapshot/restore is correct and well-documented (good)
- RLS integration test is strong (good)
- `randomUUID()` in approval cards — not deterministic (fine, but note for replay/debug)
- Planner metrics panel missing hit rate (Stage 1 vs 3) and cache hit rate

Priority:
- Must fix: hybrid scalability guard, runtime read-only enforcement, planner observability events (#1, #2, #5)
- Should fix soon after: cache poisoning guard, capability enforcement visibility, basic retry logic (#4, #3, #6)

Round 2 available: "focused purely on crmQueryPlannerService.ts orchestration logic".

### Adjudication framing

The PR ships v1 of the planner. Production-grade hardening that requires new system-wide primitives (runtime write-denial adapters, feature-flag infrastructure, ID-scoped live fetch with pagination) is out of scope — route to backlog. Prefer small, surgical fixes that extend existing primitives (`plannerEvents.emit`, `capabilityMapService`, structured logs, registry metadata) over introducing parallel systems.

### Decisions

| # | Finding | Decision | Severity | Rationale |
|---|---------|----------|----------|-----------|
| 1 | Hybrid operationally naïve — row-count guard + ID-scoped live fetch | partial accept / defer rest | high | ID-scoped live fetch + pagination-aware `applyLiveFilter` is already deferred as dual-reviewer Codex iter-1 finding 2 — cross-cutting, keep deferred. Accept the small piece: add a warn log when canonical base hits plan.limit (near-cap) so hybrids over a saturated base are observable. `plan.limit` defaults to 100 per spec §13.4 / §14.3, which structurally bounds in-memory fan-out in v1. |
| 2 | Runtime read-only enforcement — ExecutorContext `readOnly=true`; adapters throw on write | defer | high | Cross-cutting adapter primitive. Current design is deliberately structural (static CI guard + import discipline). Runtime write-denial wrapper is a separate systemic change — belongs in its own PR. |
| 3 | Log + event when `canonical.*` capability skipped | accept | medium | Spec §12.1 taxonomy note explicitly requires `capabilityCheck: 'skipped_unknown_capability'` logging with slug name — current impl silently skips. Small, surgical, uses existing primitives. Feature flag is deferred (larger primitive). |
| 4 | Only cache when `confidence === high` | reject | medium | Spec §9.2.1 "Anti-poisoning (cache confidence tiering)" documents this explicitly: the mitigation is **tiered TTL** (`low` = 15 s), not exclusion. Removing low-confidence caching invalidates a documented spec invariant. |
| 5 | Observability gap — per-query trace visibility | reject (already shipped) | high | `PlannerTrace` is wired end-to-end per §6.7 / §17.1 — `freezeTrace()` is attached to every terminal emission. Reviewer appears to have missed this. No action. |
| 6 | Live executor retry on rate_limited | defer | medium | Spec §13 / §14.3 explicitly documents fail-fast in v1. Changing that needs spec-amendment-then-implementation, not this PR. |
| 7 | Translation layer silently drops multi-filter composition | accept | low | `translateToProviderQuery` picks one `query` value from email/firstName/lastName with `??` chains and drops the others. Add a debug log when >1 name-like filter is provided so the drop is observable in the trace. |

### Observation-level items

- `randomUUID()` in approval cards — reject (no action). Artefact IDs are intentionally unique per response per spec §15.4.
- Planner metrics panel missing Stage 1 vs 3 hit rate + cache hit rate — defer. Dashboard enhancement; underlying events already emitted.

### Architectural checkpoint

None trigger. Accepted items (1, 3, 7) are small-fix extensions of existing primitives — no contract/interface changes, single-file each.

### Scope check

Accepted changes land in 3 files (`hybridExecutor.ts`, `canonicalExecutor.ts`, `liveExecutorPure.ts`) + their tests. Well under the +500-line / 20-file warning threshold.

### Implemented

- `server/services/crmQueryPlanner/executors/canonicalExecutor.ts` — emit `capabilityCheck: 'skipped_unknown_capability'` structured log when a `canonical.*` or `clientpulse.*` slug is skipped per §12.1 taxonomy note.
- `server/services/crmQueryPlanner/executors/hybridExecutor.ts` — warn log `hybrid.base_at_plan_limit` when canonical base `rowCount >= plan.limit` and live filters are present (near-cap signal; see Finding #1 partial accept).
- `server/services/crmQueryPlanner/executors/liveExecutorPure.ts` — debug log `live.filter_composition_dropped` when the `contacts` translation picks one of email/firstName/lastName and ignores others (Finding #7). Implementation note: `liveExecutorPure.ts` is a pure module and previously had no logger dependency; passing in a minimal log sink keeps it pure (caller wires `logger.debug`). Fallback: export a small helper `detectDroppedContactFilters(filters)` and call it from `liveExecutor.ts` where `logger` already lives.

### Deferred (routed to tasks/todo.md)

- Finding #1 (remainder — ID-scoped live fetch / pagination-aware applyLiveFilter)
- Finding #2 (runtime read-only adapter enforcement)
- Finding #6 (live executor retry on rate_limited — spec change required first)
- Observation — planner metrics panel Stage 1 vs 3 hit-rate / cache-hit-rate surfacing

### Round 2 preview

ChatGPT offered a "round 2 focused purely on `crmQueryPlannerService.ts` orchestration logic". Delivered in the round 2 section below.

---

## Round 2 — 2026-04-22T11:28:00Z

### ChatGPT Feedback (raw)

> Focus: orchestration layer (`crmQueryPlannerService.ts`), error mapping, stage transitions, and whether round-1 fixes changed any deeper risks. Overall verdict still positive, not "done" yet. Three meaningful orchestration-level concerns.

**#1 — Top remaining issue, RECOMMENDED PRE-MERGE.** `plannerEvents.emit()` can double-count completions at the agent-event layer. The forwarder treats `planner.result_emitted`, `planner.classified`, AND `planner.error_emitted` as terminal and appends a `skill.completed` agent-execution-log event for each when `runId` is present. A single planner request plausibly emits BOTH `planner.classified` AND `planner.result_emitted` (or `error_emitted`), producing multiple "completed" events for one logical execution. Structured logger is fine — the agent-execution-log surface needs a single terminal projection. **Fix:** forward only ONE final event (either `planner.result_emitted` or `planner.error_emitted`, never both; drop `planner.classified` from the forward). Keep `planner.classified` as structured-log only. Add tests asserting exactly one agent-completion append per run (happy path + error path).

**#2 — Strong follow-up.** Stage 3 parse-failure mapping too broad. Current mapping lumps generic parse failures and transient provider-side failures into `ambiguous_intent`. Malformed model response / schema drift / router-side issues are not the same class as user ambiguity. Operators misread planner quality; users get misleading "rephrase" UX; genuine-ambiguity metrics get polluted. **Fix:** split the fallback bucket internally. Keep the external UX merged if desired, but add a new internal `errorCode` / `errorSubcategory` such as `planner_internal_error` or `planner_parse_failed` for model-output / execution-side failures. `ambiguous_intent` should stay reserved for genuine low-confidence / clarification-needed / parseable-but-unclear outcomes.

**#3 — Strong follow-up.** Orchestration-level cache tests missing. Unit tests cover TTL / subaccount isolation / stage gating. Service-level sequence is not proven. **Fix:** add three service tests covering (a) Stage 3 result reused on second request, (b) principal_mismatch fallback safely to Stage 3 instead of reuse, (c) Stage 1 hits don't populate cache.

**Smaller notes.**
- Hybrid `hybrid_base_at_plan_limit` warn is useful but a signal, not protection. Acceptable v1 compromise — continues the deferred ID-scoped live fetch item.
- Capability skip logging (round 1 #3) was a good patch — observable hole beats silent hole.
- Filter-drop diagnostics (round 1 #7) — good. Translator still lossy for contact search but at least visible now.

Verdict: Mergeable, with 1 recommended pre-merge fix (#1 duplicate-terminal-forwarding) and 2 strong follow-up asks (#2 split bucket, #3 cache tests).

### Adjudication framing

All three major findings are accept-and-ship:

- **#1** is a genuine correctness bug, single-file surgical fix (`plannerEvents.ts:32-35`) — drop `planner.classified` from the terminal forward set; keep it as structured-log only. The spec §17.1 terminal-emission rule already documents that on the success path `planner.classified` IS the stage-resolved terminal, but the code additionally emits `planner.result_emitted` and previously forwarded BOTH. Picking one forwarder per path makes the agent-execution-log surface match the "exactly one terminal per run" invariant.
- **#2** has real semantic value. Currently `ParseFailureError`, `{statusCode:402, code:'RATE_LIMITED'}`, and generic router errors all land as `errorSubcategory:'parse_failure'`. Split: `ParseFailureError → 'parse_failure'`, rate-limit 402 → new `'rate_limited'`, other router/internal → new `'planner_internal_error'`. User-facing `errorCode` stays `'ambiguous_intent'` per ChatGPT's explicit guidance ("keep external UX merged if desired"). Requires an **additive** spec enum extension (spec §17.1 `errorSubcategory`) — analytics-only per spec's own language, optional field, no consumer breakage.
- **#3** is test coverage over existing DI seams (`RunQueryDeps.runLlmStage3`, `planCache._clear/_size`). All three cases are clearly scoped.

### Decisions

| # | Finding | Decision | Severity | Rationale |
|---|---------|----------|----------|-----------|
| 1 | Duplicate terminal `skill.completed` — both `planner.classified` and `planner.result_emitted`/`planner.error_emitted` forward | accept | high | Confirmed by reading `plannerEvents.ts:32-35`. Surgical: drop `planner.classified` from the `isTerminal` set in the forwarder so exactly one `skill.completed` row lands per planner request. `planner.classified` stays a structured-log-only status event. Success-path terminal forward = `planner.result_emitted`; error-path terminal forward = `planner.error_emitted`. The two paths are mutually exclusive — no single run can emit both. |
| 2 | Parse-failure mapping too broad; split internal subcategory for rate-limit / router errors vs genuine parse failures | accept | medium | `isRateLimitedError(err)` discriminator added (already used downstream elsewhere); new `classifyStage3FallbackSubcategory(err)` routes `ParseFailureError → 'parse_failure'`, 402/RATE_LIMITED → `'rate_limited'`, else → `'planner_internal_error'`. External `errorCode` stays `'ambiguous_intent'`. Spec §17 `errorSubcategory` enum extended by 2 values (additive, analytics-only). |
| 3 | Orchestration-level cache tests missing (Stage 3 result reused; principal_mismatch fallback; Stage 1 hits don't populate cache) | accept | medium | All three tests added to `crmQueryPlannerService.test.ts`. Uses existing `RunQueryDeps.runLlmStage3` seam, `planCache._clear/_size` test hooks, and a new `stage3Counting` wrapper that records call count so "cache was consulted before Stage 3 re-ran" can be asserted directly. |
| 3a | Note — hybrid `hybrid_base_at_plan_limit` is a signal not protection | no-action | — | Already deferred as round-1 item (ID-scoped live fetch). Reviewer acknowledges as acceptable v1. |
| 3b | Note — capability skip logging was a good patch | no-action | — | Applied in round 1. |
| 3c | Note — filter-drop diagnostics good | no-action | — | Applied in round 1. |

### Architectural checkpoint

None trigger. All accepted items are single-file surgical fixes — no contract/interface changes, no cross-service impact. The spec §17 enum extension is additive (new optional values on an optional analytics-only field); no consumer breakage.

### Scope check

New work in this round touches 4 files:
- `server/services/crmQueryPlanner/plannerEvents.ts` (~6 line change — dropped `classified` from isTerminal set, added explanatory comment)
- `server/services/crmQueryPlanner/crmQueryPlannerService.ts` (~30 line change — imported `isParseFailureError`, added `isRateLimitedError` + `classifyStage3FallbackSubcategory`, replaced hard-coded `'parse_failure'` subcategory in Stage 3 catch block)
- `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts` (~130 new lines — 3 new tests + helper stubs `stage3ReturnsCanonical`, `stage3Counting`)
- `tasks/builds/crm-query-planner/spec.md` (1 line — added `'rate_limited' | 'planner_internal_error'` to §17 `errorSubcategory` enum)

Well under the +500-line / 20-file threshold.

### Implemented

- **`server/services/crmQueryPlanner/plannerEvents.ts`** — removed `planner.classified` from the `isTerminal` set in the agent-execution-log forwarder. `planner.classified` remains a structured-log-only status marker. Added block comment documenting the one-terminal-per-run invariant (spec §17.1).
- **`server/services/crmQueryPlanner/crmQueryPlannerService.ts`** —
  - Imported `isParseFailureError` from `server/lib/parseFailureError.ts`.
  - Added `isRateLimitedError(err)` helper — mirrors the existing `isBudgetExceededError` discriminator pattern; matches `{statusCode:402, code:'RATE_LIMITED'}`.
  - Added `classifyStage3FallbackSubcategory(err)` — returns `'parse_failure' | 'rate_limited' | 'planner_internal_error'`. Call site in the Stage 3 catch block replaces the hard-coded `errorSubcategory:'parse_failure'`. Also updates `trace.stage3.parseFailure` to only be true for genuine parse failures (was previously true for any Stage 3 catch).
- **`server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts`** — added helpers `stage3ReturnsCanonical` (produces a canonical draft the validator accepts) and `stage3Counting` (call counter). Added three tests:
  1. `cache: Stage 3 validated plan is cached → second identical request hits cache (stageResolved:2)` — asserts first request resolves at stage 3, cache size increments, second identical request resolves at stage 2 AND Stage 3 stub is NOT called again.
  2. `cache: principal_mismatch falls back to Stage 3 (does not reuse cache for a different caller)` — builds a guarded registry with a non-forward-looking `crm.elevated_read` required capability, runs caller 1 (has cap) to populate cache, then runs caller 2 (lacks cap) and asserts the cache lookup falls back to Stage 3 (invoking the stub again) rather than serving the cached plan.
  3. `cache: Stage 1 hits do NOT populate the plan cache` — asserts planCache._size() === 0 after a registry-matched intent resolves at stage 1 (spec §9.3).
- **`tasks/builds/crm-query-planner/spec.md`** — extended §17 `planner.error_emitted.errorSubcategory` enum: added `'rate_limited'` and `'planner_internal_error'` (additive, optional, analytics-only).

### Verification

- `npx tsc --noEmit` — no planner-related errors (pre-existing client errors in `ClarificationInbox.tsx` / `SkillAnalyzerExecuteStep.tsx` unrelated to this PR).
- `npx tsx server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts` — **13 / 13 tests pass** (10 existing + 3 new cache tests).
- Full unit-test suite — **142 pass / 3 fail**. The 3 failures are pre-existing DB-dependent tests that require local DB setup:
  - `server/services/__tests__/rls.context-propagation.test.ts` (pre-existing)
  - `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts` (pre-existing)
  - `server/services/crmQueryPlanner/__tests__/integration.test.ts` (pre-existing — explicitly deferred in `tasks/todo.md:318`)
- All **pure / orchestration** planner tests pass (registry, validator, cache, cost, normaliser, service orchestration).

### Deferred

No deferred items from round 2 — all three accepted findings are applied in-session.

### Final status for round 2

- Round 1 + 2 combined: 6 implemented / 4 rejected / 4 deferred.
- All ChatGPT pre-merge recommendations closed.
- No open architectural decisions.
- Commit + push follows.


