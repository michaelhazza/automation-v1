# Stream 2 — Sub-account Optimiser Finish — Implementation Plan

> **STATUS: LOCKED — 2026-05-04**
> This plan has completed two full ChatGPT review rounds and is approved for build.
> Do not modify without re-opening a review cycle. Executor: read-only from here.

| Field | Value |
|-------|-------|
| Spec | `docs/sub-account-optimiser-spec.md` (canonical, 813 lines) |
| Orchestration plan | `tasks/builds/stream-2-optimiser-finish/plan.md` (invariants, contracts, done definition) |
| Phase 0 status | SHIPPED on main 2026-05-02 (PR #251). Do not rebuild. |
| Branch | `claude/stream-2-optimiser-finish` |
| Worktree | `../automation-v1.stream-2-optimiser-finish` |
| Migrations claimed | **0268** (peer-medians materialised view). No second migration — `median_version` and `previous_value` ride inside existing `evidence` JSONB (decision under "Schema verification"). |
| Estimated effort | ~19h (~3 dev-days) |
| Total chunks | 8 |
| Plan reviews | Round 1 (2026-05-04): snapshot consistency, errorType enum, metricKey contract, schedule self-healing, optional-field normalisation, early cost instrumentation, partial_run flag. Round 2 (2026-05-04): MAX(median_version), evidence size constraint, parallel-is-sequential clarification, successfulCategories, render cache index checklist item, backfill lock UX. |

---

## Table of contents

- Model-collapse check
- Architecture notes
- System invariants block (non-negotiable)
- Pre-build checklist
- Chunk plan
- Contracts
- Chunk 1 — Migration 0268: peer-medians materialised view + system_agents seed
- Chunk 2 — Peer-medians refresh job + scheduling
- Chunk 3 — Phase 1A: 7 non-peer query modules + evaluators
- Chunk 4 — Phase 1B: skillLatency query module + evaluator
- Chunk 5 — Phase 2A: AGENTS.md, scan skill specs, agent runtime orchestration
- Chunk 6 — Phase 2B: shared registerOptimiserSchedule, backfill script, subaccount-create hook
- Chunk 7 — Phase 3: Dashboard wiring + zero-state non-mount
- Chunk 8 — Phase 4: Verification, cost measurement, doc updates, progress closeout
- Risks and mitigations
- Self-consistency pass
- Deferred items
- Executor notes

---

## Model-collapse check

The optimiser is not an ingest → extract → transform → render pipeline that a single multimodal call could replace. It is a sweep of **eight independent SQL aggregates over multi-tenant telemetry tables** (cost_aggregates, agent_execution_events, llm_requests, memory_citation_scores, fast_path_decisions, review_items, flow_runs, subaccount_agents) producing structured numeric evidence. The only LLM step is a **single Sonnet render call per material-change event** that converts already-computed numeric evidence into 2–3 sentences of operator-facing copy. That render step is where the LLM earns its keep — replacing the SQL sweep with an LLM would be slower, costlier, non-deterministic, non-auditable, and fundamentally unable to read the underlying telemetry tables (no SQL execution surface in a frontier model). The collapsed-call alternative is rejected. Recorded.

---

## Architecture notes

### Decisions and rejected alternatives

1. **Carry `median_version` and `previous_value` inside `evidence` JSONB. Reject second migration.** The spec's `evidence` column is a `Record<string, unknown>` and the canonicaliser already handles integer / array / nested-object shapes deterministically (`shared/types/agentRecommendations.ts`). Adding two more well-typed fields per evidence shape is type-only work — no schema change, no second migration. Rejected: a dedicated column for `median_version` (would require a migration, would orphan the field on rows from agents that don't use peer baselines).
2. **Use `withAdminConnectionGuarded` (existing primitive) for the peer-medians refresh.** Pattern is identical to `server/services/systemMonitor/baselines/refreshJob.ts`: cross-tenant aggregate read, system role, allowlisted RLS bypass, structured-log start/end. Rejected: a bespoke connection helper (would duplicate logic).
3. **Keep `agent_recommendations.evidence_hash` as the optimistic-locking predicate via Phase 0's `SELECT ... FOR UPDATE`.** Plan invariant says "UPDATE ... WHERE evidence_hash = `<expected_previous_hash>`" OR `SELECT ... FOR UPDATE` is acceptable. Phase 0 implementation uses the latter, inside the same advisory-lock transaction. No change required to Phase 0; document the choice in the implementation note for Chunk 5.
4. **Single shared `registerOptimiserSchedule()` function used by both backfill and sub-account create-hook.** The existing `agentScheduleService.registerSchedule` writes directly to pg-boss; it does not own the `subaccount_agents` row creation. Wrap both responsibilities in a new `registerOptimiserSchedule(subaccountId)` exported from `agentScheduleService.ts` that performs (a) idempotent `INSERT INTO subaccount_agents (...) ON CONFLICT (subaccount_id, agent_id) DO NOTHING RETURNING id` + (b) `agentScheduleService.updateSchedule(linkId, { scheduleCron, scheduleEnabled: true, scheduleTimezone })`. Rejected: duplicating logic in backfill script and route handler (failure mode: two writers diverge).
5. **Per-`(subaccount_id, agent_id)` pg-boss singleton key for the optimiser schedule.** pg-boss native scheduling already keys on a unique `scheduleName` (`${AGENT_RUN_QUEUE}:${subaccountAgentId}`). Reuse it; do NOT introduce a new pg-boss queue. The "one-at-a-time" invariant comes from the schedule key being unique per `subaccount_agent_id`, plus pg-boss `singletonKey` / `singletonHours` parameters on the dispatched job send.
6. **Scan-execution context is a single read transaction per subaccount run.** All 8 scan queries execute inside one `withOrgTx` transaction so they share a snapshot timestamp. The peer-medians cross-tenant read for `skillLatency` is a separate `withAdminConnectionGuarded` call inside the same agent-runtime function — different snapshot, but only one query needs cross-tenant data.
7. **Circuit breaker is process-state, not DB-state.** A counter local to one subaccount run; >50% category failures triggers a single `optimiser.scan.circuit_breaker` log + early return. No DB row. Rejected: persisting circuit-breaker state (premature — scan run is short-lived; restart on next cron tick is the correct recovery).
8. **No dedicated `archived` recommendation status.** The plan's "Most recent recommendation canonical lookup" excludes archived rows; absent an archived state, the lookup reduces to "all states". The plan permits this ("If the design requires a new row..."); the design uses UPDATE-in-place (existing path), so an archived state never appears. Rejected: adding an archived enum value (no current use, future scope).

### Patterns selected (none added for their own sake)

- **Single responsibility per query module** — each of the 8 modules owns exactly one telemetry query, one timestamp-column choice, one grouping dimension, one output shape.
- **Pure evaluator functions** — no I/O, no clock reads. Plan invariant "Evaluator determinism" enforced at module boundary (input validated at module entry; pure transform; deterministic priority).
- **Adapter pattern for the agent runtime** — a single `runOptimiserScan(subaccountId)` orchestration function calls 8 scans, applies dedupe-key + material-delta + render, dispatches `output.recommend` calls. The orchestration is the adapter between the existing agent runtime and the new query/evaluator modules.

---

## System invariants block (non-negotiable, applied to every chunk)

These are restated from `tasks/builds/stream-2-optimiser-finish/plan.md` for executor convenience. Any chunk that violates one is incorrect regardless of test results.

