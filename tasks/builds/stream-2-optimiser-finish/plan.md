# Stream 2 — Sub-account optimiser finish (F2 Phases 1-4)

| Field | Value |
|-------|-------|
| Stream | 2 of 2 (concurrent with Stream 1) |
| Goal | Ship F2 Phases 1-4 — the optimiser agent itself, telemetry rollups, dashboard wiring, verification. Phase 0 (the generic agent_recommendations primitive) already shipped on main. |
| Status | READY TO START — spec revised against main 2026-05-04 |
| Branch | claude/stream-2-optimiser-finish |
| Worktree | ../automation-v1.stream-2-optimiser-finish |
| Spec (canonical) | docs/sub-account-optimiser-spec.md |
| Existing build dir | tasks/builds/subaccount-optimiser/ (carries Phase 0 closeout) |
| Migrations claimed | One additional — for the cross-tenant peer-medians materialised view (was reserved as 0267a in spec; claim next-free integer at build time, e.g. 0281) |
| Total estimated effort | ~19h (~3 dev-days) |
| Phase numbering note | Phases 1-4 here = Phases 2-6 in tasks/builds/subaccount-optimiser/progress.md (offset from Phase 0 closeout). Use spec §9 numbering as canonical. |

This file is the orchestration layer. Phase-level detail lives in the spec — do not duplicate it here.

## What's already shipped (do not rebuild)

Per tasks/builds/subaccount-optimiser/progress.md, Phase 0 SHIPPED on main 2026-05-02 via PR #251:

- Migration 0267 — agent_recommendations table + RLS + 4 indexes + subaccounts.optimiser_enabled boolean
- server/db/schema/agentRecommendations.ts (+ dismissed_until column + discriminated-union RecommendationEvidence type)
- server/services/agentRecommendationsServicePure.ts (priority comparator + drop-log helper)
- server/skills/output/recommend.md + executor case in server/services/skillExecutor.ts
- client/src/components/recommendations/AgentRecommendationsList.tsx + useAgentRecommendations hook
- Read / acknowledge / dismiss endpoints in server/routes/agentRecommendations.ts
- 112 tests pass; lint + typecheck unchanged

The primitive is reusable infrastructure — any agent can produce recommendations through output.recommend. Stream 2 is the first full consumer.

## Coordination with Stream 1

Stream 1 = F1 + F3 (sub-account onboarding scope). Fully orthogonal — different files, different services, different scope. Zero coordination required beyond final merge to main.

The one cross-stream signal: F2's escalation.repeat_phrase recommendation produces a better action hint when F1's brand-voice artefact is captured. F2 degrades gracefully without it. No build-time dependency — Stream 2 can ship before, during, or after Stream 1 without rebase pain.

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
|-------|--------|--------------|
| 1 — Telemetry rollups + peer-medians view | ~8h | 8 query modules under server/services/optimiser/queries/ (agentBudget, escalationRate, skillLatency, inactiveWorkflows, escalationPhrases, memoryCitation, routingUncertainty, cacheEfficiency); cross-tenant materialised view migration + nightly refresh job; per-query unit tests (8 files). See rollup invariants below. |
| 2 — Optimiser agent + scan skills | ~6h | companies/automation-os/agents/subaccount-optimiser/AGENTS.md; 8 scan skill markdown specs in server/skills/optimiser/; 8 evaluator modules; LLM render step (Sonnet — fixed model, not configurable in v1, cached by (category, dedupe_key, evidence_hash, render_version)); schedule registration via agentScheduleService; backfill script staggered across 6h window; subaccountService.create hook; integration test. See scheduling and deduplication invariants below. |
| 3 — Home dashboard wiring | ~3h | New section on client/src/pages/DashboardPage.tsx between "Pending your approval" and "Your workspaces". Scope-aware via Layout.tsx activeClientId. Sidebar count badge. Section must not mount (not just hide) when zero open recs. Socket subscription on dashboard.recommendations.changed. See dashboard invariants below. |
| 4 — Verification | ~2h | Lint + typecheck + targeted tests including synthetic fixture coverage (8 categories, empty-telemetry, high-noise) + manual E2E in BOTH org and sub-account context + cost-model sanity measured against a representative fixture (<$0.10 / 5 sub-accounts × 7d) + doc updates (capabilities.md, architecture.md) + progress closeout. |

## Invariants

