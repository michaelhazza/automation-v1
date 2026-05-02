# Spec Conformance Log

**Spec:** `docs/sub-account-optimiser-spec.md`
**Spec commit at check:** `173a4b47` (main branch HEAD)
**Branch:** `claude/subaccount-optimiser`
**Worktree:** `c:/files/Claude/automation-v1.subaccount-optimiser`
**Branch HEAD:** `1ba02c3b`
**Base (merge-base with main):** `6d6c6ff48174b5913a1132c8cd41b93babb30c6d`
**Scope:** all-of-spec (caller confirmed all 5 chunks complete; whole branch)
**Changed-code set:** ~50 files (primitive + queries + evaluators + orchestrator + skills + UI)
**Run at:** 2026-05-02T05:00:11Z

---

## Summary

- Requirements extracted:     54
- PASS:                       38
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 14
- AMBIGUOUS → deferred:       2
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (16 blocking gaps — see deferred items in `tasks/todo.md`)

The primitive (Chunk 1) is essentially CONFORMANT. The optimiser-specific evaluator triggers (Chunk 3) systematically diverge from the spec on **severity assignments and trigger thresholds for 4–6 of the 8 categories**. Additionally, the `runOptimiser` orchestrator function exists but appears to have no production callsite — the daily cron fires the standard agent-execution pipeline.

---

## Sections

- Requirements — Chunk 1 (primitive)
- Requirements — Chunk 2 (queries + view)
- Requirements — Chunk 3 (agent + scan skills + orchestrator)
- Requirements — Chunks 4 + 5 (dashboard + verification + doc sync)
- Mechanical fixes applied
- Directional / ambiguous gaps
- Files modified by this run
- Next step

---

## Requirements extracted (full checklist)

### Chunk 1 — Generic agent-output primitive