1. **DB-time only on rollups.** No app-layer time windows. Use `now()` / `transaction_timestamp()` exclusively.
2. **7-day window on every scan SQL.** Filter on the canonical event-time column (column varies per table — see Chunk 3 / Chunk 4 file table). No mixing rolling and lifetime aggregates without explicit labelling.
3. **Deterministic grouping.** Each query declares its grouping keys explicitly. No implicit cross-joins that can duplicate rows.
4. **Uniform output shape from each query module.** `(subaccount_id, metric_key, metric_value, computed_at, evidence_payload)` — see Contracts.
5. **No LIMIT on aggregate rollups.** Bound by time window + indexed predicates. Raw row-fetch queries (e.g. `sample_escalation_ids`) carry an explicit LIMIT.
6. **NULL handling explicit in every query.** COALESCE to a sentinel or filter the row out — never propagate implicit NULLs into evaluators.
7. **10s timeout per individual scan SQL.** Treat timeout as scan failure (`optimiser.scan.failed`). Run continues for other categories.
8. **Cross-tenant peer-medians view** runs under system role (`SET LOCAL ROLE admin_role`), never queryable from a tenant session. RLS-bypass intentional, documented in the migration header.
9. **Peer-medians view exposes no raw tenant identifiers** — only aggregated p50/p95/p99/n_tenants per `skill_slug`.
10. **HAVING `count(distinct organisation_id) >= 5`** enforced inside the view definition. Application code never bypasses.
11. **Single-writer refresh** — pg-boss singleton key + advisory lock inside the refresh job.
12. **`median_version` integer** on the view (and on every recommendation row that consulted the view); bumped on any view schema change.
13. **Scheduling unique constraint** — pg-boss schedule name `${AGENT_RUN_QUEUE}:${subaccountAgentId}` is unique per `(subaccount_id, agent_id)` by construction.
14. **Backfill is upsert-only** — `INSERT ... ON CONFLICT DO NOTHING` for the `subaccount_agents` row + `agentScheduleService.updateSchedule` (which is itself idempotent). Re-running is safe.
15. **Recommendation dedupe** — `(scope_type, scope_id, category, dedupe_key) WHERE dismissed_at IS NULL` partial unique index (Phase 0; do not duplicate). Application-layer dedupe alone is insufficient.
16. **UPDATE in place on material change** — never insert a parallel row that shares a `(scope, category, dedupe_key)` lineage. Phase 0 already does this; preserve.
17. **Optimistic locking on UPDATE** — Phase 0 uses `SELECT ... FOR UPDATE` inside the per-`(scope, producing_agent_id)` advisory-lock transaction. Document that this is the chosen guard; do not introduce a parallel `WHERE evidence_hash = <expected>` predicate.
18. **Most-recent-recommendation lookup** for material-delta gating — `ORDER BY created_at DESC, id DESC LIMIT 1`, all states (open / acknowledged / dismissed). No archived state in v1.
19. **Material-change predicates** as defined in `shared/types/agentRecommendations.ts`. Do not redefine inline in evaluators. Add new categories to the registry, do not patch in evaluator code.
20. **Lifecycle state machine** — `dismissed_until IS NULL OR dismissed_until < now()` enforced at query time on every open-rec read path. UI-only enforcement is insufficient.
21. **Re-open only on evidence_hash change OR TTL expiry.** Same `(scope, category, dedupe_key)` with unchanged evidence within an active dismiss TTL is silently dropped.
22. **`optimiser.scan.partial` (not `failed`) when peer-medians view is empty.** First scan after deploy / for newly-onboarded subaccount must complete with non-peer categories.
23. **Pre-sort candidates** by `severity desc, category asc, dedupe_key asc` before invoking `output.recommend` so cap eviction is deterministic.
24. **Sequential `output.recommend` calls** per run — no concurrent calls per `(scope, producing_agent_id)`.
25. **Circuit breaker** — >50% scan-category failures emits a single `optimiser.scan.circuit_breaker` and halts that subaccount's run. Threshold is a named constant (`SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 0.5`).
26. **Observability events** — `optimiser.scan.started`, `.completed`, `.noop`, `.partial`, `.failed`, `.circuit_breaker`, `optimiser.recommendation.created`, `optimiser.recommendation.deduped`. All carry `orgId, subaccountId, scanCategory, durationMs, resultCount`. Plus `evaluator_input_hash` on each scan.completed for determinism debugging. When a run completes in partial mode, each produced `agent_recommendations` row carries `{ partial_run: true }` in its evidence payload so operators and future debugging can identify recommendations produced without a full peer baseline.
27. **Render cache key** — `(category, dedupe_key, evidence_hash, render_version)`. Phase 0 already provides `RENDER_VERSION` from `server/services/optimiser/renderVersion.ts`. No changes in this build.
28. **Dashboard sort** — `priority DESC, created_at DESC, id DESC` everywhere (initial fetch + post-socket re-sort).
29. **Zero-state dashboard section MUST NOT mount** (not just `display:none`) — prevents ghost socket subscriptions.
30. **Cost guardrail** — Phase 4 measures actual token usage on a 5-subaccount × 7-day fixture. < $0.02/subaccount/day or the build does not ship.
31. **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
32. **`median_version` snapshot determinism.** Read `median_version` once at scan-start via `SELECT max(median_version) FROM optimiser_skill_peer_medians` (not `LIMIT 1` — `MAX` is unambiguous if the view ever contains mixed versions during a partial refresh). Pass it into `EvaluatorContext`. The `skillLatency` JOIN query MUST add `WHERE peer_medians.median_version = $expectedVersion`. If no row matches (version bumped mid-scan), treat as `[]` and emit `optimiser.scan.partial` — same path as empty view.
33. **Evaluator optional-field normalisation.** Before passing evidence to the canonicaliser, every evaluator MUST set all optional fields explicitly (`null` or a value — never `undefined`). The canonicaliser handles numeric precision (4dp, per `shared/types/agentRecommendations.ts`). Unset optional fields produce canonically different hashes from explicitly-null fields, causing false "material change" positives and render cache misses for semantically identical evidence.
34. **Evidence payload size.** Each evidence object SHOULD remain under 2KB serialised. Not enforced at runtime in v1, but treated as a design constraint: new evidence fields must justify their weight. Bloat degrades hashing performance, storage, and debugging clarity.
35. **`withOrgTx` parallel scans are logically parallel, physically sequential.** The DB driver queues all 8 queries through one connection; they do not execute in true parallel. "IN PARALLEL" in the orchestration pseudocode means the JS Promise.all pattern over a shared transaction — it preserves snapshot consistency intentionally. Do not replace with N separate connections to gain parallelism; that breaks the snapshot invariant.

---

## Pre-build checklist (run before Chunk 1 starts)