These are build-time contracts, not suggestions. Any implementation that violates them is incorrect regardless of whether tests pass.

### Phase 1: Rollup correctness

- **DB-time only.** All rollups use `now()` or `transaction_timestamp()`. No app-layer time windows passed as parameters.
- **7-day ceiling on all scan SQL.** Every query must filter on the canonical event-time column using `>= now() - interval '7 days'`. The column is not always `created_at` — source tables may use `started_at`, `completed_at`, `executed_at`, or similar. Each query module must document which timestamp is authoritative and why. No mixing rolling windows with lifetime aggregates unless the query explicitly labels both.
- **Deterministic grouping.** Each query defines explicit grouping dimensions (e.g. org_id, subaccount_id, skill_name). No implicit joins that can duplicate rows.
- **Uniform output shape.** Each query returns `(subaccount_id, metric_key, metric_value, computed_at)` or an equivalent deterministic contract. No ad-hoc column sets.
- **Read-replica safe.** All 8 rollup queries may run against a read replica. The nightly peer-medians refresh job runs against the primary only (it writes). Document this distinction in each module.

### Phase 1: Cross-tenant peer-medians view

- **System role only.** The materialised view runs with a system/service role. It must never be directly queryable by a tenant session. RLS bypass is intentional — document it in a comment in the migration.
- **No raw tenant identifiers exposed.** Only aggregated outputs (medians, percentiles) flow out. No org_id, subaccount_id, or any identifying column in the view's public projection.
- **Minimum 5-tenant threshold.** HAVING clause enforces >= 5 distinct tenants per skill before a median is emitted. Do not bypass at the application layer.
- **Single-writer refresh.** Nightly job must hold an advisory lock or pg-boss singleton. No parallel refresh runs.
- **Median versioning.** Include a `median_version` column (integer, bumped on schema changes) so application code can detect stale or shifted medians without silent drift.

### Phase 2: Scheduling idempotency

- **Unique constraint.** Schedule registration must enforce `UNIQUE (subaccount_id, agent_id)` or equivalent at the DB or pg-boss level.
- **Upsert-only backfill.** Backfill script uses upsert (INSERT ... ON CONFLICT DO UPDATE), never bare INSERT. Must be safe to re-run.
- **Duplicate-trigger tolerance.** Agent execution must be idempotent — a duplicate pg-boss retry must not create duplicate recommendations. Enforce via the deduplication key below.

### Phase 2: Recommendation deduplication (single-flight guard)

- **Deduplication key.** `dedupe_key = hash(category, subaccount_id, evidence_hash)`. This is the upstream guard before the LLM render cache.
- **Enforced at DB level.** Unique index on (subaccount_id, category, dedupe_key) or upsert with ON CONFLICT DO NOTHING/UPDATE. Application-layer dedup alone is insufficient.
- **LLM render cache is downstream.** Render cache (category, dedupe_key, evidence_hash, render_version) deduplicates text generation. The DB constraint deduplicates the row itself. Both must be in place.
- **Hard cap.** Maximum 10 open recommendations per subaccount at any time (inherited from Phase 0 primitive). Scan must respect the cap and not generate beyond it.
- **UPDATE vs INSERT on evidence change.** When a recommendation with the same (subaccount_id, category) lineage exists and the evidence_hash has changed (material change passed), UPDATE the existing row in place — do not create a parallel row. If the design requires a new row (e.g. for audit history), the old row must be explicitly archived (status set to `archived`) before the new row is inserted. Silent parallel rows sharing a dedupe_key lineage are forbidden: they break `previous_value` tracking and cause UI duplication.
- **UPDATE must be concurrency-safe.** Two overlapping scan executions (retry, manual trigger) can both detect a material change and race to UPDATE the same row. Guard with optimistic locking: `UPDATE agent_recommendations SET ... WHERE id = ? AND evidence_hash = <expected_previous_hash>`. If the condition fails (0 rows updated), treat as a lost race — do not retry, do not error. Alternatively use `SELECT ... FOR UPDATE` before the mutation. Either approach is acceptable; the choice must be documented in the implementation. Last-write-wins without a guard is not acceptable.

### Phase 2: Failure observability

Each scan-skill invocation must emit structured logs at these events. All events must include: `orgId`, `subaccountId`, `scanCategory`, `durationMs`, `resultCount`.

