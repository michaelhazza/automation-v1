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

### Round 2

ChatGPT offered a "round 2 focused purely on `crmQueryPlannerService.ts` orchestration logic". User may paste that round when ready.