| # | Category | Spec section | Requirement | Verdict |
|---|----------|--------------|-------------|---------|
| 1 | migration | §6.1 / §9 Phase 0 | `migrations/0267_agent_recommendations.sql` exists with table + 4 indexes + RLS + `subaccounts.optimiser_enabled BOOLEAN NOT NULL DEFAULT true` | PASS |
| 2 | schema | §6.1 | `agent_recommendations` table has all named columns including `dismissed_until TIMESTAMPTZ` and the 4 spec-named indexes | PASS |
| 3 | schema | §6.1 | Drizzle schema in `server/db/schema/agentRecommendations.ts` mirrors migration | PASS |
| 4 | schema | §6.1 | `subaccounts.optimiser_enabled` column added to Drizzle schema (`subaccounts.ts:77`) | PASS |
| 5 | schema | §6.1 / §9 Phase 0 | RLS policies registered in `rlsProtectedTables.ts` | PASS — `server/config/rlsProtectedTables.ts:940` |
| 6 | schema | §9 Phase 0 | Canonical-dictionary registry entry | PASS — `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts:626` |
| 7 | contract | §6.5 | `shared/types/agentRecommendations.ts` exports discriminated-union evidence types per category | PASS |
| 8 | contract | §2 | `materialDelta` registry of 8 per-category predicates | PASS |
| 9 | contract | §6.2 | `evidenceHash` + `canonicaliseEvidence` (RFC 8785, sorted keys + arrays, NFC strings, integer detection, `@preserveOrder` annotation handling) | PASS — implementation matches all 8 canonical-JSON rules |
| 10 | export | §2 / §6.2 | `server/services/optimiser/renderVersion.ts` exports `RENDER_VERSION` integer constant with bump policy comment | PASS |
| 11 | skill | §5 / §6.2 | `server/skills/output/recommend.md` exists with input contract + decision flow + rules | PASS |
| 12 | export | §6.2 | `output.recommend` handler in `server/services/skillExecutor.ts` validates scope_type, severity, three-segment category format, namespace prefix against `agentNamespace`, action_hint pattern, requires `agentId` context | PASS — `skillExecutor.ts:1956–2056` |
| 13 | service | §6.2 | `upsertRecommendation` in `agentRecommendationsService.ts` runs cooldown check → open-match (FOR UPDATE) → cap check → eviction inside `pg_advisory_xact_lock(hashtext(scope_type:scope_id:agentId))` | PASS |
| 14 | behavior | §6.2 | Severity-escalation bypass on cooldown (skip cooldown if new severity_rank > matched_row.severity_rank) | PASS — `agentRecommendationsService.ts:124–157` |
| 15 | behavior | §6.2 | `updated_in_place` path clears `acknowledged_at` to NULL | PASS — `agentRecommendationsService.ts:228` |
| 16 | behavior | §6.2 | `sub_threshold` no-op when `materialDelta` returns FALSE | PASS — `agentRecommendationsService.ts:204–216` |
| 17 | behavior | §6.2 | Eviction sets `dismissed_until = now() + interval '6 hours'` and `dismissed_reason='evicted_by_higher_priority'` | PASS — `agentRecommendationsService.ts:359–367` |
| 18 | behavior | §6.2 | Cap drop emits `recommendations.dropped_due_to_cap` log line | PASS |
| 19 | behavior | §6.2 | Eviction emits `recommendations.evicted_lower_priority` log line | PASS |
| 20 | behavior | §6.2 | `producing_agent_id` is derived from execution context, NOT from caller input | PASS |
| 21 | behavior | §6.2 | Eviction priority comparator: severity asc → updated_at asc → category desc → dedupe_key desc (stalest+lowest-priority evicted first) | PASS — `agentRecommendationsService.ts:306–311`, `agentRecommendationsServicePure.ts:34–42` |
| 22 | behavior | §6.2 | Postgres 23505 unique violation caught and mapped to `was_new=false` (no `reason`) | PASS — `agentRecommendationsService.ts:417–432` |
| 23 | route | §6.5 | `GET /api/recommendations` with `scopeType`, `scopeId`, `includeDescendantSubaccounts`, `limit` query params; default `limit=20`; cap at 100; sort severity desc → updated_at desc; filters out acknowledged/dismissed; 422 on bad scope; populates `subaccount_display_name` for org-rollup rows | PASS — `routes/agentRecommendations.ts:27–62`, `agentRecommendationsService.ts:513–626` |
| 24 | route | §6.5 | `POST /api/recommendations/:recId/acknowledge` — body `{}`; idempotent; `{ success, alreadyAcknowledged }` response; 404 on absent/RLS-hidden | PASS (response includes additional `scope_type`/`scope_id` fields beyond spec) |
| 25 | route | §6.5 | `POST /api/recommendations/:recId/dismiss` — body `{ reason, cooldown_hours? }`; idempotent; per-severity cooldown defaults (24h/168h/336h); admin override clamps to [1, 24*90]; CTE pattern (existed/updated_rows) | PASS — `routes/agentRecommendations.ts:94–133`, `agentRecommendationsService.ts:693–770` |
| 26 | behavior | §6.5 | Both routes auth-gated (`authenticate`); RLS does org isolation | PASS |
| 27 | behavior | §6.5 | Both routes emit `dashboard.recommendations.changed` socket event with full payload `{recommendation_id, scope_type, scope_id, change}` | PASS |
| 28 | behavior | §6.5 | Insert/update paths in `output.recommend` emit `dashboard.recommendations.changed` with `change: 'created' \| 'updated'` | PASS |
| 29 | export | §6.3 | `client/src/components/recommendations/AgentRecommendationsList.tsx` with `scope`, `includeDescendantSubaccounts`, `mode`, `limit`, `emptyState`, `collapsedDistinctScopeId`, `onTotalChange`, `onExpandRequest`, `onDismiss` props | PASS — also adds `onLatestUpdatedAtChange` (extra) |
| 30 | behavior | §6.3 | Default `collapsedDistinctScopeId` = (scope.type='org' AND includeDescendantSubaccounts=true AND mode='collapsed') | PASS |
| 31 | behavior | §6.3 | Sort: severity desc → updated_at desc; org-rollup dedupe by scope_id keeps highest priority | PASS — `AgentRecommendationsListPure.ts` |
| 32 | behavior | §6.3 | Org-rollup row label: `<subaccount_display_name> · <title>` only when scope=org AND includeDescendantSubaccounts=true | PASS — `AgentRecommendationsList.tsx:156–160` |
| 33 | behavior | §6.5 | "Help me fix this →" fires fire-and-forget acknowledge + 250ms click-feedback beat ("Marked as resolved" + 50% opacity) before navigation | PASS — `AgentRecommendationsList.tsx:95–121, 161–179` |
| 34 | behavior | §6.3 | Section disappears when zero open recs (default `emptyState='hide'`) | PASS |
| 35 | export | §6.5 | `client/src/hooks/useAgentRecommendations.ts` fetches by scope, subscribes to `dashboard.recommendations.changed` with 250ms trailing-window debounce | PASS |
| 36 | route mount | §10 | `agentRecommendationsRouter` mounted in `server/index.ts` | PASS — `index.ts:177, 389` |