| Event | When |
|-------|------|
| `optimiser.scan.started` | Before query execution |
| `optimiser.scan.completed` | After evaluator returns, before recommendation write |
| `optimiser.scan.noop` | Scan completed but evaluator produced no recommendations (resultCount = 0) |
| `optimiser.scan.partial` | Scan ran but skipped peer-comparison categories due to unavailable medians view |
| `optimiser.scan.failed` | On any thrown error in the scan try/catch, or evaluator input shape violation |
| `optimiser.recommendation.created` | On successful DB write |
| `optimiser.recommendation.deduped` | When a dedup key collision is detected and the write is skipped |

### Phase 3: Dashboard consistency

- **Sort order.** Recommendations rendered in order: `priority DESC, created_at DESC, id DESC`. Never rely on insertion order.
- **Socket update behaviour.** On `dashboard.recommendations.changed` event, insert the new item into the list and then re-sort the full list by the canonical comparator (`priority DESC, created_at DESC, id DESC`). A lower-priority new item must not appear at the top. Existing items are not reordered unless their own sort inputs (priority, created_at, id) changed.
- **Zero-state mounting.** When there are zero open recommendations, the section must not mount at all (not just `display: none`). This prevents ghost socket subscriptions.

### Phase 2: Cost enforcement

- **LLM skip on identical recommendation.** Before calling Sonnet, check whether an unacknowledged recommendation with the same `(subaccount_id, category, dedupe_key)` already exists. Skip the render call if so.
- **Hard cap enforces budget.** The 10-recommendation cap per subaccount is the primary cost control. Do not add per-subaccount token budgets in v1 — the cap is sufficient.
- **Measured, not estimated.** Phase 4 verification must measure actual token usage against a representative fixture (5 subaccounts, 7d window) and confirm <$0.02/subaccount/day before marking done.

### Phase 2: Recommendation lifecycle (state machine)

Recommendations follow a strict state model. No shortcuts.

```
              ┌─────────────────┐
open ────────►│  acknowledged   │
  │           └─────────────────┘
  │
  └──────────►│   dismissed     │──► re-open only if:
              │ (dismissed_until│       evidence_hash changes
              │  TTL active)   │       OR dismissed_until expired
              └─────────────────┘
```

Acknowledged and dismissed are sibling terminal-ish actions from the open state, not sequential. A user may acknowledge without dismissing, or dismiss directly from open.

- **dismissed_until enforced at query time.** The WHERE clause on all open-recommendation queries must filter `dismissed_until IS NULL OR dismissed_until < now()`. UI-only enforcement is not sufficient.
- **Same dedupe_key must NOT re-open** unless evidence_hash changes or the dismissal TTL has expired. A scan re-emitting the same evidence for an in-TTL dismissed recommendation must be silently dropped.
- **No zombie recommendations.** A recommendation that has been dismissed and whose evidence hasn't materially changed must never reappear within the dismiss window.

### Phase 1 and 2: Material change threshold

Each scan category must define a `material_change` threshold. A new recommendation must only be emitted if the metric has moved past that threshold since the last emitted recommendation for that (subaccount_id, category).

| Category | Threshold |
|----------|-----------|
| skillLatency | >= 20% change in p95 latency |
| escalationRate | >= 10% change in rate |
| agentBudget | >= 10% change in spend rate |
| inactiveWorkflows | >= N absolute delta (define N in spec §9) |
| escalationPhrases | new phrase not previously seen |
| memoryCitation | >= 15% change in citation rate |
| routingUncertainty | >= 10% change in uncertainty score |
| cacheEfficiency | >= 15% change in hit rate |

- Thresholds are evaluated against `previous_value` stored on the most recent recommendation for that (subaccount_id, category), regardless of its state. Canonical lookup: `ORDER BY created_at DESC, id DESC LIMIT 1`. Must include open, acknowledged, and dismissed states. Must exclude `archived` rows (archived rows represent superseded evidence, not the prior baseline). Using open-only would allow resolved items to churn back once dismissed.
- If no prior recommendation exists for a (subaccount_id, category) pair, any non-zero metric triggers.
- This check is upstream of dedupe — it prevents emitting identical evidence_hash entirely.

### Phase 2: Evaluator determinism