- [ ] **Migration claim verified.** `ls migrations/` confirms 0267 is latest. Claim **0268** for the peer-medians view migration. If a second migration is needed (it isn't, per "Schema verification"), claim 0269.
- [ ] **Schema verification.** Confirm `agent_recommendations.evidence` (JSONB) accepts `median_version: number` and `previous_value: number | object` keys without DDL. Inspection only — read `server/db/schema/agentRecommendations.ts` and confirm the column is typed `Record<string, unknown>`. Decision recorded above (no second migration).
- [ ] **Composite-index audit.** Read `pg_indexes` (or grep `migrations/*.sql` for `CREATE INDEX`) and confirm the following indexes exist on source tables. If any is missing, the chunk owning the dependent query module adds the index migration.
  - `agent_runs(organisation_id, started_at)` or `(subaccount_id, started_at)`
  - `agent_execution_events(run_id, timestamp)`
  - `cost_aggregates(scope_id, created_at)` (for budget rollups)
  - `memory_citation_scores(run_id, created_at)` joined to `agent_runs.subaccount_id`
  - `fast_path_decisions(agent_id, created_at)`
  - `llm_requests(agent_id, created_at)`
  - `flow_runs(organisation_id, created_at)` joined to `flow_step_outputs(flow_run_id)`
  - `review_items(subaccount_id, created_at)` or equivalent
  - `subaccount_agents(subaccount_id, agent_id)` unique (existing)
- [ ] **EXPLAIN ANALYZE pre-write reminder.** Each query module's author runs the SQL against a representative subaccount in the dev DB and captures the plan in the module's header comment as a pinned reference (not as a test artefact). If any query falls back to a Seq Scan on a hot path, raise it before completing the chunk — do not paper over with `LIMIT`.
- [ ] **`system_agents` row for the optimiser exists.** Either Chunk 1 seeds it (preferred — same migration as the peer-medians view) or a Phase 2 migration seeds it later. Recommended: fold into Chunk 1's migration following the `0068_portfolio_health_agent_seed.sql` pattern.
- [ ] **`subaccounts.optimiser_enabled` column exists** (Phase 0 ships this in 0267). Spot-check the column is present and defaults to `true`.
- [ ] **Render cache index exists.** The render cache lookup (`SELECT body FROM agent_recommendations WHERE evidence_hash = $1 AND category = $2`) must be index-backed. Verify a composite index on `agent_recommendations(category, evidence_hash)` exists (grep `migrations/*.sql` for it). If Phase 0 did not create it, add it in Chunk 5's migration. Without it, the lookup degrades to a seq-scan as the table grows.

---

## Chunk plan

```
Chunk 1 — Migration 0268: peer-medians materialised view + system_agents seed
Chunk 2 — Refresh job + RLS opt-out manifest
Chunk 3 — Phase 1A: 7 non-peer query modules + evaluators
Chunk 4 — Phase 1B: skillLatency query module + evaluator
Chunk 5 — Phase 2A: AGENTS.md, scan skill specs, agent runtime orchestration
Chunk 6 — Phase 2B: shared registerOptimiserSchedule, backfill script, subaccount-create hook
Chunk 7 — Phase 3: Dashboard wiring + zero-state non-mount
Chunk 8 — Phase 4: Verification, cost measurement, doc updates, progress closeout
```

Forward-only dependencies:

```
1 → 2 → 4
1 → 3
3, 4 → 5 → 6 → 7 → 8
```

---

## Contracts

### Query module output shape (uniform across all 8 modules)

```ts
// server/services/optimiser/queries/types.ts (NEW)
export interface QueryRow<TEvidence> {
  subaccountId: string;
  metricKey: string;       // canonical grouping key — the evaluator MUST use row.metricKey directly as dedupeKey; no recomposition. Consistency across query/evaluator layers is required for stable dedupe.
  metricValue: number;     // primary numeric metric used for material-delta and priority
  computedAt: Date;        // DB-time at which the row was computed (now() at query exec)
  evidence: TEvidence;     // per-category evidence shape from shared/types/agentRecommendations.ts
}

export interface QueryModule<TEvidence> {
  category: 'optimiser.<area>.<finding>'; // full three-segment form
  authoritativeTimestampColumn: string;   // e.g. 'agent_runs.started_at'; documented per module
  readReplicaSafe: true;                  // every module is RR-safe; the refresh job is not
  run(tx: PgTx, subaccountId: string): Promise<QueryRow<TEvidence>[]>;
}
```

### Evaluator module signature

```ts
// server/services/optimiser/recommendations/types.ts (NEW)
export interface EvaluatorContext {
  subaccountId: string;
  organisationId: string;
  medianVersion: number; // current median_version when the run started (0 when view empty / partial mode)
  // Most-recent-recommendation lookup, indexed by `${category}|${dedupe_key}`.
  // Used for material-delta gating per invariant 18.
  priorRecsByDedupe: Map<string, { evidenceHash: string; evidence: Record<string, unknown> }>;
}

export interface EvaluatorOutput {
  category: string;       // full three-segment slug
  severity: 'info' | 'warn' | 'critical';
  dedupeKey: string;
  evidence: Record<string, unknown>; // includes median_version when peer-comparison was used
  // priority: derived deterministically — see invariant 4 of plan.md "Evaluator determinism"
  priorityTuple: [severityRank: number, categoryAsc: string, dedupeKeyAsc: string];
  // action_hint built from spec §6.5 deep-link schema
  actionHint: string;
}

export type Evaluator<TEvidence> = (
  rows: QueryRow<TEvidence>[],
  ctx: EvaluatorContext,
) => EvaluatorOutput[];
```

Evaluators are **pure**. They MUST validate input shape (Zod or hand-written guard) and throw on malformed input — the throw maps to `optimiser.scan.failed`.

### Scan-skill execution-event payload

```ts
// Used by the agent runtime's structured logger. Plan invariant 26.
interface ScanEventPayload {
  orgId: string;
  subaccountId: string;
  scanCategory: string;          // full three-segment slug, or 'all' for circuit_breaker
  durationMs: number;
  resultCount: number;           // -1 for failed; for circuit_breaker carries failedCategories.length
  evaluatorInputHash?: string;   // sha256 hex of canonicalised query rows; on .completed only
  errorType?: 'timeout' | 'query_error' | 'data_invalid' | 'unknown'; // on .failed only; 'timeout' = Postgres 57014; 'query_error' = SQL/connection failure; 'data_invalid' = shape mismatch; 'unknown' = catch-all
  errorMessageRedacted?: string; // on .failed only; truncate to 200 chars, strip UUIDs/emails
  failedCategories?: string[];      // on .circuit_breaker only
  successfulCategories?: string[];  // on .circuit_breaker only; avoids having to reconstruct from logs
  totalCategories?: number;         // on .circuit_breaker only (= 8)
  medianVersion?: number;        // on .partial only; emitted as 0 to signal empty view
}
```

### Peer-medians materialised view projection

```sql
-- migrations/0268_optimiser_peer_medians.sql
CREATE MATERIALIZED VIEW optimiser_skill_peer_medians AS
SELECT
  payload->>'skillSlug' AS skill_slug,
  percentile_cont(0.50) WITHIN GROUP (
    ORDER BY (payload->>'durationMs')::numeric
  ) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY (payload->>'durationMs')::numeric
  ) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (
    ORDER BY (payload->>'durationMs')::numeric
  ) AS p99_ms,
  count(distinct organisation_id) AS n_tenants,
  1::int AS median_version,
  now() AS refreshed_at
FROM agent_execution_events
WHERE event_type = 'skill.completed'
  AND timestamp >= now() - interval '7 days'
  AND payload ? 'skillSlug'
  AND payload ? 'durationMs'
GROUP BY skill_slug
HAVING count(distinct organisation_id) >= 5;

CREATE UNIQUE INDEX optimiser_skill_peer_medians_pk ON optimiser_skill_peer_medians (skill_slug);
```

The view exposes **no raw tenant identifiers** in its public projection — `organisation_id` is consumed by `count(distinct ...)` and never selected. `median_version` is a SQL constant inside the view definition; bump it (and the `0268`-equivalent successor migration) when the view's columns or projection logic change.

### `registerOptimiserSchedule(subaccountId)` contract

```ts
// server/services/agentScheduleService.ts (extended)
async registerOptimiserSchedule(subaccountId: string): Promise<{
  subaccountAgentId: string;
  cron: string;
  scheduleName: string; // pg-boss key
  wasNew: boolean;      // false if subaccount_agents row already existed
}> {
  // 1. Resolve the optimiser system_agents row → agents row for this subaccount's org.
  // 2. Compute stagger offset: hash(subaccountId) % 360 minutes within the 06:00 local hour.
  //    Cron: `<offset_minutes> 6 * * *` (sub-account local timezone).
  // 3. INSERT INTO subaccount_agents (...) ON CONFLICT (subaccount_id, agent_id) DO NOTHING
  //    Returning the row id whether new or existing.
  // 4. Read existing schedule from pg-boss (scheduleName = `${AGENT_RUN_QUEUE}:${subaccountAgentId}`).
  //    Compare its cron expression to the freshly-computed expected cron.
  //    If mismatch (i.e. cron formula changed since registration) → call updateSchedule to correct.
  //    This makes the function self-healing against cron formula changes and ensures
  //    re-running it after a stagger-window adjustment does not leave stale schedules.
  //    If matching or new → call updateSchedule regardless (idempotent on pg-boss side).
}
```

Both backfill (`scripts/backfill-optimiser-schedules.ts`) and the subaccount-create hook (`server/routes/subaccounts.ts` POST handler) call this function. Neither path duplicates logic.

### Dashboard read endpoint (Phase 0; reused, not changed)

```
GET /api/recommendations?scopeType=subaccount&scopeId=<uuid>&limit=20
GET /api/recommendations?scopeType=org&scopeId=<orgId>&includeDescendantSubaccounts=true&limit=20
```

Phase 0 already implements; this stream uses it as-is.

### Error codes

| Code | HTTP | Where |
|------|------|-------|
| `OPTIMISER_BACKFILL_LOCK_HELD` | 409 | backfill script when another instance holds the advisory lock |
| `OPTIMISER_SCHEDULE_AGENT_MISSING` | 500 | `registerOptimiserSchedule` when the optimiser `system_agents`/`agents` row is missing — surfaces a hard failure rather than silently skipping |

All other failure modes route through the existing service-throw pattern (`{ statusCode, message, errorCode? }`).

---

## Chunk 1 — Migration 0268: peer-medians materialised view + system_agents seed

**Goal.** Create the cross-tenant materialised view + register the optimiser as a `system_agents` row + add the view to the canonical-dictionary RLS-bypass allowlist. After this chunk, the view exists (initially empty) and the optimiser has a system-agent identity to bind subaccount-agent rows to.

**Files to create / modify.**
- `migrations/0268_optimiser_peer_medians.sql` (NEW) — view + seed `system_agents` row.
- `migrations/0268_optimiser_peer_medians.down.sql` (NEW).
- `server/db/schema/optimiserSkillPeerMedians.ts` (NEW) — Drizzle export of the view as a read-only schema object.
- `server/db/canonicalDictionary.ts` (MODIFY) — register `optimiser_skill_peer_medians` as a non-tenant-scoped view.
- `server/db/rlsProtectedTables.ts` (MODIFY) — `optimiser_skill_peer_medians` is intentionally **not** added; an opt-out comment with rationale is added to the file in the section reserved for opt-outs (mirror the comment style used for `system_monitor_baselines`).
- `references/rls-not-applicable-allowlist.txt` (MODIFY) — add `optimiser_skill_peer_medians` with rationale "cross-tenant aggregate p50/p95/p99 per skill; no per-tenant rows; HAVING n_tenants >= 5; system role only".

**Migration content.**
- Header comment: `-- system-scoped: cross-tenant aggregate over agent_execution_events; no per-tenant rows in projection`.
- The `CREATE MATERIALIZED VIEW` per the Contracts block above.
- A `REVOKE ALL ON optimiser_skill_peer_medians FROM PUBLIC;` and `GRANT SELECT ON optimiser_skill_peer_medians TO admin_role;` to make tenant-role queries 0-row.
- A seed `INSERT INTO system_agents (... slug='subaccount-optimiser', execution_scope='subaccount' ...) ON CONFLICT (slug) DO NOTHING` mirroring `0068_portfolio_health_agent_seed.sql`. System prompt and metadata per spec §4.

**Implementation notes (invariants).**
- Invariants 8, 9, 10, 12 directly enforced. The HAVING clause is what gates the 5-tenant minimum; do not re-implement application-side.
- The `median_version` column is a SQL constant in the view body — when the view definition changes in a future migration, bump the constant (e.g. `2::int AS median_version`) so consumer code can detect the schema shift.
- The view is created populated, then refreshed nightly. Initial population during migration runs a `REFRESH MATERIALIZED VIEW optimiser_skill_peer_medians` at the end of the migration (will return zero rows on a fresh dev DB; that's expected and consistent with invariant 22's partial-mode handling).
- The `.down.sql` drops the view and the `system_agents` seed row.

**Acceptance criteria.**
- `npm run typecheck` clean after schema export added.
- `psql` against the dev DB confirms `\dm optimiser_skill_peer_medians` shows the view, with `n_tenants` column present and HAVING constraint visible in the definition.
- `SET ROLE app_user; SELECT * FROM optimiser_skill_peer_medians LIMIT 1;` returns 0 rows AND/OR throws permission denied (either is acceptable — both prove tenant role can't read it).
- `SELECT slug FROM system_agents WHERE slug='subaccount-optimiser'` returns 1 row.
- The migration is reversible: applying `.down.sql` removes both the view and the seed row.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- (No new test file — schema-only; covered by Chunk 2's refresh job test.)

**Dependencies.** None (entry chunk).

---

## Chunk 2 — Peer-medians refresh job + scheduling

**Goal.** Author the nightly refresh job that repopulates the view, register it via pg-boss, and add a single-writer guard.

**Files to create / modify.**
- `server/jobs/refreshOptimiserPeerMedians.ts` (NEW) — pg-boss handler.
- `server/services/agentScheduleService.ts` (MODIFY) — register the daily `refresh_optimiser_peer_medians` schedule from `init()`; cron `0 0 * * *` UTC.
- `server/services/optimiser/refreshPeerMedians.ts` (NEW) — `runPeerMediansRefresh()` function called by both the job handler and any future manual trigger.
- `server/services/optimiser/__tests__/refreshPeerMediansPure.test.ts` (NEW) — pure unit test for the timing-stagger logic (no DB).
- `server/services/optimiser/__tests__/refreshPeerMedians.test.ts` (NEW) — integration test against a seeded fixture DB; runs only locally via `npx tsx`.

**Implementation notes (invariants).**
- Single-writer guard: at the top of `runPeerMediansRefresh` call `pg_try_advisory_xact_lock(hashtext('optimiser.peer_medians.refresh'))` inside a `withAdminConnectionGuarded({ source: 'optimiser_peer_medians_refresh', allowRlsBypass: true, reason: 'cross-tenant aggregate refresh' })` block. If the lock is not acquired, log `optimiser.peer_medians.refresh.skipped_locked` and return.
- Inside the guarded transaction: `SET LOCAL ROLE admin_role` then `REFRESH MATERIALIZED VIEW optimiser_skill_peer_medians` (NOT `CONCURRENTLY` — the unique index allows it but concurrent refresh requires twice the disk; revisit if the view grows beyond 10k rows).
- Emit `optimiser.peer_medians.refresh.started`, `.completed`, `.failed` structured logs (mirror the `system_monitor_baselines` event family).
- Schedule registration uses `pgboss.schedule('refresh_optimiser_peer_medians', '0 0 * * *', null, { tz: 'UTC' })` registered from `agentScheduleService.init()` so it survives pod restarts.

**Acceptance criteria.**
- The job successfully refreshes the view in a local dev DB seeded with `agent_execution_events` rows from ≥5 organisations emitting `skill.completed` events.
- Two concurrent invocations produce exactly one refresh — the second logs `skipped_locked` and returns.
- A `skill_slug` with <5 organisations produces 0 rows in the view (HAVING enforced).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/optimiser/__tests__/refreshPeerMediansPure.test.ts`
- `npx tsx server/services/optimiser/__tests__/refreshPeerMedians.test.ts` (integration; requires a local DB)

**Dependencies.** Chunk 1.

---

## Chunk 3 — Phase 1A: 7 non-peer query modules + evaluators

**Goal.** Author the 7 query modules + 7 evaluator modules whose categories do NOT depend on the peer-medians view. After this chunk, 7 of 8 categories can produce recommendations against fixture telemetry.

**Files to create.**

| Query module | Source table(s) | Authoritative timestamp | Evaluator module |
|---|---|---|---|
| `server/services/optimiser/queries/agentBudget.ts` | `cost_aggregates` | `cost_aggregates.created_at` | `server/services/optimiser/recommendations/agentBudget.ts` |
| `server/services/optimiser/queries/escalationRate.ts` | `flow_runs` ⨝ `flow_step_outputs` ⨝ `review_items` ⨝ `actions` | `flow_runs.created_at` | `server/services/optimiser/recommendations/playbookEscalation.ts` |
| `server/services/optimiser/queries/inactiveWorkflows.ts` | `subaccount_agents` ⨝ `agent_runs` | `agent_runs.started_at` | `server/services/optimiser/recommendations/inactiveWorkflow.ts` |
| `server/services/optimiser/queries/escalationPhrases.ts` | `review_items.reviewPayloadJson` | `review_items.created_at` | `server/services/optimiser/recommendations/repeatPhrase.ts` |
| `server/services/optimiser/queries/memoryCitation.ts` | `memory_citation_scores` ⨝ `agent_runs` | `agent_runs.started_at` (parent run) | `server/services/optimiser/recommendations/memoryCitation.ts` |
| `server/services/optimiser/queries/routingUncertainty.ts` | `fast_path_decisions` | `fast_path_decisions.created_at` | `server/services/optimiser/recommendations/routingUncertainty.ts` |
| `server/services/optimiser/queries/cacheEfficiency.ts` | `llm_requests` | `llm_requests.created_at` | `server/services/optimiser/recommendations/cacheEfficiency.ts` |

Plus shared:
- `server/services/optimiser/queries/types.ts` (NEW) — `QueryRow`, `QueryModule` interfaces from Contracts.
- `server/services/optimiser/recommendations/types.ts` (NEW) — `EvaluatorContext`, `EvaluatorOutput`, `Evaluator` interfaces from Contracts.
- `server/services/optimiser/recommendations/actionHints.ts` (NEW) — pure URL builder for the spec §6.5 deep-link schema (one helper per category).

Plus per-module unit tests:
- `server/services/optimiser/queries/__tests__/<module>Pure.test.ts` × 7 — pure SQL parser/text-shape tests against fixture rows. Each asserts the WHERE clause filters by the documented authoritative timestamp column with `>= now() - interval '7 days'` (parser check, not just behaviour, per orchestration plan).
- `server/services/optimiser/recommendations/__tests__/<module>Pure.test.ts` × 7 — pure tests for evaluator: shape validation, severity mapping, priority tuple determinism (input permutation per DEVELOPMENT_GUIDELINES §8.21), `dedupe_key` derivation per the spec §2 table.

**Implementation notes (invariants).**
- Every query module's SQL embeds `WHERE <timestamp_col> >= now() - interval '7 days'` as the first WHERE clause (invariant 2). Document the column choice in the module's header comment.
- Aggregate queries (agentBudget, escalationRate, memoryCitation, routingUncertainty, cacheEfficiency) carry NO LIMIT (invariant 5). `inactiveWorkflows` is a row-fetch pattern (one row per subaccount agent, max ~20 per subaccount); it carries `LIMIT 100` defensively. `escalationPhrases` stages its raw row pull as `LIMIT 1000` for `review_items.reviewPayloadJson`, then aggregates in memory (n-gram counter). Document the LIMIT case per module.
- Each module sets `statement_timeout = 10000` at query entry via `tx.execute(sql\`SET LOCAL statement_timeout = 10000\`)` (invariant 7). On timeout, Postgres throws `57014`; the module catches and re-throws with `errorType: 'timeout'` so the agent runtime classifies it.
- NULL handling per module documented in header: each `numeric` aggregate is COALESCEd to 0; `top_cost_driver` is COALESCEd to `'unknown'`; etc.
- Evaluator modules are pure. They take `QueryRow[]` + `EvaluatorContext` and return `EvaluatorOutput[]`. They consult `priorRecsByDedupe` to apply `materialDelta` (looked up by `category` from the registry in `shared/types/agentRecommendations.ts`). If the prior evidence is absent (first-ever observation), any non-zero metric triggers (per orchestration plan).
- `escalationPhrases` evaluator emits one recommendation per qualifying phrase (count >= 3 in window). Tokeniser ships in the query module — lowercase + strip-punctuation + suffix-strip (`-ing`, `-ed`, `-s`) per spec §9 Phase 1.
- `inactiveWorkflows` evaluator computes "1.5× expected cadence" via `scheduleCalendarServicePure.computeNextHeartbeatAt` — pure dependency, safe.
- Evidence shapes match `shared/types/agentRecommendations.ts` exactly (Phase 0 contract).
- Evaluator modules add `median_version: 0` to their evidence payload to denote "no peer baseline used" — uniform field set across all categories.

**Acceptance criteria.**
- Each query module test asserts (a) the WHERE-clause filter on the authoritative timestamp column, (b) deterministic GROUP BY, (c) NULL handling explicit for every nullable source column.
- Each evaluator test asserts (a) input-shape validation throws on malformed input, (b) priority tuple is determined entirely by output fields (input permutation test), (c) `dedupe_key` matches the spec §2 table per category.
- 14 test files pass via individual `npx vitest run` invocations.
- `npm run lint` and `npm run typecheck` clean.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/optimiser/queries/__tests__/agentBudgetPure.test.ts`
- (Repeat for each of the 14 test files authored in this chunk.)

**Dependencies.** Chunk 1 (the optimiser `system_agents` row is referenced by evaluator modules' default values).

---

## Chunk 4 — Phase 1B: skillLatency query module + evaluator

**Goal.** Author the one query module that consults the peer-medians view, with explicit handling for the empty-view case (partial mode, not failure).

**Files to create.**
- `server/services/optimiser/queries/skillLatency.ts` (NEW) — joins per-subaccount p95 latency from `agent_execution_events` to peer-medians view by `skill_slug`.
- `server/services/optimiser/recommendations/skillSlow.ts` (NEW) — evaluator.
- `server/services/optimiser/queries/__tests__/skillLatencyPure.test.ts` (NEW).
- `server/services/optimiser/recommendations/__tests__/skillSlowPure.test.ts` (NEW).
- `server/services/optimiser/queries/__tests__/skillLatencyEmptyView.test.ts` (NEW) — integration test against a fixture DB where the peer-medians view is empty; asserts the query returns `[]` and signals partial-mode to the caller.

**Implementation notes (invariants).**
- The module exports two callables:
  1. `runSkillLatencyQuery(tx, subaccountId)` — returns `QueryRow<SkillSlowEvidence>[]` from the per-subaccount p95 ⨝ peer-medians inner join. If no peer-median row exists for a `skill_slug`, that `skill_slug` is silently dropped (HAVING already filtered <5-tenant skills).
  2. `peerMediansViewIsPopulated(tx)` — `SELECT EXISTS(SELECT 1 FROM optimiser_skill_peer_medians LIMIT 1)`. The agent runtime calls this BEFORE invoking `runSkillLatencyQuery`. False → emit `optimiser.scan.partial` and skip the skillLatency category for this subaccount run (invariant 22).
- Per-subaccount p95 is computed inside the same query as `percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'durationMs')::numeric) FROM agent_execution_events WHERE event_type='skill.completed' AND timestamp >= now() - interval '7 days' AND subaccount_id = $subaccountId GROUP BY payload->>'skillSlug'`.
- Cross-tenant read guard: this module's actual SQL execution must run inside `withAdminConnectionGuarded` because the JOIN reaches into the materialised view. The agent runtime (Chunk 5) is responsible for choosing the connection mode for this category specifically — document the requirement clearly so the runtime author cannot miss it.
- **`median_version` snapshot assertion (invariant 32).** The agent runtime reads `median_version` from the view once before the scan loop (via a `SELECT median_version FROM optimiser_skill_peer_medians LIMIT 1`) and passes it into `EvaluatorContext`. The `runSkillLatencyQuery` JOIN MUST include `AND peer_medians.median_version = $expectedVersion`. If no row matches (version bumped mid-scan by a concurrent refresh), the query returns `[]` and the agent runtime emits `optimiser.scan.partial` for this category — same path as empty view. This is separate from the `peerMediansViewIsPopulated` check (which guards cold-start / first deploy); the version assertion guards the mid-scan race.
- Evidence carries `median_version` from the joined view row (invariant 12).
- Evaluator threshold: ratio (per-subaccount p95 / peer p95) >= 4 → emit `severity='warn'`. Per spec §2.

**Acceptance criteria.**
- The "empty view" integration test asserts that calling `runSkillLatencyQuery` against an empty view returns `[]` AND that `peerMediansViewIsPopulated` returns false.
- The pure unit test asserts the query's WHERE clause filters by `agent_execution_events.timestamp >= now() - interval '7 days'` AND restricts to the requested `subaccount_id`.
- The evaluator test asserts a fixture row with ratio 4.5 produces a recommendation; ratio 3.9 does not.
- `median_version` is propagated from the joined view row to the evidence payload.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/optimiser/queries/__tests__/skillLatencyPure.test.ts`
- `npx tsx server/services/optimiser/queries/__tests__/skillLatencyEmptyView.test.ts`
- `npx vitest run server/services/optimiser/recommendations/__tests__/skillSlowPure.test.ts`

**Dependencies.** Chunks 1, 2.

---

## Chunk 5 — Phase 2A: AGENTS.md, scan skill specs, agent runtime orchestration

**Goal.** Author the agent role definition + 8 scan skill markdown specs + the orchestration function the agent runtime calls per scheduled run. After this chunk, the optimiser agent can be invoked end-to-end (manually) for a subaccount and produces recommendations against fixture telemetry.

**Files to create / modify.**
- `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` (NEW) — role, system prompt (per spec §4), skill manifest listing the 8 scan skills + `output.recommend` + the LLM-render skill (see below).
- `server/skills/optimiser/scan_agent_budget.md` (NEW)
- `server/skills/optimiser/scan_workflow_escalations.md` (NEW)
- `server/skills/optimiser/scan_skill_latency.md` (NEW)
- `server/skills/optimiser/scan_inactive_workflows.md` (NEW)
- `server/skills/optimiser/scan_escalation_phrases.md` (NEW)
- `server/skills/optimiser/scan_memory_citation.md` (NEW)
- `server/skills/optimiser/scan_routing_uncertainty.md` (NEW)
- `server/skills/optimiser/scan_cache_efficiency.md` (NEW)
- `server/services/skillExecutor.ts` (MODIFY) — 8 new cases, each a thin wrapper that calls the corresponding query module + evaluator. Each case wrapped in try/catch emitting the structured-log events.
- `server/services/optimiser/runOptimiserScan.ts` (NEW) — top-level orchestration `async function runOptimiserScan(subaccountId, organisationId, agentId): Promise<OptimiserRunSummary>`.
- `server/services/optimiser/renderRecommendation.ts` (NEW) — single-call Sonnet render step; cached by `(category, dedupe_key, evidence_hash, render_version)`. Uses `llmRouter` (per DEVELOPMENT_GUIDELINES §4) with `feature='optimiser.recommendation_render'`. Read-cache lookup before the LLM call.
- `server/services/optimiser/__tests__/runOptimiserScanPure.test.ts` (NEW) — pure orchestration test with mocked query/evaluator/output modules; asserts pre-sort order, sequential `output.recommend` invocation, circuit-breaker threshold.
- `server/services/optimiser/__tests__/runOptimiserScan.test.ts` (NEW) — integration test against a fixture subaccount with seeded telemetry across all 8 categories; asserts recommendations land with expected `dedupe_key` and `evidence_hash`.

**Implementation notes (invariants).**

The orchestration function does the following in order:

```
runOptimiserScan(subaccountId, organisationId, agentId):
  emit optimiser.scan.started{scanCategory: 'all'}
  load priorRecs := SELECT ... ORDER BY created_at DESC, id DESC for each
                   (subaccount, category, dedupe_key) tuple, all states (invariant 18)
  determine medianVersion := from peer-medians view, or 0 if peerMediansViewIsPopulated() = false
  if peer-medians view is empty:
    skip skillLatency category
    emit optimiser.scan.partial
  failedCount := 0
  candidates := []
  for each of the 8 categories, IN PARALLEL inside one withOrgTx
    (all 8 share one snapshot per "Scan execution contract"):
    try:
      rows := queryModule.run(tx, subaccountId)
      input_hash := sha256(canonicaliseEvidence(rows))
      emit optimiser.scan.completed{scanCategory, durationMs, resultCount, evaluator_input_hash}
      if rows.length === 0:
        emit optimiser.scan.noop{scanCategory}
        continue
      results := evaluator.evaluate(rows, {subaccountId, organisationId, medianVersion, priorRecsByDedupe: priorRecs})
      candidates.push(...results)
    catch err:
      failedCount++
      emit optimiser.scan.failed{scanCategory, errorType, errorMessageRedacted}
  if failedCount / 8 > 0.5:
    emit optimiser.scan.circuit_breaker{failedCategories, totalCategories: 8}
    return early (do not write recommendations from the partial run; halt processing per invariant 25)
  // pre-sort per invariant 23
  sort candidates by (severityRank desc, category asc, dedupeKey asc)
  for each candidate, SEQUENTIALLY (invariant 24):
    if priorRec[candidate.dedupeKey].evidenceHash === computeEvidenceHash(candidate.evidence):
      // identical evidence; the materialDelta in `output.recommend` will short-circuit anyway,
      // but the pre-check saves the LLM render call (plan invariant "Cost enforcement / LLM skip on identical recommendation")
      emit optimiser.recommendation.deduped{category, dedupeKey}
      continue
    rendered := await renderRecommendation(candidate.category, candidate.dedupeKey, candidate.evidence)
    out := await callSkill('output.recommend', {...candidate, title: rendered.title, body: rendered.body})
    if out.was_new:
      emit optimiser.recommendation.created{category, dedupeKey, recommendation_id: out.recommendation_id}
  return summary
```

- Render step uses Sonnet (`anthropic-claude-sonnet`-class, fixed model, not configurable — plan invariant). Cache check is a `SELECT body FROM agent_recommendations WHERE evidence_hash = $1 AND category = $2 LIMIT 1` (existing rows from prior runs are the cache). On hit, reuse the body verbatim — zero LLM tokens. Document the cache-hit log line `optimiser.render.cache_hit`.
- Cache miss: `llmRouter.complete({feature: 'optimiser.recommendation_render', model: 'sonnet', maxTokens: 200, prompt: <category-specific prompt with evidence>})`. Output enforces "no category slug visible in title/body" — assertion test in Chunk 8 reads the produced body and asserts no `.` is followed by `over_budget`/etc.
- The orchestration runs inside a single `withOrgTx` so all 8 query reads share a snapshot. The skill-latency query inside it switches role per Chunk 4's note via a nested `withAdminConnectionGuarded` block — this is the only cross-tenant read.
- Each scan-skill executor case wraps its invocation in try/catch; the orchestration's local `failedCount` counter is incremented when the case returns `{ success: false }`. Circuit breaker at >50%.
- `output.recommend` (Phase 0) is reused unchanged. The orchestration does not call `db.insert(agentRecommendations)` directly — it always goes through `callSkill('output.recommend', ...)` so the lock + cooldown + materialDelta + cap-eviction logic from Phase 0 is honoured.
- **Evaluator optional-field normalisation (invariant 33).** Each evaluator must set all optional evidence fields explicitly before returning — `null` if absent, never `undefined`. This prevents spurious "material change" signals and render cache misses from `undefined` vs `null` hash drift.
- **Early cost instrumentation.** The render step (`renderRecommendation.ts`) MUST log `optimiser.render.tokens_used{promptTokens, completionTokens, costUsd, cacheHit: false}` on every LLM call and `optimiser.render.cache_hit` on every cache hit. This enables per-subaccount cost measurement during dev runs (not just Chunk 8) and catches runaway spend before the gate. During Chunk 5 development, manually run the integration test against a 5-subaccount fixture and check the logs — the Chunk 8 cost gate should not be the first time cost is observed.

**Acceptance criteria.**
- Each scan skill markdown spec follows the existing `server/skills/output/recommend.md` template structure (input shape, side effects, returns).
- `runOptimiserScanPure.test.ts` asserts: candidates pre-sorted by `(severity desc, category asc, dedupeKey asc)`; `output.recommend` calls are sequential (mock observes call order); circuit breaker fires at exactly 5/8 failures; partial mode skips skillLatency only when `peerMediansViewIsPopulated` returns false.
- `runOptimiserScan.test.ts` (integration) seeds a subaccount with telemetry triggering all 8 categories; asserts 8 `agent_recommendations` rows land with the expected `dedupe_key` and `evidence_hash`.
- Re-running the integration test produces 0 new rows (Phase 0 dedupe holds; `optimiser.recommendation.deduped` events emitted instead of `.created`).
- Lint + typecheck clean.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/optimiser/__tests__/runOptimiserScanPure.test.ts`
- `npx tsx server/services/optimiser/__tests__/runOptimiserScan.test.ts`

**Dependencies.** Chunks 3, 4.

---

## Chunk 6 — Phase 2B: shared registerOptimiserSchedule, backfill script, subaccount-create hook

**Goal.** Wire the optimiser to fire on a daily cron for every existing subaccount with `optimiser_enabled=true`, AND for every new subaccount as it is created. After this chunk, the optimiser is operational at the orchestration layer; only the dashboard surface is missing.

**Files to create / modify.**
- `server/services/agentScheduleService.ts` (MODIFY) — add `registerOptimiserSchedule(subaccountId)` per the Contracts block.
- `scripts/backfill-optimiser-schedules.ts` (NEW) — one-shot script.
- `server/routes/subaccounts.ts` (MODIFY) — POST `/api/subaccounts` handler calls `agentScheduleService.registerOptimiserSchedule(sa.id)` after the `subaccounts` insert returns, when `sa.optimiser_enabled === true` (default true). Wrap in `.then().catch(...)` (fire-and-forget) — schedule registration must not block subaccount creation, mirroring the `subaccountOnboardingService.autoStartOwedOnboardingWorkflows` pattern already in this file.
- `server/services/__tests__/registerOptimiserSchedulePure.test.ts` (NEW) — pure test for the cron-stagger function.
- `server/services/__tests__/registerOptimiserSchedule.test.ts` (NEW) — integration test asserting concurrent invocations produce a single `subaccount_agents` row + a single pg-boss schedule entry.
- `scripts/__tests__/backfillOptimiserSchedules.test.ts` (NEW) — integration test asserting re-running the script over an already-backfilled fixture DB produces 0 net writes.

**Implementation notes (invariants).**
- `registerOptimiserSchedule` resolves the optimiser `system_agents` row → looks up the corresponding `agents` row for the subaccount's organisation (the system-agent → org-agent fan-out is the existing pattern; see how Portfolio Health Agent threads through `agents` in 0068). If the `agents` row is missing, throw `OPTIMISER_SCHEDULE_AGENT_MISSING` (500) — this is a deploy-time error, not a runtime per-subaccount error.
- Stagger: `cron = '${minutes} 6 * * *'` where `minutes = parseInt(sha256(subaccountId).slice(0, 4), 16) % 360`. Across 360 minutes (= 6 hours starting at local 06:00) using sub-account local timezone. This gives <1% probability of two subaccounts firing in the same minute (invariant: 100 subaccounts → expected collisions ~14, peak load ~1 fire/minute).
- `INSERT INTO subaccount_agents (...) ON CONFLICT (subaccount_id, agent_id) DO NOTHING RETURNING id` — if the row already exists, the RETURNING clause is empty; do a follow-up `SELECT id FROM subaccount_agents WHERE ...` to get the id. Both operations run in one `withOrgTx`.
- Backfill script: `withAdminConnection` to read all `subaccounts` where `optimiser_enabled = true`. For each, call `registerOptimiserSchedule(sa.id)`. Acquire `pg_advisory_lock(hashtext('optimiser.backfill'))` at top so two operators can't double-run; second instance exits 1 with a clear human-readable message: `"Another backfill is already running (lock held). Wait for it to complete or check for a stalled process, then retry."` — and also emits `OPTIMISER_BACKFILL_LOCK_HELD` in the structured log.
- Subaccount-create hook is fire-and-forget. Failure path logs `optimiser_schedule_register_failed` with `{subaccountId, error}` and does NOT bubble — operator can re-run the backfill script to recover.

**Acceptance criteria.**
- `registerOptimiserSchedule` is idempotent: invoking it twice for the same subaccount produces exactly one `subaccount_agents` row and one pg-boss schedule entry.
- Concurrent invocations (race test) produce a single row.
- Backfill script's re-run produces 0 net writes (verified by row count before/after).
- Backfill script's two-process test: second instance fails with `OPTIMISER_BACKFILL_LOCK_HELD`.
- Subaccount-create POST handler still returns the new subaccount JSON in <500ms even when the optimiser-schedule registration is deliberately stalled (asserts fire-and-forget).
- Lint + typecheck clean.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/registerOptimiserSchedulePure.test.ts`
- `npx tsx server/services/__tests__/registerOptimiserSchedule.test.ts`
- `npx tsx scripts/__tests__/backfillOptimiserSchedules.test.ts`

**Dependencies.** Chunk 5.

---

## Chunk 7 — Phase 3: Dashboard wiring + zero-state non-mount

**Goal.** Render the recommendations section on `DashboardPage` between "Pending your approval" and "Your workspaces", scope-aware via `Layout.tsx` `activeClientId`. Section MUST NOT mount when zero open recs.

**Files to create / modify.**
- `client/src/pages/DashboardPage.tsx` (MODIFY) — insert the new section + state hooks for `mode` and `total`.
- `client/src/components/recommendations/AgentRecommendationsList.tsx` (already shipped Phase 0; verify the `emptyState='hide'` default is wired such that the parent can detect zero state and unmount, not just hide. If it currently renders a hidden DOM node, refactor: lift the empty-check to the parent.)
- `client/src/hooks/useAgentRecommendations.ts` (already shipped Phase 0; verify socket subscription unmounts cleanly on parent unmount — this is the rationale for invariant 29).
- `client/src/pages/__tests__/DashboardPageOptimiserSection.test.tsx` (NEW) — render-only test (pure component test, no router/network) asserting:
  - org context renders `<AgentRecommendationsList scope={{type:'org', orgId}} includeDescendantSubaccounts={true} />`
  - subaccount context renders `<AgentRecommendationsList scope={{type:'subaccount', subaccountId}} />`
  - zero `total` → section element is not present in the rendered DOM (not just `display:none`)
  - "See all N →" link toggles `mode` from `collapsed` to `expanded`
  - sort order obeyed: `priority DESC, created_at DESC, id DESC` on initial render and after a simulated socket event injecting a low-priority new row (asserts post-event re-sort puts the new row in the correct position, not at the top — invariant 28)

**Implementation notes (invariants).**
- DashboardPage holds `[recommendationsTotal, setRecommendationsTotal] = useState<number | null>(null)` and renders the section only when `recommendationsTotal !== null && recommendationsTotal > 0`. The hook calls `onTotalChange(0)` after the initial fetch even when zero rows; the parent then unmounts the component on the next render. This guarantees non-mount on zero rows after first fetch (invariant 29). Pre-first-fetch, `recommendationsTotal === null` and the section is also not rendered — no flash of mounted-then-unmounted state.
- Socket event handler in the hook: `dashboard.recommendations.changed` → re-fetch via the existing query (debounced 250ms per Phase 0). On re-fetch, the entire row list is re-sorted by the canonical comparator (invariant 28). The hook does NOT splice individual events into the local list — it always re-fetches. Document this in a comment on the hook so a future reader doesn't introduce splicing.
- "See all N →" affordance uses local state on `DashboardPage` (`mode`); inline expansion, no navigation (per spec §7).
- Sidebar count badge: existing `Layout.tsx` already has the slot. The badge consumes `recommendationsTotal` from a small `useAgentRecommendationsTotal()` hook variant that fetches `?limit=0` (count-only, per the Phase 0 short-circuit per `tasks/builds/subaccount-optimiser/progress.md` Decisions log #4). Add this hook in this chunk.

**Acceptance criteria.**
- DashboardPage renders the section in both contexts; the test file passes.
- Zero-state behaviour: section element absent from DOM when `total === 0`. Confirmed by `screen.queryByText('A few things to look at')` returning null.
- Socket-event re-sort behaviour confirmed by the test.
- Lint + typecheck + `npm run build:client` clean.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx vitest run client/src/pages/__tests__/DashboardPageOptimiserSection.test.tsx`

**Dependencies.** Chunk 6 (the recommendations the dashboard renders are produced by the orchestration wired up in Chunks 5–6; without those, the dashboard works but renders zero state for every subaccount).

---

## Chunk 8 — Phase 4: Verification, cost measurement, doc updates, progress closeout

**Goal.** Execute the verification matrix from the orchestration plan's done definition, measure cost, update docs, close out progress.

**Files to create / modify.**
- `server/services/optimiser/__tests__/verificationMatrix.test.ts` (NEW) — single integration test file aggregating the verification matrix below. Each `describe` block targets one done-definition item.
- `docs/capabilities.md` (MODIFY) — Sub-account observability section: describe the optimiser AND the generic primitive (Phase 0 already did the primitive; add the optimiser as the first consumer).
- `architecture.md` (MODIFY) — document the cross-tenant peer-medians view as a sysadmin-bypassed read; document the optimiser as the first consumer of the `agent_recommendations` primitive; add to "Key files per domain" table.
- `tasks/builds/subaccount-optimiser/progress.md` (MODIFY) — close out Phases 2-6 (= spec §9 Phases 1-4); record any decisions made during Stream 2 build.
- `KNOWLEDGE.md` (MODIFY, append-only) — add entries for any new patterns surfaced (e.g. "shared registerOptimiserSchedule pattern", "view emptiness as scan.partial signal").

**Verification matrix (verificationMatrix.test.ts test plan).**

| Test case | Done-definition item | Approach |
|---|---|---|
| All 8 categories produce realistic recommendations against synthetic fixture | done #2 | Seed 8-category fixture; run `runOptimiserScan`; assert 8 `agent_recommendations` rows. |
| Empty-telemetry fixture produces no false positives | done #3 | Seed empty subaccount; run `runOptimiserScan`; assert 0 rows + `optimiser.scan.noop` × 8 events. |
| High-noise fixture: cap + dedupe prevent runaway | done #4 | Seed 50 candidates; run scan; assert ≤10 rows (cap) and `recommendations.dropped_due_to_cap` log emitted. |
| Lifecycle: dismissed rec with unchanged evidence does not reappear in TTL | done #5 | Insert recommendation, dismiss with `cooldown_hours=24`, re-run scan with same evidence, assert no new row + `cooldown` reason. |
| Material-change threshold: sub-threshold movements produce no new recs | done #6 | Insert open rec with `evidence.this_month=7300`; re-run with `7400` (1.3% change); assert no row update. Then re-run with `8000` (9.6% / >$10); assert UPDATE-in-place. |
| pg-boss retry simulation: duplicate trigger mid-run produces no duplicates | done #7 | Invoke `runOptimiserScan` twice concurrently; assert exactly 8 rows (advisory lock + Phase 0 dedupe holds). |
| Concurrent create-hook + backfill race produces single schedule entry | done #8 | Promise.all of create-hook insert + backfill script for the same subaccount; assert exactly 1 `subaccount_agents` row. |
| Evaluator purity: identical inputs produce identical output | done #9 | Run each evaluator 10× with input order shuffled; assert by-key identical output (per DEVELOPMENT_GUIDELINES §8.21). |
| First scan with empty peer-medians view → partial mode | invariant 22 | Truncate the view, run scan, assert `optimiser.scan.partial` emitted, skillLatency category skipped, other 7 categories produce rows. |
| Dashboard zero-state: section does not mount | done #10 | (Covered in Chunk 7's component test; reference here for matrix completeness.) |
| 8 observability events all emitted in one happy-path run | done #11 | Run scan with seeded fixture covering all categories; assert each event family appears at least once. |
| Slug leakage: no category slug appears in rendered title/body | spec §13 risk | Run scan; for each `agent_recommendations` row, assert `body !~ /optimiser\.[a-z]+\.[a-z_]+/`. |

**Cost measurement.**
- Seed 5 subaccounts × 7 days of representative telemetry (mix of triggering + non-triggering data).
- Run the optimiser for each subaccount.
- Sum `cost_total_usd` over the resulting `llm_requests` rows tagged with `feature='optimiser.recommendation_render'`.
- Assert total < $0.10 (i.e. < $0.02 / subaccount / day average — done #12).
- Document the measurement in `tasks/builds/subaccount-optimiser/progress.md` closeout section with the actual measured number.

**Doc updates.**

`docs/capabilities.md` — under "Sub-account observability":
- New paragraph: optimiser ships with 8 categories: agent.over_budget, playbook.escalation_rate, skill.slow, inactive.workflow, escalation.repeat_phrase, memory.low_citation_waste, agent.routing_uncertainty, llm.cache_poor_reuse. Daily cron at sub-account local 06:00 (staggered). Operator-facing copy is plain English; no internal slugs visible.
- Editorial rules: vendor-neutral, model-agnostic. Phase 0 added the `agent_recommendations` primitive entry; this stream extends with the optimiser.

`architecture.md` — under "Service layer" (or wherever existing optimiser/recommendations lives after Phase 0):
- Document `server/services/optimiser/queries/` (8 query modules, uniform `QueryRow` shape).
- Document `server/services/optimiser/recommendations/` (8 evaluators, pure).
- Document `runOptimiserScan` orchestration function and its withOrgTx + withAdminConnectionGuarded composition for skill-latency.
- Document the peer-medians materialised view as a sysadmin-bypassed read (cross-reference `references/rls-not-applicable-allowlist.txt`).
- Add a one-liner under "Key files per domain" pointing to the optimiser entry points.

`tasks/builds/subaccount-optimiser/progress.md` — close out Phases 2-6 (= §9 Phases 1-4):
- Per-phase actual effort (vs ~19h estimate).
- Decisions made during build (e.g. "carry median_version inside evidence JSONB; no second migration").
- Cost-measurement number from above.
- Set `Status: COMPLETE`.

`KNOWLEDGE.md` — append entries (do not edit prior entries):
- "[YYYY-MM-DD] Pattern — Shared register-X-schedule function for backfill + create-hook" — body explaining the pattern + why duplicating in two writers fails.
- "[YYYY-MM-DD] Pattern — Materialised view emptiness signals partial-mode, not failure" — body referencing the optimiser peer-medians case.
- "[YYYY-MM-DD] Correction — anything caught during chunk reviews that fits the Correction template."

**Acceptance criteria.**
- Verification matrix test file passes via `npx tsx`.
- Cost measurement < $0.10 across 5×7 fixture; recorded in progress.md.
- Lint + typecheck + build:server + build:client clean.
- All four doc files updated in the same commit as the progress.md closeout.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx tsx server/services/optimiser/__tests__/verificationMatrix.test.ts`

**Dependencies.** All prior chunks.

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Composite indexes assumed in pre-build checklist are missing → seq scans on hot paths | Medium | High | Each query module's pure test asserts the assumed index exists (queries `pg_indexes`); fail-loud, force the chunk to add the index migration before completing. |
| Peer-medians view stays empty in dev DB → skillLatency category never tested | High | Medium | Chunk 4's empty-view integration test is mandatory and asserts the partial-mode path. Chunk 8 verification matrix re-asserts with truncated view. |
| LLM render cost overruns the $0.02/sa/day target | Low | High | Render is gated on `(category, dedupe_key, evidence_hash, render_version)` cache hit; pre-write evidence-hash equality short-circuits the LLM call entirely (orchestration plan invariant). Chunk 8 measures actual cost, not estimated — gate failure blocks merge. |
| Concurrent backfill + create-hook race produces split-brain `subaccount_agents` rows | Low | High | Both writers go through `registerOptimiserSchedule` which uses `INSERT ... ON CONFLICT DO NOTHING`. Chunk 6 integration test simulates the race. |
| Schedule storm at deploy time (100+ daily crons firing within seconds) | Low | Medium | Stagger by `hash(subaccountId) % 360` minutes within the 06:00 local window (Chunk 6). |
| Silent partial-success: a subaccount run "completes" but 4 of 8 categories silently failed → operator trust drops over weeks | Medium | High | Circuit breaker at >50% failures emits `optimiser.scan.circuit_breaker` (Chunk 5). Per-category `optimiser.scan.failed` events emitted on every category-level error. Chunk 8 verification matrix tests the circuit-breaker threshold. |
| `evidence_hash` drift due to JS Number canonicalisation regression | Low | High | Phase 0 ships canonicalisation with explicit rules + tests. This stream does not modify `shared/types/agentRecommendations.ts` canonicaliser. New evidence shapes are only added to the discriminated union; the canonicaliser handles them generically. |
| Slug leak to UI (`optimiser.agent.over_budget` appears in a title or body) | Medium | Medium | Chunk 8 verification matrix asserts no slug pattern in rendered title/body. Render prompt explicitly forbids the agent from using internal slugs (per spec §4 system prompt). |
| Materialised view refresh fails silently overnight → stale peer-medians data | Low | Low | Chunk 2 emits `optimiser.peer_medians.refresh.failed`. Staleness is bounded — a one-day-old peer baseline is acceptable per spec §3 design. |
| Dashboard section flashes zero-state then hides on slow networks | Low | Low | Chunk 7 mounts the section only when `total > 0` from the first fetch — pre-fetch state is `null`, section not rendered. No flash. |
| Plan invariant "optimistic locking with `WHERE evidence_hash = <expected>`" interpreted as a Phase 0 rewrite | Medium | Medium | Architecture note 3 documents that Phase 0's `SELECT ... FOR UPDATE` inside the per-`(scope, producing_agent_id)` advisory-lock transaction is the chosen guard, and the plan's "either approach is acceptable" language permits this. Do not rewrite Phase 0. |
| Phase 0 assumes `archived` recommendations exist for the most-recent-recommendation lookup | Low | Medium | Architecture note 8 documents that v1 has no `archived` state; the lookup reduces to "all states". Document explicitly in evaluator code. |

---

## Self-consistency pass

- Goals (eight categories, daily scan, dashboard surface, primitive reuse) match implementation (8 query modules + 8 evaluators + dashboard wiring + reuse of Phase 0 `output.recommend`). ✓
- Every chunk's "Files to create / modify" cross-references the orchestration plan's "Files touched (summary)". ✓
- Every plan invariant is mapped to at least one chunk's "Implementation notes" section. ✓
- Test gates: only `npm run lint`, `npm run typecheck`, `npm run build:server`, `npm run build:client`, and per-test-file `npx tsx` / `npx vitest run` invocations appear in any chunk's "Verification commands". No `npm run test:gates`, no `scripts/verify-*.sh`, no `npm test`. ✓
- Source-of-truth precedence: `agent_recommendations` row > `evidence` JSONB > socket event > UI render. Consistent with Phase 0 §6.5. ✓
- Single-source-of-truth claims survive: `registerOptimiserSchedule` is the only writer for `subaccount_agents` × optimiser; the peer-medians view is the only source of cross-tenant skill latency baselines; `materialDelta` registry in `shared/types/agentRecommendations.ts` is the only place predicate logic lives. ✓
- Idempotency: `output.recommend` is key-based (Phase 0); `registerOptimiserSchedule` is upsert + pg-boss-schedule-name idempotent; `refreshPeerMedians` is single-writer guarded. ✓
- Concurrency guard: all racing writes have a guard (advisory lock for output.recommend + refresh; ON CONFLICT for subaccount_agents). ✓
- Terminal events: `optimiser.scan.completed` / `.failed` / `.partial` / `.circuit_breaker` are mutually exclusive per category-run. ✓
- HTTP unique-constraint mapping: no new unique constraints introduced (Phase 0 already mapped them). ✓
- State-machine closure: `dismissed_until` is the only new transition surface and Phase 0 already pinned it. ✓

---

## Deferred items (carry forward — not in scope here)

None new in this stream. All deferred items are already enumerated in `docs/sub-account-optimiser-spec.md` § Deferred Items and remain deferred:

- Org-tier optimiser meta-agent (Portfolio Health Agent occupies that role).
- Auto-execution of recommendations.
- Standalone `/suggestions` page (v1.1).
- ML-based brand-voice classification.
- Wider Home dashboard scope-awareness.
- Riley W3-dependent categories (`context.gap.persistent`, `context.token_pressure`).
- Notification surfaces for recommendations (Slack / email / push).
- Sub-account-settings UI toggle for `optimiser_enabled`.
- `evidence_version` field for evidence-shape evolution.
- Soft global per-scope cap across producing agents.
- Cap-eviction category-diversity bias.
- Periodic schedule-rebalancing job.

---

## Executor notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- Phase 0 (PR #251) is shipped on main. Do not rebuild `agent_recommendations` table, `output.recommend` skill, `<AgentRecommendationsList>` component, the read/acknowledge/dismiss endpoints, or the canonicaliser. Read `tasks/builds/subaccount-optimiser/progress.md` if uncertain about what shipped.
- Migrations are claimed at merge time. Use `<NNNN>_<name>.sql` as a placeholder during PR development and rename to the next-free integer immediately before merge (per DEVELOPMENT_GUIDELINES §6). At plan time the next-free integer is **0268**.
- Any chunk that violates an invariant in the System Invariants block above is incorrect even if its tests pass. Re-read the invariants before completing each chunk.
- Stream 1 (F1 + F3) is fully orthogonal. No coordination required.
- This plan's chunk boundaries were chosen so each chunk is buildable by a single focused builder session of ≤4h. If any chunk runs over 6h, re-read the chunk's "Files to create / modify" — it has likely sprawled and should be re-decomposed before continuing.