### Chunk 2 — Telemetry queries + peer-median view

| # | Category | Spec section | Requirement | Verdict |
|---|----------|--------------|-------------|---------|
| 37 | migration | §3 / §9 Phase 1 | `migrations/0267a_optimiser_peer_medians.sql` defines `optimiser_skill_peer_medians` materialised view over `agent_execution_events` filtered to `event_type='skill.completed'`, computing p50/p95/p99 per `skill_slug` keyed by JSONB payload `skillSlug` + `durationMs`, with HAVING count(distinct subaccount_id) >= 5 | PASS |
| 38 | behavior | §3 | Minimum-tenant threshold (5) enforced inside view definition (HAVING), not just app logic | PASS |
| 39 | export | §9 Phase 1 / §10 | 8 query modules under `server/services/optimiser/queries/`: `agentBudget.ts`, `escalationRate.ts`, `skillLatency.ts`, `inactiveWorkflows.ts`, `escalationPhrases.ts`, `memoryCitation.ts`, `routingUncertainty.ts`, `cacheEfficiency.ts` | PASS |
| 40 | behavior | §9 Phase 1 | Each query module includes a 7-day window via `WHERE … >= now() - INTERVAL '7 days'` | PASS — confirmed in all 8 modules |
| 41 | behavior | §3 | `skillLatency.ts` reads via `withAdminConnection` (sysadmin-bypassed RLS) and emits a staleness-guard log line `recommendations.scan_skipped.peer_view_stale` if peer view metadata is older than 24h | PASS — `skillLatency.ts:46–76` |
| 42 | export | §9 Phase 1 / §10 | `server/jobs/refreshOptimiserPeerMedians.ts` registered for nightly refresh; uses raw `pg.client` outside transaction (REFRESH MATERIALIZED VIEW CONCURRENTLY rule) | PASS |
| 43 | export | §3 | `optimiser_view_metadata` sentinel table written by refresh job, read by `skillLatency.ts` | PASS |
| 44 | export | §9 Phase 1 | `tokenisePhrase` + `countNGrams` + `extractFrequentPhrases` exposed as pure helpers in `escalationPhrases.ts`; uses lowercase + strip-punctuation + suffix-stem (`-ing`/`-ed`/`-s`) + stopword filter | PASS |
| 45 | infra | §9 Phase 1 | Composite indexes added on source tables: `agent_runs(organisation_id, started_at)`, `agent_execution_events(run_id, event_timestamp)`, `cost_aggregates(entity_id, updated_at)`, `memory_citation_scores(run_id, created_at)`, `fast_path_decisions(subaccount_id, decided_at)`, `llm_requests(run_id, created_at)` | PASS — added in 0267a migration |

### Chunk 3 — Optimiser agent + scan skills + orchestrator