- **Pure functions only.** Each evaluator module must be a pure function: given identical inputs, it always returns identical output. No side effects, no external calls, no random thresholds.
- **No time-based logic inside evaluators.** Time windowing is handled at the query layer (Phase 1). Evaluators receive already-windowed data and must not re-apply time filters.
- **Input shape validated strictly.** Each evaluator must validate that its input conforms to the expected shape before processing. If the query result is malformed, missing required fields, or contains unexpected types, the evaluator must throw immediately — this routes to `optimiser.scan.failed`. Evaluators must not attempt to limp forward on bad input.
- **Priority is deterministic from evaluator output only.** Priority must be a pure function of the evaluator's output fields (e.g. severity, metric delta). It must not be influenced by time, run ordering, or any external context. This prevents UI reshuffling across identical runs.
- **Input hash logged.** Each evaluator invocation logs `hash(evaluator_input)` alongside the scan observability events. This makes non-determinism debuggable without reproducing the full run.

### Phase 2: Backfill and create-hook race condition

A new subaccount can be created while the backfill script is running, causing both paths to attempt schedule registration concurrently.

- **subaccountService.create hook must use the same upsert path as the backfill script.** Both writers go through a shared `registerOptimiserSchedule(subaccountId)` function that performs `INSERT ... ON CONFLICT DO NOTHING`.
- **Neither path may assume it is the only writer.** The upsert is the guard — not execution ordering, not lock-based sequencing between the two paths.
- **First execution must tolerate an unavailable peer-medians view.** A newly registered subaccount may trigger its first scan before the nightly refresh job has populated the materialised view. Scan must detect this and enter partial mode: skip peer-comparison categories, emit recommendations only from non-peer categories, log `optimiser.scan.partial` (not `scan.failed`). This is not an error — it is expected startup behaviour.
- **Test case required.** Phase 4 verification must include a test that simulates concurrent registration (hook + backfill) and confirms a single schedule entry results. A separate test must confirm that a first scan with an empty peer-medians view produces a partial result, not a failure.

### Phase 1: Median drift and recommendation stability

- **Store median_version at evaluation time.** Each recommendation row must store the `median_version` that was active when the recommendation was generated.
- **median_version change does NOT auto-recompute existing recommendations.** A refresh that bumps median_version only affects new scans. Existing open recommendations retain their original context.
- **Stale median detection.** If `recommendation.median_version < current median_version`, the recommendation may optionally surface a staleness flag in the admin view. It must NOT be silently reclassified or promoted/demoted in priority.

### Phase 2: Scan-level circuit breaker

If a systemic failure causes a high proportion of scans to fail in a single run (bad deploy, schema mismatch, dependency outage):

- If more than 50% of the 8 scan categories fail for a given subaccount in one run, emit a single `optimiser.scan.circuit_breaker` event (with `orgId`, `subaccountId`, `failedCategories`, `totalCategories`) and halt further processing for that subaccount in that run.
- Do NOT emit individual `scan.failed` events for the remaining categories after the circuit breaks — one signal is enough.
- The 50% threshold is the default; document it as a named constant so it can be tuned without a code search.

### Phase 2: Scan execution contract

- **Consistent snapshot per run.** Each scan for a subaccount must operate on a consistent DB snapshot — either a single read transaction or a pinned read-replica snapshot. No mixing partial data from queries that run at different logical times.
- **All 8 scans for a subaccount run in the same execution context.** They may run in parallel within that context, but they share the same snapshot timestamp. No scan may use data newer than its siblings in the same run.
- **Timeout per scan.** Each individual query has a 10s max execution timeout. A timeout is treated the same as a scan failure — emits `optimiser.scan.failed`, does not crash the run of other categories.
- **Row bounding — raw queries only.** Raw diagnostic or row-fetch queries must include an explicit LIMIT (e.g. LIMIT 1000). Aggregate rollup queries must NOT use LIMIT — a LIMIT applied before or after aggregation can corrupt metric values. Bound aggregates by time window and indexed predicates instead. Each module must document which case applies.
- **NULL handling explicit.** Every query must define behaviour for missing data — either COALESCE to a sentinel value or filter the row entirely. Implicit NULLs propagating into evaluators is a bug.

## Migration claim

One new migration for the cross-tenant peer-medians materialised view: **0268** (verified at build start — latest is 0267_agent_recommendations). The spec referenced this as 0267a; 0268 is the clean integer as specified in §14.

**Potential second migration — verify at build start.** The invariants in this plan require storing `median_version` and `previous_value` on each recommendation row. Confirm at build start whether the Phase 0 `evidence` JSONB column on `agent_recommendations` can carry these fields cleanly. If the schema cannot support them without an additive column migration, claim a second next-free integer at that point. Do not add columns without a migration.

