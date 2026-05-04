# Spec Conformance Log

**Spec:** `docs/sub-account-optimiser-spec.md`
**Plan (locked):** `tasks/builds/stream-2-optimiser-finish/impl-plan.md`
**Spec commit at check:** `c8412b14`
**Branch:** `stream-2-optimiser-finish`
**Base:** `a87b30b7029f60e2b3ec471bf15d9077c96bdc49`
**Scope:** Stream 2 — spec §9 Phases 1-4 (Phase 0 already shipped on main via PR #251) — corresponds to plan Chunks 1-8.
**Changed-code set:** ~80 files (8 query modules, 8 evaluator modules, 8 skill specs, 8 evaluator tests + 8 query tests, orchestration, scheduling, dashboard, migration 0268, peer-medians refresh job, 2 docs updates, etc.).
**Run at:** 2026-05-04T20:49:01Z

---

## Contents

- Summary
- Requirements extracted (full checklist)
- Mechanical fixes applied
- Directional / ambiguous gaps (routed to `tasks/todo.md`)
- Files modified by this run
- Next step

---

## Summary

- Requirements extracted:     ~60 (consolidated by spec subcomponent).
- PASS:                       42
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 8
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

> Note: I considered numerous candidate mechanical fixes (renaming a field, patching one URL) but every plausible fix in this branch touches multiple chunks, multiple categories, or rebases on the Phase 0 contract — i.e. design choices the user must make. I therefore auto-fixed nothing and deferred everything to `tasks/todo.md`.

**Verdict:** **NON_CONFORMANT** — 8 directional gaps, several with material correctness implications (evidence-shape mismatch breaks `materialDelta`; render-cache key mismatch defeats LLM cost optimisation; section pre-fetch probe partially defeats invariant 29).

---

## Requirements extracted (full checklist)

Grouped by spec section / plan chunk. Verdicts: PASS / DIRECTIONAL_GAP (DG) / OUT_OF_SCOPE (OS) — no mechanical fixes were applied.

### Chunk 1 — Migration 0268 + system_agents seed (spec §3, plan Chunk 1)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| 0268 migration creates `optimiser_skill_peer_medians` materialised view | PASS | `migrations/0268_optimiser_peer_medians.sql:3-24` |
| `HAVING count(distinct organisation_id) >= 5` (5-tenant minimum) | PASS | line 24 |
| No raw tenant identifiers in projection | PASS | columns are `skill_slug, p50_ms, p95_ms, p99_ms, n_tenants, median_version, refreshed_at` |
| `REVOKE ALL FROM PUBLIC; GRANT SELECT TO admin_role` | PASS | lines 29-30 |
| `median_version` integer constant on view | PASS | `1::int AS median_version` line 16 |
| `system-scoped:` header comment in migration | PASS | line 1 |
| Seed `system_agents` row with `slug='subaccount-optimiser'`, `execution_scope='subaccount'` | PASS | lines 34-65 |
| `INSERT … ON CONFLICT (slug) DO NOTHING` (idempotent re-run) | PASS | line 65 |
| Initial `REFRESH MATERIALIZED VIEW` at end of migration | PASS | line 68 |
| `.down.sql` drops view + seed row | PASS | `0268_optimiser_peer_medians.down.sql` |
| Drizzle export of view as read-only schema object | PASS | `server/db/schema/optimiserSkillPeerMedians.ts` |
| Schema export registered in `server/db/schema/index.ts` | PASS | line 255 |
| RLS-exclusion entry recorded with rationale | PASS | `server/db/rlsExclusions.ts:24` |
| Plan-named files not in repo (`canonicalDictionary.ts`, `references/rls-not-applicable-allowlist.txt`) | OS — out-of-repo paths | The plan referenced legacy paths that don't exist on `main`; the canonical RLS-exclusion list lives at `server/db/rlsExclusions.ts`, which has the correct entry. Treated as plan-accuracy noise, not a spec gap. |
| Migration uses `event_type = 'skill.completed'` (vs spec's outdated `'tool_call.completed'`) | PASS — plan-locked correction | The plan §Architecture explicitly retracted the spec's old slug; `'skill.completed'` is the canonical event type per `shared/types/agentExecutionLog.ts`. |
| Migration uses `event_timestamp` column (matches actual schema; spec used `timestamp` shorthand) | PASS | matches `agentExecutionEvents.eventTimestamp` |

### Chunk 2 — Peer-medians refresh job + scheduling (plan Chunk 2)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| `server/services/optimiser/refreshPeerMedians.ts` exports `runPeerMediansRefresh()` | PASS | line 18 |
| Wraps refresh in `withAdminConnectionGuarded` with `allowRlsBypass: true` and rationale | PASS | lines 23-28 |
| `pg_try_advisory_xact_lock(hashtext('optimiser.peer_medians.refresh'))` single-writer guard | PASS | lines 33-41 |
| Logs `optimiser.peer_medians.refresh.skipped_locked` on lock contention | PASS | line 39 |
| `SET LOCAL ROLE admin_role` then `REFRESH MATERIALIZED VIEW` | PASS | lines 43-44 |
| Emits `optimiser.peer_medians.refresh.started/completed/failed` structured logs | PASS | lines 20, 48, 50 |
| `server/jobs/refreshOptimiserPeerMedians.ts` thin pg-boss handler | PASS | full file |
| pg-boss schedule registered with cron `0 0 * * *` UTC | PASS | `agentScheduleService.ts:202` |
| Integration test deferred to CI | PASS — plan-allowed deferral | progress.md decision log + plan §Executor notes |
| Pure unit test `refreshPeerMediansPure.test.ts` | PASS | exists |

### Chunk 3 — 7 non-peer query modules + evaluators

| REQ | Verdict | Evidence |
|-----|---------|----------|
| 7 query modules under `server/services/optimiser/queries/` | PASS | agentBudget, escalationRate, inactiveWorkflows, escalationPhrases, memoryCitation, routingUncertainty, cacheEfficiency |
| 7 evaluator modules under `server/services/optimiser/recommendations/` | PASS | agentBudget, playbookEscalation, inactiveWorkflow, repeatPhrase, memoryCitation, routingUncertainty, cacheEfficiency |
| Shared `QueryModule`/`QueryRow` types | PASS | `queries/types.ts` |
| Shared `Evaluator`/`EvaluatorContext`/`EvaluatorOutput` types | PASS | `recommendations/types.ts` |
| `actionHints.ts` URL builder per spec §6.5 | DG-3 | URLs diverge from spec §6.5 schema (entity name, focus param, missing query string params for several categories). |
| Each query SQL has `>= now() - interval '7 days'` time filter | PASS | sampled `agentBudget.ts:52`, `skillLatency.ts:114` etc. |
| Each query sets `SET LOCAL statement_timeout = '10000'` | PASS | sampled `agentBudget.ts:31`, `skillLatency.ts:92` |
| Aggregate queries have NO `LIMIT` | PASS | inspected — only row-fetch queries carry LIMIT |
| Each query has its own pure unit test | PASS | 8 test files in `queries/__tests__/` |
| Each evaluator has its own pure unit test | PASS | 8 test files in `recommendations/__tests__/` |
| Evidence shapes match `shared/types/agentRecommendations.ts` (Phase 0 contract) | **DG-1 (CRITICAL)** | All 8 evaluators emit camelCase fields (e.g. `thisMonthSpendUsd`, `peerP95Ms`) that do not match the snake_case Phase 0 contract (`this_month`, `peer_p95_ms`). Plan invariant 19 explicitly forbids this divergence. |

### Chunk 4 — `skillLatency` query + evaluator (peer-dependent)

| REQ | Verdict | Evidence |
|-----|---------|----------|
| `runSkillLatencyQuery(tx, subaccountId, expectedMedianVersion)` joins to peer-medians view | PASS | `skillLatency.ts:87-135` |
| `peerMediansViewIsPopulated(tx)` callable | PASS | line 48 |
| JOIN includes `AND pm.median_version = $expectedMedianVersion` (invariant 32) | PASS | line 133 |
| Returns `[]` (not throw) on empty view / version mismatch | PASS | lines 137-140 |
| `skillSlow` evaluator threshold `ratio >= 4` → `severity='warn'` | PASS | confirmed via verificationMatrix test |
| Empty-view integration test deferred to CI | PASS — plan-allowed | impl-plan §Executor notes |

### Chunk 5 — AGENTS.md, scan skills, runOptimiserScan orchestration

| REQ | Verdict | Evidence |
|-----|---------|----------|
| `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` with role, system prompt, skill manifest | PASS | full file |
| 8 scan-skill markdowns in `server/skills/optimiser/` | PASS | all present |
| 8 scan-skill executor cases in `skillExecutor.ts` | PASS | lines 2002-2135 |
| `output.recommend` referenced in skill manifest | PASS | AGENTS.md line 25 |
| `runOptimiserScan.ts` orchestration | PASS | full file |
| Exports `TOTAL_CATEGORIES = 8` and `SCAN_FAILURE_CIRCUIT_BREAKER_THRESHOLD = 0.5` | PASS | lines 58-59 |
| Circuit breaker fires at strictly `> 0.5` (5/8 fires; 4/8 does not) | PASS | line 304; verificationMatrix test asserts both |
| Pre-sort by `(severity desc, category asc, dedupeKey asc)` | PASS | lines 338-344 |
| Sequential `output.recommend` calls (no `Promise.all`) | PASS | for-loop with `await` line 360 |
| `peerMediansViewIsPopulated` check before `skillLatency` | PASS | lines 152-160 |
| `partial_run: true` injected into evidence in partial mode | PASS | lines 364-366 |
| Median-version snapshot via `MAX(median_version)` (not `LIMIT 1`) | PASS | line 164 |
| `renderRecommendation.ts` cache-by-evidence-hash | **DG-2 (CRITICAL)** | Cache lookup uses `cacheEvidenceHash = 'v${RENDER_VERSION}:${evidenceHash}'` but `agentRecommendationsService` (Phase 0 on main) writes the bare sha256 — cache lookup will never hit; LLM render fires every run. |
| Logs `optimiser.render.tokens_used` on every LLM call | PASS | `renderRecommendation.ts:72` |
| Logs `optimiser.render.cache_hit` on every cache hit | PASS | line 53 |
| Pre-rendering identical-evidence dedupe short-circuit | PASS | lines 372-381 |
| Single-snapshot `withOrgTx` for all 8 scans | DG-7 | `runOptimiserScan` calls `getOrgScopedDb()` and assumes the caller wraps in `withOrgTx`, but no production caller exists. The actual scan path is the LLM agent loop driving each scan skill in skillExecutor — each skill calls `getOrgScopedDb()` independently, so they do NOT share a single snapshot (violates plan invariants 6 & 35). `runOptimiserScan` is dead code. |
| `runOptimiserScanPure.test.ts` covers pre-sort + sequential + circuit-breaker + partial-mode | PASS | full file |
| Integration test deferred to CI | PASS — plan-allowed | progress.md log |

### Chunk 6 — registerOptimiserSchedule, backfill, subaccount-create hook

| REQ | Verdict | Evidence |
|-----|---------|----------|
| `registerOptimiserSchedule(subaccountId)` exported from `agentScheduleService.ts` | PASS | line 354 |
| Resolves optimiser `system_agents` slug → org `agents` row | PASS | lines 361-397 |
| Throws `OPTIMISER_SCHEDULE_AGENT_MISSING` on missing rows | PASS | lines 368, 396, 440 |
| Stagger via `hash(subaccountId)` % 360 minutes | PASS | `computeStaggerMinutes` referenced in line 400 |
| `INSERT … ON CONFLICT DO NOTHING` for `subaccount_agents` | PASS | line 417 |
| Self-heal: update schedule if cron formula changed | PASS | lines 446-453 |
| Calls `registerSchedule` (pg-boss) with `${AGENT_RUN_QUEUE}:${subaccountAgentId}` key | PASS | lines 456, 459-469 |
| Schedule timezone hardcoded to `'UTC'` | DG-4 | Spec §4 / plan §Contracts both say "sub-account local timezone" but `subaccounts` schema has no `timezone` column. Implementation used a hard-coded `'UTC'` fallback — reasonable build-time decision, but spec-divergent. |
| `scripts/backfill-optimiser-schedules.ts` advisory lock + iteration | PASS | lines 35-167 |
| Backfill exits with `OPTIMISER_BACKFILL_LOCK_HELD` on contention | PASS | lines 60-68 |
| Backfill is upsert-only (idempotent) | PASS | calls `registerOptimiserSchedule` |
| Backfill filter chain `.where(eq(optimiserEnabled, true)).where(isNull(deletedAt))` | DG-8 | Drizzle's `.where()` REPLACES the predicate when called twice; only the second call (`isNull(deletedAt)`) is effective. The `optimiserEnabled = true` filter is silently dropped, so backfill registers schedules for opted-out subaccounts too. Should be combined via `and(...)`. |
| `subaccountService.create` / `routes/subaccounts.ts` POST hook fires `registerOptimiserSchedule` fire-and-forget when `optimiserEnabled !== false` | PASS | `routes/subaccounts.ts:160-169` |
| Pure unit test for stagger | PASS | `registerOptimiserSchedulePure.test.ts` exists |
| Integration tests deferred to CI | PASS — plan-allowed | progress.md log |

### Chunk 7 — Dashboard wiring + zero-state non-mount

| REQ | Verdict | Evidence |
|-----|---------|----------|
| New section header "A few things to look at" | PASS | `DashboardPage.tsx:435` |
| Section between "Pending your approval" and "Your workspaces" | PASS | inserted between lines 426 and 476 |
| Org context: `<AgentRecommendationsList scope={{type:'org', orgId}} includeDescendantSubaccounts={true} />` | PASS | lines 437-447 |
| Subaccount context: `<AgentRecommendationsList scope={{type:'subaccount', subaccountId}} />` | PASS | activeClientId branch |
| Section renders only when `recommendationsTotal !== null && recommendationsTotal > 0` | PASS | line 432 |
| "See all N →" toggle flips mode to `expanded` | PASS | lines 448-456 |
| `useAgentRecommendationsTotal()` count-only hook for sidebar badge | PASS | full file |
| Zero-state non-mount per invariant 29 | DG-5 | The implementation MOUNTS a hidden `<AgentRecommendationsList limit={1} emptyState="hide" …>` whenever `recommendationsTotal === null` (pre-fetch probe). This subscribes to sockets and is exactly the "ghost socket subscription" invariant 29 forbids. The intended pattern is to use `useAgentRecommendationsTotal` (which exists in the same chunk) for the count probe. After the first fetch the probe unmounts, so the violation is transient — but it does happen on every page load. |
| Pure component test `DashboardPageOptimiserSection.test.ts` | PASS — pure-logic only | confirms scope/total/expand logic; does not render React. |

### Chunk 8 — Verification matrix + doc updates

| REQ | Verdict | Evidence |
|-----|---------|----------|
| `verificationMatrix.test.ts` covers evaluator purity, pre-sort, circuit-breaker, optional-field normalisation, slug-leakage, threshold boundaries | PASS | 822 lines |
| Integration cases (8-category fixture, empty fixture, cost gate) `describe.skip` deferred to CI | PASS — plan-allowed | comment at line 824 |
| `docs/capabilities.md § Sub-account observability` updated | PASS | lines 413-415 |
| `architecture.md` documents query layout, evaluator layout, runOptimiserScan, peer-medians view as cross-tenant aggregate | PASS | lines 1619-1624 |
| `tasks/builds/subaccount-optimiser/progress.md` closed out | PASS | lines 40-64 — Stream 2 closeout section |
| `KNOWLEDGE.md` appended with new patterns | PASS — appended | (head sample shows shared register-X pattern + view-emptiness pattern) |
| Cost gate (<$0.02/sa/day measured) | DG-6 | Plan-allowed deferral to CI gate (live DB + LLM); progress.md notes it. The spec done-definition required *measurement*, not estimation, so the deferral is real but plan-locked. |
| Lint + typecheck clean | PASS | both 0 errors at audit time |

---

## Mechanical fixes applied

None. Every plausible candidate fix in this branch crossed multiple files / multiple chunks / a Phase 0 contract boundary, so all gaps were classified DIRECTIONAL.

---

## Directional / ambiguous gaps (routed to `tasks/todo.md`)

Eight items, in priority order. Full text appended to `tasks/todo.md` under the "## Deferred from spec-conformance review" section.

| # | Severity | Title |
|---|----------|-------|
| DG-1 | CRITICAL — correctness | Evaluator evidence shapes do not match `shared/types/agentRecommendations.ts` (camelCase vs snake_case; different field names) → `materialDelta` predicates compute against missing fields → all material updates silently classified `sub_threshold`. |
| DG-2 | CRITICAL — cost | `renderRecommendation` cache key uses `'v${RENDER_VERSION}:${evidenceHash}'` for lookup but stored rows have bare sha256 → cache never hits → LLM fires every run, defeating the cost optimisation that the spec measures the gate against. |
| DG-3 | NORMAL — UX | `actionHints.ts` URL shapes diverge from spec §6.5 deep-link schema (entity name, focus param, missing query parameters). |
| DG-4 | NORMAL — completeness | `registerOptimiserSchedule` hardcodes timezone to `'UTC'` because `subaccounts` schema lacks a `timezone` column; spec §4 requires "sub-account local timezone". |
| DG-5 | NORMAL — invariant violation | Dashboard's pre-fetch probe mounts `<AgentRecommendationsList>` (with sockets) when `recommendationsTotal === null`, violating invariant 29's "must not mount" rule until the first fetch completes. Use `useAgentRecommendationsTotal` instead. |
| DG-6 | NORMAL — verification | Cost-gate measurement deferred to CI; spec done-definition requires actual measurement (<$0.02/sa/day). Plan-allowed deferral but spec done-definition not yet satisfied. |
| DG-7 | NORMAL — invariant violation | `runOptimiserScan` is dead code — no production caller wraps it in `withOrgTx`. The actual scan path is the LLM agent loop driving 8 separate skill-executor calls, each opening its own `getOrgScopedDb` — they do NOT share a single snapshot (plan invariants 6 & 35 violated). |
| DG-8 | NORMAL — correctness | `scripts/backfill-optimiser-schedules.ts` chains `.where()` twice; Drizzle replaces the predicate, so only `isNull(deletedAt)` runs. The `optimiserEnabled = true` filter is silently dropped, registering schedules for opted-out subaccounts. Combine via `and(...)`. |

---

## Files modified by this run

None.

---

## Next step

**NON_CONFORMANT** — 8 directional gaps, several with material correctness implications, must be addressed by the main session before `pr-reviewer`.

Triage suggestion (highest leverage first):
1. **DG-1** — pick a side: align evaluators to the Phase 0 evidence contract OR re-author Phase 0 evidence types to match the camelCase implementation. The Phase 0 contract is the more durable choice (it owns `materialDelta`, the `evidence_hash` canonicaliser, and the discriminated union the rest of the codebase types against).
2. **DG-2** — decide whether to (a) prefix the stored `evidence_hash` with the render-version when `output.recommend` writes, or (b) drop the `'v${V}:'` prefix from the lookup and instead include `RENDER_VERSION` in the canonicalised evidence input (so a version bump naturally changes the hash).
3. **DG-7** — wire a pg-boss worker for the optimiser schedule that calls `runOptimiserScan` inside `withOrgTx`, OR delete `runOptimiserScan.ts` and document the LLM-loop-driven design (with separate snapshots per scan) as the official orchestration. The current state is half-finished.
4. **DG-8** — one-line fix in the backfill script (combine the `.where(...)` calls).
5. **DG-5** — replace the hidden probe with `useAgentRecommendationsTotal()`.
6. **DG-3** — patch the 8 `actionHints` URLs to match spec §6.5.
7. **DG-4** — either (a) add `timezone` column to `subaccounts` and pass it through, or (b) accept UTC and update the spec/plan to match.
8. **DG-6** — schedule the CI cost gate (or run it locally on a representative fixture).

After addressing the items, re-run `spec-conformance` to confirm CONFORMANT_AFTER_FIXES, then proceed to `pr-reviewer` and the rest of the review pipeline.