| # | Category | Spec section | Requirement | Verdict |
|---|----------|--------------|-------------|---------|
| 46 | export | §4 / §10 | `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` with role=`subaccount-optimiser`, namespace=`optimiser`, scope=`subaccount`, default-on, all 8 scan skills + `output.recommend` in skill manifest | PASS |
| 47 | export | §5 / §10 | 8 scan skill markdowns under `server/skills/optimiser/` | PASS |
| 48 | export | §10 | 8 evaluator modules under `server/services/optimiser/recommendations/` | PASS |
| 49 | behavior | §2 | Evaluator triggers and severities match the spec table for all 8 categories | **DIRECTIONAL_GAP** (see #B1, #B2, #B3, #B4, #B5, #B6 below) |
| 50 | behavior | §6.2 / §9 Phase 2 | `agentScheduleService.registerSchedule` extended to accept `singletonKey` (pg-boss singleton enforcement) | PASS — `agentScheduleService.ts:251–278` |
| 51 | behavior | §9 Phase 2 | Backfill script `scripts/backfill-optimiser-schedules.ts` idempotent INSERT…ON CONFLICT DO NOTHING + computes per-subaccount cron via `computeOptimiserCron` (deterministic stagger 06:00–11:59) | PASS |
| 52 | behavior | §4 / §9 Phase 2 | New-subaccount hook `optimiserSubaccountHook.ts:registerOptimiserForSubaccount` creates link + registers schedule for new sub-accounts when `optimiser_enabled=true`; respects `OPTIMISER_DISABLED` kill switch; non-blocking | PASS |
| 53 | behavior | §6.2 / §13 | Run-level atomicity invariant: pre-sort by priority + sequential output.recommend calls + per-subaccount singleton key | **DIRECTIONAL_GAP** (#B7 — `runOptimiser` orchestrator implements all three but appears not to be wired to the production schedule path) |

### Chunks 4 + 5 — Home dashboard wiring + verification + doc sync

| # | Category | Spec section | Requirement | Verdict |
|---|----------|--------------|-------------|---------|
| 54 | export | §7 | New section `"A few things to look at"` in `DashboardPage.tsx` between "Pending your approval" and (existing layout). Reads `activeClientId` via `getActiveClientId()`. Org context → `scope={type:'org'} includeDescendantSubaccounts={true}`. Sub-account context → `scope={type:'subaccount'}`. Hidden when zero open recs. "See all N →" expands inline. Uses `formatRelativeTime(latestUpdatedAt)` for sub-header. | PASS — `DashboardPage.tsx:1–96, 434–465`, `dashboardPageScopePure.ts` |
| 55 | docs | §9 Phase 4 | `docs/capabilities.md` updated to describe optimiser + recommendations primitive | PASS — `docs/capabilities.md:411–422` |
| 56 | docs | §9 Phase 4 | `architecture.md` documents cross-tenant median view + `agent_recommendations` primitive | PASS — `architecture.md:3214–3217` |
| 57 | docs | §9 Phase 4 | `tasks/builds/subaccount-optimiser/progress.md` closeout entry | AMBIGUOUS — see #B16 |

---

## Mechanical fixes applied

(none — all gaps require human design judgment to resolve)

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

### #B1 — `playbook.escalation_rate` severity mismatch
- **Spec:** §2 line 109 — severity=`critical` (and trigger window "14 days")
- **Implementation:** `recommendations/playbookEscalation.ts:39` — severity=`warn`; query window 7 days (`escalationRate.ts:46`)
- **Why DIRECTIONAL:** severity assignment may be intentional (operator floods), but the spec explicitly names `critical`. The window discrepancy (7d vs 14d) compounds the gap. Resolving requires confirmation that "warn at 7-day window" is the desired behavior, OR a flip to `critical` at 14-day window.

### #B2 — `inactive.workflow` severity mismatch
- **Spec:** §2 line 111 — severity=`warn`
- **Implementation:** `recommendations/inactiveWorkflow.ts:24` — severity=`info`

### #B3 — `escalation.repeat_phrase` severity mismatch
- **Spec:** §2 line 112 — severity=`info`
- **Implementation:** `recommendations/repeatPhrase.ts:116` — severity=`warn`

### #B4 — `memory.low_citation_waste` severity mismatch + trigger drift
- **Spec:** §2 line 118 — severity=`warn`, trigger ">50% of injected memory entries scored <0.3 in `memory_citation_scores` over 7 days"
- **Implementation:** `recommendations/memoryCitation.ts:13–46` + `queries/memoryCitation.ts:48` — severity=`info`, threshold=`>40%`, uses `mcs.cited = false` flag instead of comparing `final_score < 0.3` directly
- **Why DIRECTIONAL:** "cited=false" may be the schema's encoding of "scored below threshold" — requires schema check. Threshold 40% vs spec 50% is an evaluator-level change.

### #B5 — `agent.routing_uncertainty` trigger semantics rewritten
- **Spec:** §2 line 119 — "Fast-path confidence < 0.5 on > 30% of decisions, OR `secondLookTriggered` rate > 30%, sustained 7 days"
- **Implementation:** `queries/routingUncertainty.ts:26` uses `LOW_CONFIDENCE_THRESHOLD = 0.7` (spec says 0.5); `recommendations/routingUncertainty.ts:20–37` uses `low_confidence_pct > 0.30 AND total_decisions >= 50` — the OR with `second_look_pct > 0.30` is missing, and `total_decisions >= 50` is an evaluator-level gate the spec does not specify (the spec's volume floor of 10 is in `materialDelta`, not the trigger)
- **Why DIRECTIONAL:** three independent divergences (threshold, OR-gate, volume-floor) compound — the spec's stated rule is broader than the implementation's.

### #B6 — `llm.cache_poor_reuse` trigger semantics rewritten
- **Spec:** §2 line 120 — "`cacheCreationTokens` > sum of `cachedPromptTokens` over 7 days for any agent (cache costs more than it saves) AND `cacheCreationTokens + cachedPromptTokens >= 5000` over the same window"
- **Implementation:** `recommendations/cacheEfficiency.ts:29–32` — `reused / (creation+reused) < 0.20`. NO volume floor of 5000 anywhere in the evaluator or query.
- **Why DIRECTIONAL:** the implementation's "20% reuse" floor is a different signal from the spec's "creation > reused" floor. The missing 5000-token volume floor means low-volume agents will trigger noisy recommendations.

### #B7 — `runOptimiser` orchestrator not wired to production schedule path
- **Spec:** §6.2 Run-level atomicity — pre-sort by priority + sequential `output.recommend` calls + singleton key
- **Implementation:** `optimiserOrchestrator.ts:runOptimiser` implements all three properties, BUT `grep` finds no production callsite — only tests reference it. The pg-boss schedule registered by `optimiserSubaccountHook.ts` and the backfill points at `AGENT_RUN_QUEUE`, which routes through the standard `agentExecutionService.runAgent` LLM-driven loop reading `AGENTS.md` — that path lets the LLM call scan skills and `output.recommend` in any order it chooses, with no enforced pre-sort.
- **Why DIRECTIONAL:** The atomicity invariant claim in §6.2 is currently unenforced for production runs. **This is the largest single conformance gap.**

### #B8 — Optimiser cron time window does not match spec "sub-account local 06:00"
- **Spec:** §4 — "daily at sub-account local 06:00 (cron derived from sub-account's `timezone`)"
- **Implementation:** `optimiserCronPure.ts:30–35` produces a cron in the `06:00-11:59 UTC` window deterministically per sub-account; the schedule registers the hook with `'UTC'` as the timezone (`optimiserSubaccountHook.ts:131`). The sub-account's `timezone` field is NOT read.
- **Why DIRECTIONAL:** The deterministic stagger window (06:00–11:59 UTC) was added to mitigate the schedule-storm risk in spec §13, but the spec's §4 says "sub-account local 06:00 (cron derived from sub-account's `timezone`)". Resolution requires pinning whether sub-account-local-time-with-stagger is acceptable as a refinement of the spec.

### #B9 — `inactive.workflow` heartbeat-vs-cron path not separated per spec
- **Spec:** §2 line 111 / §3 line 174 / §5 line 222 — "Sub-account agent with `subaccountAgents.scheduleEnabled = true AND scheduleCron IS NOT NULL` whose most recent `agent_runs.startedAt` is older than 1.5× the expected cadence"
- **Implementation:** `queries/inactiveWorkflows.ts:104–108` — ORs the cron-path with `sa.heartbeat_enabled = true`, broadening the scope. Grace buffer is 1.25× (`*0.25` on top of one cadence = 1.25× total), spec says 1.5×.
- **Why DIRECTIONAL:** the implementation broadens the spec's stated trigger AND tightens the cadence threshold to 1.25× — both changes go in opposite directions of the spec.

### #B10 — Acknowledge route response shape extra fields
- **Spec:** §6.5 — `POST /api/recommendations/:recId/acknowledge` returns `{ success: true, alreadyAcknowledged: boolean }`
- **Implementation:** `agentRecommendationsService.ts:629–675` returns `{ success, alreadyAcknowledged, scope_type, scope_id }` (used to drive the socket emitter on the route layer)
- **Why DIRECTIONAL:** Adding fields to a response is non-breaking, but the spec is the contract surface. Either pin the spec to allow the additional fields or strip them from the response.

### #B11 — Cooldown check uses `dismissed_at IS NOT NULL` filter (correct), but does not apply RLS-scoped lookup explicitly
- **Spec:** §6.2 Step 1 cooldown check — query SHALL be RLS-bound to the producing agent's organisation
- **Implementation:** `agentRecommendationsService.ts:111–123` — no explicit `organisation_id = ?` predicate; relies on connection-level `app.organisation_id` setting from RLS. Service uses `db.transaction()` directly (not `withOrgTx`).
- **Why AMBIGUOUS:** It's possible the calling context already sets `app.organisation_id` so RLS handles isolation. Verification requires running the test against a multi-org fixture.

### #B12 — `listRecommendations` uses `sql.raw` with string interpolation
- **Spec:** §6.5 — Read endpoint must filter by `organisation_id`
- **Implementation:** `agentRecommendationsService.ts:530–544, 575–598` — uses `sql.raw(...)` with `${orgId}` interpolated into the SQL string; UUID format is validated for `scopeId` but not for `orgId` (which comes from `req.orgId`, server-side).
- **Why DIRECTIONAL:** server-derived `orgId` is safe in practice. But the convention in this repo (`asyncHandler` + drizzle parameterised queries) prefers typed `sql\`…\`` interpolation. The choice was likely made to handle the dynamic IN-clause for descendant subaccounts; resolution: refactor to drizzle composable conditions, OR document the safety predicate inline.

### #B13 — Implicit acknowledge on dismiss path is not bypassed when row is already dismissed
- **Spec:** §6.5 — "Idempotent on the dismiss path; the second call's `reason` and `cooldown_hours` are ignored."
- **Implementation:** `agentRecommendationsService.ts:725–733` — returns `alreadyDismissed: true` correctly. The response uses `target.dismissed_until ?? new Date().toISOString()` as a fallback when the field is null, which can never happen in practice.
- **Why AMBIGUOUS:** behaviour is correct; the fallback is defensive but could mask data corruption. Logging a warning if `dismissed_until IS NULL on already-dismissed row` would catch upstream bugs.

### #B14 — Migration 0267 RLS policy uses USING + WITH CHECK on the same predicate; no separate INSERT/UPDATE/DELETE policies
- **Spec:** §6.1 / §10 — "Plus RLS policies (per `0245_all_tenant_tables_rls.sql` pattern)"
- **Implementation:** `migrations/0267_agent_recommendations.sql:55–66` — single policy with `USING(...)` + `WITH CHECK(...)`, both predicates check `app.organisation_id`. This matches the simplest variant of the 0245 pattern.
- **Why AMBIGUOUS:** the 0245 reference pattern wasn't read (out of scope for this audit). If the convention is multiple policies (SELECT/INSERT/UPDATE/DELETE separately), this is a divergence. If one policy is the standard, PASS.

### #B15 — `onTotalChange` of `<AgentRecommendationsList>` reports `total` post-RLS but pre-dedupe (spec §6.3) — verified PASS via hook
- The hook (`useAgentRecommendations.ts:79–87`) reports `res.data.total` directly from the GET endpoint, which is the unclamped post-RLS count (`agentRecommendationsService.ts:600–605`). The component's `onTotalChange(total)` fires that value through. This matches the spec contract.
- Listed here as a verification trace, not a gap. PASS.

### #B16 — Stale `progress.md` in main worktree
- **Spec:** §9 Phase 4 / §11 — closeout artifact lists progress.md as a deliverable
- **Implementation:** Worktree at `c:/files/Claude/automation-v1.subaccount-optimiser/tasks/builds/subaccount-optimiser/progress.md` is `Status: COMPLETE` with full closeout. Main tree at `c:/files/Claude/automation-v1-2nd/tasks/builds/subaccount-optimiser/progress.md` is `Status: IN PROGRESS — Phase 1 complete, Phases 2–6 pending`.
- **Why AMBIGUOUS:** the main tree progress.md is on a separate branch (the user's current working tree shows `M tasks/builds/subaccount-optimiser/progress.md`). Resolution depends on whether the merge to `main` will sync the worktree's progress.md. Routing to `tasks/todo.md` so it's not silently lost.

---

## Files modified by this run

(none — read-only verification)

---

## Next step

**NON_CONFORMANT** — 16 findings (14 directional + 2 ambiguous, all routed to `tasks/todo.md`) must be addressed by the main session before `pr-reviewer`.

The most material gaps are:
1. **Severity & trigger drift on 4–6 of the 8 evaluator modules** (#B1, #B2, #B3, #B4, #B5, #B6). These are operator-visible: which findings escalate to which dashboard severity. The implementation systematically produces *different* findings than the spec defines.
2. **`runOptimiser` orchestrator not wired to the production schedule path** (#B7). The atomicity invariant claimed in §6.2 — pre-sort + sequential calls — is not enforced when the LLM agent runs through the standard agent-execution pipeline.
3. **Cron timezone semantics** (#B8). Spec says sub-account local 06:00; implementation runs at UTC 06:00–11:59.
4. **`inactive.workflow` scope drift** (#B9). Implementation broadens the spec's stated trigger AND tightens the cadence threshold.

The Chunk 1 primitive (table, indexes, RLS, `output.recommend` decision flow, advisory lock, materialDelta, render-cache key, evidence-hash canonicalisation, acknowledge/dismiss CTE pattern) is conformant and well-implemented. The conformance issues are concentrated in Chunk 3 (evaluator triggers + orchestrator wiring).

After the main session resolves the directional gaps, re-run `spec-conformance` to confirm closure, then proceed to `pr-reviewer` on the expanded changed-code set.