## Files touched (summary)

- **Server:** 8 new query modules under server/services/optimiser/queries/, 8 evaluator modules under server/services/optimiser/recommendations/, skillExecutor.ts (8 new cases for scan skills), agentScheduleService.ts (register optimiser schedule), subaccountService.ts (create-hook), server/jobs/refreshOptimiserPeerMedians.ts, scripts/backfill-optimiser-schedules.ts, one new migration.
- **Skills + agent:** companies/automation-os/agents/subaccount-optimiser/AGENTS.md, 8 skill specs in server/skills/optimiser/.
- **Client:** DashboardPage.tsx (new section only — reuses existing AgentRecommendationsList component shipped in Phase 0).
- Full list in spec §10.

## Risks

- **Recommendation noise.** Spec §13 lists tuning levers (severity tuning, dedupe, hard cap of 10, material-change thresholds, dismiss cooldown). All baked into Phase 0 primitive — Stream 2 just needs to use them correctly. The single-flight dedup invariant above is the primary guard.
- **Cross-tenant median leakage.** Peer-median view enforces minimum 5-tenant threshold (HAVING clause) and system-role-only access. Do not bypass either constraint at the application layer.
- **Schedule storm.** Backfill staggers daily-cron registration by created_at hash across 6h window. Idempotency invariant above ensures re-runs are safe.
- **Silent scan failures.** Each scan-skill invocation wrapped in try/catch. The full 5-event observability set above must be in place before Phase 4 verification — not just the failure event.
- **Rollup drift.** Without the DB-time and deterministic grouping invariants, recommendations will flip-flop across daily runs. Enforce at query authoring time in Phase 1, not at review time in Phase 4.

## Riley W3 dependency (informational, not blocking)

Spec §15 lists two recommendation categories that become trivial once Riley W3 (context.assembly.complete event) ships: context.gap.persistent and context.token_pressure. Riley W3 has NOT shipped (verified 2026-05-04 — zero matches in server/lib/tracing.ts and server/services/agentExecutionService.ts). These two categories are NOT in v1 scope. Add as Phase 5 follow-up when W3 ships.

## Done definition (Stream 2)

- F2 PR merged to main with pr-reviewer + chatgpt-pr-review clean
- All 8 scan categories produce realistic recommendations against synthetic fixture telemetry
- Empty-telemetry case confirmed: no false positives generated
- High-noise case confirmed: cap + dedupe prevent runaway recommendations
- Lifecycle state machine verified: dismissed recommendation with unchanged evidence does not reappear within TTL window
- Material change thresholds verified: sub-threshold metric movements produce no new recommendations
- pg-boss retry simulation confirmed: duplicate trigger mid-run produces no duplicate recommendations
- Concurrent create-hook + backfill race confirmed: single schedule entry results
- Evaluator purity confirmed: identical inputs produce identical output across runs (checked via input hash logging)
- Home dashboard section renders correctly in BOTH org and sub-account context; zero-state section does not mount
- All 5 observability log events emitted and verified in test runs
- Cost measured (not estimated) at <$0.02 per sub-account per day against a representative fixture
- Backfill script confirmed idempotent: safe re-run produces no duplicates
- tasks/builds/subaccount-optimiser/progress.md closed out (Phases 2-6 in progress.md numbering = §9 Phases 1-4 in spec)
- KNOWLEDGE.md appended for any patterns learned
- docs/capabilities.md § Sub-account observability updated
- architecture.md updated for new query module layout and peer-medians view

## Kickoff prompt

> "load context pack: implement. Start Stream 2 — F2 optimiser finish. Spec is docs/sub-account-optimiser-spec.md. Phase 0 ALREADY SHIPPED on main (PR #251) — do NOT rebuild the agent_recommendations primitive. Build §9 Phases 1-4 only. Read the Invariants section of tasks/builds/stream-2-optimiser-finish/plan.md before writing any Phase 1 or 2 code — these are non-negotiable build contracts. Use architect to produce the plan, then superpowers:subagent-driven-development. Branch claude/stream-2-optimiser-finish. Claim next-free migration integer (likely 0281) for the peer-medians materialised view; verify via ls migrations/ at build start. Independent of Stream 1 — no coordination required beyond final merge."
