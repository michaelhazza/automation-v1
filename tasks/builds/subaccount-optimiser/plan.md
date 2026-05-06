# Sub-Account Optimiser Meta-Agent (F2) — Implementation Plan

**Spec (authoritative):** `docs/sub-account-optimiser-spec.md` (v2 READY_FOR_BUILD, finalisation commit `173a4b47`)
**Build slug:** `subaccount-optimiser`
**Branch:** `claude/subaccount-optimiser`
**Worktree:** `../automation-v1.subaccount-optimiser`
**Migrations claimed:** `0267` (table + RLS + opt-out column), `0267a` (peer-median materialised view)
**Concurrent peers:** F1 `subaccount-artefacts` (0266), F3 `baseline-capture` (0268-0270)
**Total estimate:** ~25 hours across 5 active chunks (Phase 5 in progress.md is folded into Chunk 2 per spec §9)

This plan decomposes the spec into builder-session-sized chunks. The spec is the single source of truth — when this plan and the spec disagree, the spec wins. Where the plan goes beyond the spec, that extension is called out inline.

---

## Sections

- Executor notes (read first)
- Model-collapse check
- Generic-primitive vs first-consumer separation
- Architecture notes
- Chunk inventory + dependency graph
- Chunk 1 — Phase 1 — Generic agent-output primitive
- Chunk 2 — Phase 2 — Telemetry rollup queries + cross-tenant median view
- Chunk 3 — Phase 3 — Optimiser agent definition + scan skills
- Chunk 4 — Phase 4 — Home dashboard wiring
- Chunk 5 — Phase 6 — Verification + doc sync
- Risks + mitigations
- Cross-feature degradation paths
- Open architectural questions for the operator
- Plan-time concerns

---

## Executor notes

Read these before starting any chunk.

1. **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
2. The spec at `docs/sub-account-optimiser-spec.md` is authoritative. If this plan and the spec disagree on a contract, the spec wins — open a "Plan-time concerns" item rather than diverging.
3. Mark each Phase complete in `tasks/builds/subaccount-optimiser/progress.md` as you finish a chunk. Never skip ahead. Update the Decisions log inline.
4. Stay strictly within the F2 column of `tasks/builds/concurrent-build-plan.md § 3 File-collision matrix`. F2 owns: `server/services/skillExecutor.ts` (new switch cases), `server/services/agentScheduleService.ts` (registers optimiser schedule), `client/src/components/Sidebar.tsx` (rec-count badge), and an additive new section in `client/src/pages/DashboardPage.tsx` and an additive `<RecommendationsCard>` on `client/src/pages/SubaccountDetailPage.tsx`. F2 does NOT touch any file F1 owns exclusively.
5. The review pipeline at the end is `spec-conformance` → `pr-reviewer`. `dual-reviewer` and `adversarial-reviewer` are optional and only on explicit user request.
6. Per CLAUDE.md user preferences: no emojis, no em-dashes in UI copy, no auto-commits or auto-pushes from the main session. Only the listed review agents auto-commit within their own flows.
7. Run targeted unit tests with `npx vitest run <path>` (per DEVELOPMENT_GUIDELINES §7). Do NOT use `npx tsx` for Vitest tests.

---

## Model-collapse check

The optimiser's surface logic is conceptually `telemetry → analyse → recommend`, which is the canonical shape that frontier multimodal models can collapse into a single structured-output call. Per the architect playbook the question must be asked explicitly: would a single LLM call given the day's telemetry produce the recommendation set?

**Decision: REJECT collapse. Keep the multi-skill pipeline (8 SQL scan skills + per-category evaluator modules + per-recommendation render call).**

Reasons (in priority order):

1. **Cost determinism.** Per spec §8 the steady-state cost is `< $0.30 / sub-account / month` because hard-coded SQL scans cost zero LLM tokens and the only LLM spend is per-recommendation render copy that hits the `(category, dedupe_key, evidence_hash, render_version)` cache. A daily LLM-driven discovery pass over telemetry would consume thousands of tokens per sub-account per day — at 100 sub-accounts that puts F2 in `$30+/day` territory before any value justifies it. The cost model in §8 is load-bearing for "default-on for every sub-account".
2. **Deterministic threshold evaluation.** The 8 categories are pinned to specific thresholds (e.g. `> 1.3× budget for 2 consecutive months`, `> 60% escalation rate over 14 days`). Per-category `materialDelta(prev, next)` predicates in `shared/types/agentRecommendations.ts` are PURE functions — no I/O, no clock reads — and are the gate that prevents day-to-day fluctuation from re-clearing `acknowledged_at`. An LLM cannot deliver pure-function determinism; the same evidence must produce the same finding across runs. Spec §6.2 "Idempotency posture" depends on this.
3. **Audit trail.** Every recommendation's evidence is JSONB with stable per-category shapes (spec §6.5). Operators clicking "Help me fix this →" deep-link into the Configuration Assistant with named focus parameters (`?focus=budget`, `?focus=memory-cleanup`, etc., spec §6.5 action_hint table). An LLM-collapsed pipeline produces narrative reasoning, not structured `evidence` rows that downstream UI and Configuration Assistant routes can parse.
4. **Scheduled-run cadence.** Daily-at-06:00-local execution per sub-account through pg-boss (spec §4) is a small, predictable workload. The pure-SQL-then-render shape lets a single optimiser run finish in seconds with bounded LLM tokens. A model-collapsed pipeline is harder to schedule under the spec's 1-at-a-time `singletonKey` requirement (spec §6.2 "Run-level atomicity invariant") because the per-call latency is much higher and the chance of overlap with the next day's fire grows.
5. **Generic-primitive reuse.** The whole point of the design (spec §0.1, §6) is that `output.recommend` + `agent_recommendations` + `<AgentRecommendationsList>` are reusable infrastructure any agent can write to with deterministic structured rows. A collapsed monolith inside the optimiser does not produce that primitive at all. Building the primitive is half the value of F2.

The render step IS an LLM call — but it is intentionally the smallest possible LLM surface (one Sonnet call per new-or-materially-changed recommendation, ~200 tokens, cached by `(category, dedupe_key, evidence_hash, render_version)`). That is the right place to use the model.

---

## Generic-primitive vs first-consumer separation

The spec's central architectural decision (§0.1, §6) is that this build ships TWO products:

1. **The generic `agent_recommendations` primitive** — a new table, a new generic skill `output.recommend`, a new component `<AgentRecommendationsList>`, a new hook `useAgentRecommendations`, and the read/acknowledge/dismiss HTTP routes. Any agent in the system can write to this surface.
2. **The optimiser as the first consumer** — the `subaccount-optimiser` agent definition, the 8 scan skills, the 8 query modules, the 8 evaluator modules, the materialised peer-median view, and the schedule registration.

The chunk boundaries below make this separation visible:

- **Chunks 1 and 4 ship and exercise the primitive.** A future agent (Portfolio Health writing org-tier recommendations, system-monitoring writing operational findings, a custom user agent) reuses `output.recommend` and `<AgentRecommendationsList>` without touching any optimiser code.
- **Chunks 2 and 3 are optimiser-specific.** They consume the primitive but live in `server/services/optimiser/**` and `companies/automation-os/agents/subaccount-optimiser/**`. None of their code is referenced from the primitive.

Concretely, after Chunk 1 lands, the system can already accept calls to `output.recommend` from any agent and render them in the dashboard surface (Chunk 4 wires the rendering into `DashboardPage.tsx`, but the component itself is delivered in Chunk 1). Chunks 2–3 add the first agent that takes advantage of it.

Chunk 4 wires the primitive's component into `DashboardPage.tsx`. The primitive itself (component, hook, routes) is feature-complete after Chunk 1 — Chunk 4 is dashboard-page-specific glue, not primitive work.

---

## Architecture notes

Key decisions made in the spec that this plan honours rather than re-deciding:

1. **`output.recommend` decision flow uses an advisory lock + `FOR UPDATE` row lock** (spec §6.2). This pattern is canonical in the codebase: see `server/tools/capabilities/requestFeatureHandler.ts` line 104 (`SELECT pg_advisory_xact_lock(${lockId})`) — the `feature_requests` skill uses the same shape. We are reusing this pattern, not inventing. **Lock granularity is `(scope_type, scope_id, producing_agent_id)`, NOT `(scope, agent, category, dedupe_key)`.** This is critical: the cap of 10 open recommendations is scoped per-(scope, producing-agent), so the cap re-check + eviction + insert sequence must be serialised across ALL categories from the same writer to that scope. Per-(category, dedupe_key) lock granularity would let two concurrent candidates from different categories both observe cap=10, both evict different rows, and both insert — exceeding the cap. The lockId is computed as `hashtext(scope_type || ':' || scope_id || ':' || producing_agent_id)::bigint` (or equivalent stable 63-bit hash); the per-(scope, agent) coarseness is intentional.
2. **Cross-tenant peer-median view is sysadmin-bypassed RLS, not added to `RLS_PROTECTED_TABLES`** (spec §3 "Access posture"). Reads through `server/lib/adminDbConnection.ts` `withAdminConnection()`. The view contains zero per-tenant rows (only aggregates above the 5-tenant minimum) so there is nothing to protect at the per-tenant level. The opt-out is documented inline per the §6 "Opt-out rule" of the spec-authoring checklist.
3. **`subaccount_agents` is the schedule surface, not a new schedule table** (spec §4). The optimiser is registered as a regular sub-account agent through `agentScheduleService.registerSchedule`. The pg-boss `singletonKey` requirement (spec §6.2 "Run-level atomicity invariant") IS new behaviour — Chunk 3 extends the schedule registration to pass it.
4. **Schema files import only from `drizzle-orm` and other schema files** (DEVELOPMENT_GUIDELINES §3). The new `agentRecommendations.ts` schema file references `shared/types/agentRecommendations.ts` for the `RecommendationEvidence` discriminated-union type. That file lives in `shared/` and is imported by both the schema and services — the cross-tier type lives in `shared/`, not in `server/services/**`.
5. **Routes call services only; services own DB access** (DEVELOPMENT_GUIDELINES §2). The new `server/routes/agentRecommendations.ts` does not import `db` directly — it calls `agentRecommendationsService` for reads, acknowledge, and dismiss. The `output.recommend` skill is only invoked from agent runs (via `skillExecutor`), never from a route handler. All three route handlers wrap in `asyncHandler`.
6. **`emitOrgUpdate('dashboard.recommendations.changed', …)` reuses the existing `dashboard.*` socket convention** (see `server/services/reviewService.ts:64`, `server/routes/reviewItems.ts:177`). No new emitter helper is needed; just call `emitOrgUpdate` from the new write paths.
7. **`shared/stateMachineGuards.ts` does not apply.** `agent_recommendations` is not a state-machine row in the §8.18 sense — its lifecycle is `open → (acknowledged | dismissed)` with no terminal-state aggregation. The two transitions are guarded by the CTE pattern in spec §6.5 (`WHERE acknowledged_at IS NULL` / `WHERE dismissed_at IS NULL`).
8. **No new feature flags.** Per `docs/spec-context.md` (`feature_flags: only_for_behaviour_modes`), the opt-out toggle is a simple boolean column `subaccounts.optimiser_enabled` (default true). Not a feature flag.
9. **No new test framework.** Per DEVELOPMENT_GUIDELINES §7, runtime unit tests use Vitest. All new test files use `*.test.ts` (and `*Pure.test.ts` for pure-helper tests with zero DB imports). RTL is NOT installed; client-side tests follow the existing extract-pure-logic pattern documented in KNOWLEDGE.md 2026-04-21 entry.

What was rejected:

- A bespoke `subaccount_recommendations` table — rejected at design review per §0.1 in favour of generic `agent_recommendations`.
- Extending `system_incidents` / `feature_requests` / `org_memories` to carry recommendations — rejected per spec §6.1 "Why not extend an existing primitive". Each carries a different lifecycle and audience.
- A `/suggestions` standalone page — deferred to v1.1 per spec §7.
- A widget-registry / layout-engine framework — explicitly resisted per spec §6.4.

---

## Chunk inventory + dependency graph

```
Chunk 1 (Phase 1) — Generic primitive
   ├── migration 0267 + agent_recommendations schema + RLS
   ├── output.recommend skill (decision flow + advisory lock)
   ├── shared/types/agentRecommendations.ts (evidence shapes + materialDelta)
   ├── server/services/agentRecommendationsService.ts
   ├── server/routes/agentRecommendations.ts (list / ack / dismiss)
   ├── client/src/components/recommendations/AgentRecommendationsList.tsx
   ├── client/src/hooks/useAgentRecommendations.ts
   └── socket emitter wiring (dashboard.recommendations.changed)
        |
        | (no other chunk can write recommendations until this lands)
        v
Chunk 2 (Phase 2) — Telemetry queries + peer-median view
   ├── 8 query modules under server/services/optimiser/queries/
   ├── escalationPhrases.ts tokeniser (folded from old Phase 5)
   ├── migration 0267a + peer-median materialised view
   ├── refresh_optimiser_peer_medians pg-boss job
   └── per-query unit tests (8 files)
        |
        | (depends on: nothing — can start in parallel with Chunk 1
        |  but its tests need the schema from Chunk 1 to be importable)
        v
Chunk 3 (Phase 3) — Optimiser agent + scan skills
   ├── companies/automation-os/agents/subaccount-optimiser/AGENTS.md
   ├── 8 scan skill markdown specs
   ├── 8 evaluator modules under server/services/optimiser/recommendations/
   ├── 8 SKILL_HANDLERS entries in skillExecutor.ts
   ├── render-step LLM call (cached)
   ├── agentScheduleService.ts — singletonKey + register-on-create hook
   ├── subaccountService.create hook for new sub-accounts
   └── scripts/backfill-optimiser-schedules.ts
        |
        | (depends on: Chunk 1 for output.recommend, Chunk 2 for queries)
        v
Chunk 4 (Phase 4) — Home dashboard wiring
   ├── new section in client/src/pages/DashboardPage.tsx
   ├── scope-aware via Layout.tsx activeClientId
   ├── Sidebar rec-count badge in client/src/components/Sidebar.tsx
   └── (optional) <RecommendationsCard> on SubaccountDetailPage.tsx
        |
        | (depends on: Chunk 1 for component + hook;
        |  optimiser data only appears after Chunk 3)
        v
Chunk 5 (Phase 6) — Verification + doc sync
   ├── lint, typecheck clean
   ├── targeted test runs (per-chunk, not the suite)
   ├── manual end-to-end run on test sub-account
   ├── cost-sanity sample (5 sub-accounts × 7 days)
   ├── docs/capabilities.md update (sub-account observability + primitive)
   ├── architecture.md update (cross-tenant view + reusable primitive)
   └── progress.md closeout
```

**Forward-only dependencies.** Chunk 2 can technically begin in parallel with Chunk 1 because its query modules don't import from the primitive's schema — but its tests assert against the schema definitions, so practically it should land after Chunk 1's schema commit. Chunk 3 strictly depends on Chunks 1 and 2. Chunk 4 strictly depends on Chunk 1 (the component and hook); the data populates only after Chunk 3. Chunk 5 depends on all four.

**Recommended ordering for a single-builder Sonnet session:** Chunk 1 → Chunk 2 → Chunk 3 → Chunk 4 → Chunk 5, in that order. Each chunk lands on the same branch with its own commit; no per-chunk PRs (one PR per feature branch per `8.9` of DEVELOPMENT_GUIDELINES).

---

## Chunk 1 — Phase 1 — Generic agent-output primitive (~6h)

**Scope.** Ship the reusable infrastructure: `agent_recommendations` table + RLS, `output.recommend` skill, evidence-shape contracts, the read/ack/dismiss HTTP routes, the React component, and the data hook. After this chunk lands, the primitive is usable by any agent — the optimiser is not yet built.

**Out of scope for this chunk.** No optimiser agent definition, no scan skills, no query modules, no `DashboardPage.tsx` wiring (that is Chunk 4's section insertion). The component exists in this chunk but is not yet rendered on any page.

### Files to create

- `migrations/0267_agent_recommendations.sql` — table, four indexes (per spec §6.1), RLS policies (per `0245_all_tenant_tables_rls.sql` pattern), AND `subaccounts.optimiser_enabled BOOLEAN NOT NULL DEFAULT true` ALTER. The migration combines all of these per spec §9 Phase 0 ("Not added as a separate migration because all are conceptually owned by the optimiser feature").
- `migrations/0267_agent_recommendations.down.sql` — DROP TABLE + DROP COLUMN.
- `server/db/schema/agentRecommendations.ts` — Drizzle schema for `agent_recommendations` including `dismissedUntil` column. Schema file imports only `drizzle-orm` and `shared/types/agentRecommendations.ts` (per DEVELOPMENT_GUIDELINES §3).
- `shared/types/agentRecommendations.ts` — discriminated-union `RecommendationEvidence` type per spec §6.5, plus the `materialDelta` registry per spec §2.
- `server/services/optimiser/renderVersion.ts` — exports `RENDER_VERSION = 1` integer constant. Bump policy documented in the file's top comment per spec §2 / §6.2.
- `server/services/agentRecommendationsService.ts` — service layer for the routes (acknowledge, dismiss, list) AND for the `output.recommend` skill handler's write path. Exports `upsertRecommendation(ctx, input)` which encapsulates the entire spec §6.2 decision flow (advisory lock + cooldown + open-match + cap + eviction + insert/update). The skill handler in `skillExecutor.ts` is a THIN wrapper: validates input shape, derives `producing_agent_id` from `ctx.agentId`, calls `upsertRecommendation`, returns the structured result. The service ALSO holds per-severity cooldown defaults, eviction priority comparator, drop-log helper. **No other code path writes to `agent_recommendations` directly.** Only the service exports a write entry point; the underlying `db.insert`/`db.update` calls are private to this module and not re-exported. A future agent that wants to emit recommendations MUST go through `output.recommend` (which calls `upsertRecommendation`); direct writes bypass the cap, cooldown, eviction, and observability invariants and are forbidden.
- `server/skills/output/recommend.md` — generic skill markdown spec.
- `server/routes/agentRecommendations.ts` — `GET /api/recommendations`, `POST /api/recommendations/:recId/acknowledge`, `POST /api/recommendations/:recId/dismiss`. All wrapped in `asyncHandler`.
- `client/src/components/recommendations/AgentRecommendationsList.tsx` — the React component per spec §6.3 with all listed props including `collapsedDistinctScopeId` and the click-feedback beat.
- `client/src/hooks/useAgentRecommendations.ts` — fetch + socket-subscribe hook. Subscribes to `dashboard.recommendations.changed` and refetches with the 250ms trailing-window debounce per spec §6.5 "Refetch debounce".
- `server/services/__tests__/agentRecommendationsServicePure.test.ts` — pure-helper tests for `materialDelta` predicates, eviction priority comparator, severity-rank computation. (Filename pattern is `*Pure.test.ts` because the helpers are pure — enforced by `verify-pure-helper-convention.sh` per DEVELOPMENT_GUIDELINES §7.)
- `server/services/__tests__/agentRecommendations.skillExecutor.test.ts` — full decision-flow integration tests for `output.recommend` (cooldown / open-match / cap / eviction paths). NOT a `*Pure.test.ts` — it touches the DB via the executor.
- `server/services/__tests__/agentRecommendations.singleWriter.test.ts` — static-analysis-style test that scans `server/**/*.ts` for `db.insert(agentRecommendations)` and `db.update(agentRecommendations)` patterns and asserts the only matches live in `server/services/agentRecommendationsService.ts`. Implementation uses Node's `fs.promises.readdir` + a regex over file contents (no actual DB calls). Fails the build if any other file writes directly. Pattern is borrowed from existing repo single-writer guards (e.g. `server/services/__tests__/canonicalDictionary.singleWriter.test.ts` if present, otherwise novel here).
- `server/services/__tests__/agentRecommendations.skipReasonCoverage.test.ts` — meta-test that exercises every skip / no-op branch in `output.recommend` (cooldown active / sub_threshold / hash_match / cap_reached / evicted_lower_priority) and asserts each one emits exactly one structured log line of the corresponding name. Spy on the structured logger; for each branch, assert the spy was called once with the expected log key. Prevents silent regression where a future refactor drops a log call.
- `server/routes/__tests__/agentRecommendations.routes.test.ts` — route-level tests for ack / dismiss idempotency and the 404 / 200 / 200-already-X matrix per spec §6.5 CTE.
- `client/src/components/recommendations/__tests__/AgentRecommendationsListPure.test.ts` — pure-logic tests for the `collapsedDistinctScopeId` dedupe + sort. Extract the dedupe-and-sort into `AgentRecommendationsListPure.ts` and test that file directly (matches the existing extract-pure-logic convention per KNOWLEDGE.md 2026-04-21 entry; RTL is not installed).
- `client/src/components/recommendations/AgentRecommendationsListPure.ts` — the extracted pure helpers.

### Files to modify

- `server/db/schema/index.ts` — re-export the new schema.
- `server/db/schema/subaccounts.ts` — add `optimiserEnabled` column declaration matching the migration's ALTER.
- `server/config/rlsProtectedTables.ts` — append the `agent_recommendations` entry pointing at `0267_agent_recommendations.sql`.
- `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` — append a `CanonicalTableEntry` for `agent_recommendations` per the existing pattern.
- `server/services/skillExecutor.ts` — add `'output.recommend'` entry to `SKILL_HANDLERS` (line ~430). The handler implements the full §6.2 decision flow inside an advisory-locked transaction. Per DEVELOPMENT_GUIDELINES §8.23, registration in `SKILL_HANDLERS` must accompany registration in `ACTION_REGISTRY` if applicable — `output.recommend` is a direct skill not a tool-call action, so check `server/config/actionRegistry.ts` for whether it needs an entry there too (it does NOT today; `read_workspace`, `web_search`, `search_tools` are not in the action registry either — they are direct skills with no proposeAction middleware involvement).
- `server/websocket/emitters.ts` — no new emitter helper required; the new write paths call the existing `emitOrgUpdate(orgId, 'dashboard.recommendations.changed', payload)` per the convention in `server/services/reviewService.ts:64`.
- `server/index.ts` — mount the new `agentRecommendations` router on `/api`.
- `tasks/builds/subaccount-optimiser/progress.md` — mark Phase 1 in progress at start, complete on finish; add Decisions log entries for any non-obvious choices.

### Contracts

**`agent_recommendations` row** (DB authoritative — spec §6.5).

```ts
// server/db/schema/agentRecommendations.ts
export const agentRecommendations = pgTable('agent_recommendations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  scopeType: text('scope_type').notNull().$type<'org' | 'subaccount'>(),
  scopeId: uuid('scope_id').notNull(),
  producingAgentId: uuid('producing_agent_id').notNull().references(() => agents.id),
  category: text('category').notNull(),
  severity: text('severity').notNull().$type<'info' | 'warn' | 'critical'>(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  evidence: jsonb('evidence').notNull().default({}),
  evidenceHash: text('evidence_hash').notNull().default(''),
  actionHint: text('action_hint'),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  dismissedReason: text('dismissed_reason'),
  dismissedUntil: timestamp('dismissed_until', { withTimezone: true }),
});
```

Indexes per spec §6.1 (the partial unique index on dedupe, the open-by-scope index, the dismissed-active-cooldown index, and the org rollup index). The partial unique on dedupe MUST `WHERE dismissed_at IS NULL` per the soft-delete-unique rule in DEVELOPMENT_GUIDELINES §3.

**RLS policy** (per `0245_all_tenant_tables_rls.sql` pattern, in the same migration):

```sql
ALTER TABLE agent_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_recommendations_org_isolation
  ON agent_recommendations
  USING (organisation_id::text = current_setting('app.organisation_id', true));
```

`scope_id` is an opaque UUID that is either the org id (when `scope_type='org'`) or a sub-account id (when `scope_type='subaccount'`). RLS isolates by `organisation_id` only — sub-account-level scoping is application-side. Per spec §6.5 the read endpoint relies on RLS to filter cross-org rows out of the descendant query; sub-account visibility is handled by the join to `subaccounts` (which has its own RLS).

**`RecommendationEvidence` discriminated union** (spec §6.5 — copy verbatim into `shared/types/agentRecommendations.ts`):

```ts
export type AgentOverBudgetEvidence = {
  agent_id: string;
  this_month: number;       // integer cents
  last_month: number;       // integer cents
  budget: number;           // integer cents
  top_cost_driver: string;
};
export type PlaybookEscalationRateEvidence = {
  workflow_id: string;
  run_count: number;        // integer
  escalation_count: number; // integer
  escalation_pct: number;   // ratio 0..1, 4 decimal places
  common_step_id: string;
};
// ... 6 more shapes per spec §6.5

export type RecommendationEvidence =
  | { category: 'agent.over_budget' } & AgentOverBudgetEvidence
  | { category: 'playbook.escalation_rate' } & PlaybookEscalationRateEvidence
  | { category: 'skill.slow' } & SkillSlowEvidence
  | { category: 'inactive.workflow' } & InactiveWorkflowEvidence
  | { category: 'escalation.repeat_phrase' } & EscalationRepeatPhraseEvidence
  | { category: 'memory.low_citation_waste' } & MemoryLowCitationWasteEvidence
  | { category: 'agent.routing_uncertainty' } & AgentRoutingUncertaintyEvidence
  | { category: 'llm.cache_poor_reuse' } & LlmCachePoorReuseEvidence;

export const materialDelta: Record<RecommendationEvidence['category'], (prev: any, next: any) => boolean> = {
  // per spec §2 Material-change thresholds — pure functions, no I/O, no clock reads
};

// Pre-hash canonicalisation per spec §6.2 "Numeric canonicalisation".
// Spec pins numeric stripping + ratio rounding + array sort. The plan PINS the remaining
// canonical-JSON rules so the hash is byte-stable across producers, hosts, and Node versions:
//
//   1. Object key ordering: keys sorted lexicographically (UTF-16 code-unit order via
//      Array.prototype.sort default), recursively at every nesting level.
//   2. undefined: dropped entirely (never serialised — JSON.stringify drops by default; the
//      canonicaliser MUST drop too, NOT serialise as null).
//   3. null: preserved as null (distinct from undefined; some evidence shapes like
//      `top_cost_driver: null` are semantically meaningful when no driver is identified).
//   4. Numbers: integers serialise without trailing `.0`; floats round to 4 dp via
//      `Number(n.toFixed(4))`; NaN / Infinity / -Infinity throw (no canonical representation
//      exists — evidence must not contain them).
//   5. Strings: NFC-normalised (Unicode canonical composition); leading/trailing whitespace
//      preserved (operators may include whitespace deliberately in phrase fields).
//   6. Booleans: serialised as JSON true / false; never coerced to 0 / 1.
//   7. Arrays: sorted ascending by JSON.stringify of each element (default-safe per spec §6.2);
//      `@preserveOrder` tag in the type-doc (when present) suppresses sort.
//   8. Date-shaped strings: NOT specially treated — evidence shapes do not carry timestamps.
//      If a future shape adds one, extend this function and bump RENDER_VERSION.
//
// The canonical string is then `JSON.stringify(normalisedTree)` (with the rules above applied
// before the call), and `evidenceHash` is the lowercase hex of `sha256(canonicalString)`.
export function canonicaliseEvidence(evidence: Record<string, unknown>): string;
export function evidenceHash(evidence: Record<string, unknown>): string;
```

**`output.recommend` input/output** (spec §6.2). Pinned in the spec — re-stated here for the executor implementation:

```ts
interface OutputRecommendInput {
  scope_type: 'org' | 'subaccount';
  scope_id: string;
  category: string;            // MUST match /^[a-z_]+\.[a-z_]+\.[a-z_]+/ AND start with the calling agent's namespace
  severity: 'info' | 'warn' | 'critical';
  title: string;               // operator-facing, plain English
  body: string;                // operator-facing, plain English
  evidence: Record<string, unknown>;
  action_hint?: string;
  dedupe_key: string;
}
interface OutputRecommendOutput {
  recommendation_id: string;   // empty string when reason='cap_reached'
  was_new: boolean;
  reason?: 'cap_reached' | 'cooldown' | 'updated_in_place' | 'sub_threshold' | 'evicted_lower_priority';
}
```

`producing_agent_id` is NOT part of the input — derived from `SkillExecutionContext.agentId` per spec §6.2 "`producing_agent_id` provenance". Non-agent invocations are rejected with `failure(FailureReason.InvalidInput, …)`.

**HTTP route shapes** (spec §6.5):

```
GET    /api/recommendations
       ?scopeType=org|subaccount&scopeId=<uuid>&includeDescendantSubaccounts=<bool>&limit=<int>
       → { rows: AgentRecommendationRow[], total: number }
       (limit default 20, cap 100)
       Special case: limit=0 → { rows: [], total: number }. The service short-circuits to a
       single SELECT COUNT(*) (with the same WHERE / RLS predicates as the row query) and
       skips fetching, ordering, and joining the row set entirely. The Sidebar badge uses this
       form; without the short-circuit a sidebar render of an org with hundreds of open recs
       would issue a 100-row SELECT just to discard the rows.

POST   /api/recommendations/:recId/acknowledge
       body: {}
       → { success: true, alreadyAcknowledged: boolean }

POST   /api/recommendations/:recId/dismiss
       body: { reason: string, cooldown_hours?: number }   // cooldown_hours admin-only
       → { success: true, alreadyDismissed: boolean, dismissed_until: string }
```

All three are auth-gated (`authenticate`); RLS handles org scoping. The CTE pattern in spec §6.5 distinguishes "row absent / RLS-hidden" (404) from "already in target state" (200 with `alreadyX: true`).

**`AgentRecommendationsList` props** (spec §6.3 — copy verbatim into the component):

```ts
type AgentRecommendationsListProps = {
  scope: { type: 'org'; orgId: string } | { type: 'subaccount'; subaccountId: string };
  includeDescendantSubaccounts?: boolean;       // default false
  mode?: 'collapsed' | 'expanded';              // default 'collapsed'
  limit?: number;                                // default 3, used only when collapsed
  emptyState?: 'hide' | 'show';                 // default 'hide'
  collapsedDistinctScopeId?: boolean;           // default true under the conditions in spec §6.3
  onTotalChange?: (total: number) => void;
  onLatestUpdatedAtChange?: (latest: Date | null) => void;  // max(updated_at) of currently displayed rows; null when empty
  onExpandRequest?: () => void;
  onDismiss?: (recId: string) => void;
};
```

**Socket event payload** (spec §6.5):

```ts
type DashboardRecommendationsChanged = {
  recommendation_id: string;
  scope_type: 'org' | 'subaccount';
  scope_id: string;
  change: 'created' | 'updated' | 'acknowledged' | 'dismissed';
};
```

Emitted via `emitOrgUpdate(orgId, 'dashboard.recommendations.changed', payload)` from the `output.recommend` handler (after `was_new=true` insert OR `reason='updated_in_place'` update) and from the ack/dismiss routes.

### Error handling

- `output.recommend` rejects with `failure(FailureReason.InvalidInput, …)` on:
  - Missing agent execution context (no `agentId` in `SkillExecutionContext`).
  - Category that fails the three-segment format check OR does not start with the agent's namespace prefix (per spec §6.2 "Category naming: hard rule").
  - `severity` not in `('info','warn','critical')`.
  - `scope_type` not in `('org','subaccount')`.
  - `scope_id` not a valid UUID.
  - `action_hint` present but malformed: must be either omitted/null OR a non-empty string matching `/^[a-z][a-z0-9-]*:\/\/[^\s]+$/` (scheme + `://` + non-empty path with no whitespace). The validator is shape-only — it does NOT maintain an allowlist of known schemes (`configuration-assistant://`, future `playbook-editor://`, etc.) because the spec does not pin one and any allowlist would brittle-break new producers. The shape check is enough to catch typos like `configuration-assistant:/<missing-slash>` or accidental newlines from string interpolation. Test cases: `null` → accepted; `'configuration-assistant://brand-voice/abc'` → accepted; `'broken'` → rejected; `'configuration-assistant:/broken'` → rejected; `''` → rejected; `'configuration-assistant://path with space'` → rejected.
- Cross-org `scope_id` (resolved org ≠ caller's org) rejects with `failure(FailureReason.PermissionDenied, …)`.
- DB unique-constraint violation `23505` on the dedupe partial-unique index is caught inside the same transaction; the executor re-runs the open-match lookup and returns `{ was_new: false, recommendation_id: <existing_id> }` (per spec §6.2 "Idempotency posture"). NEVER bubbles `23505` as a 500.
- Routes return 404 when `:recId` is absent or RLS-hidden; 422 on bad `scopeType` / `scopeId` shape; 200 (with `alreadyX: true`) when the target state is already reached. Service throws use the `{ statusCode, message, errorCode? }` shape; `asyncHandler` translates them to HTTP responses.
- The CTE-based ack/dismiss path uses a state-based optimistic predicate (`WHERE acknowledged_at IS NULL`) so 0-rows-affected = "already in target state" rather than "row missing" — the `existed` count in the CTE distinguishes the two.

### Test considerations

Targeted Vitest suites authored in this chunk:

1. **`agentRecommendationsServicePure.test.ts`** (≈30 cases):
   - `materialDelta` per category against fixture deltas: relative threshold under, relative threshold over, absolute floor under, absolute floor over, volume floor under (rate-based predicates), at-floor edge cases.
   - Eviction priority comparator: severity strictly higher beats lower; severity equal → updated_at desc; updated_at equal → category asc; category equal → dedupe_key asc.
   - Severity-rank computation: `critical=3 > warn=2 > info=1`.
   - Cooldown default per severity: `critical → 24h`, `warn → 168h`, `info → 336h`.
   - Pre-hash canonicalisation: integer fields with `.0` suffix get stripped, ratios round to 4 decimal places, arrays sort ascending, `@preserveOrder` annotation skips array sort (assert via reflection / TS-doc parser if present, otherwise verify manually that no current evidence shape uses `@preserveOrder` and skip this assertion). PLUS the explicit canonical-JSON rules pinned in the contract: object keys sort lexicographically at every nesting level (test by feeding `{a, b}` and `{b, a}` and asserting equal hash); `undefined` values dropped (test by including a key whose value is `undefined` and asserting same hash as the same object without that key); `null` preserved (test by asserting `{x: null}` and `{}` produce DIFFERENT hashes); strings NFC-normalised (test by feeding `"café"` written as NFC vs NFD and asserting equal hash); booleans serialised as `true` / `false` not `1` / `0` (test by asserting `{x: true}` and `{x: 1}` produce different hashes); NaN / Infinity in evidence throws (test the rejection).
   - Determinism check (per DEVELOPMENT_GUIDELINES §8.21): the eviction comparator is deterministic across input permutations — sort 5 candidate recs in 3 different orders, assert by-key identical sorted output.
2. **`agentRecommendations.skillExecutor.test.ts`** (≈15 scenarios — DB-backed):
   - Cooldown active, no severity escalation → returns `cooldown`, no insert.
   - Cooldown active, severity escalates → bypass; falls through to insert.
   - Open match exists, hashes equal → no-op (no `reason`).
   - Open match exists, hashes differ + materialDelta TRUE → `updated_in_place`, `acknowledged_at` cleared.
   - Open match exists, hashes differ + materialDelta FALSE → `sub_threshold`, no DB write.
   - Cap not reached → fresh insert.
   - Cap reached, new candidate priority HIGHER → eviction, evicted row gets `dismissed_until = now() + 6h`.
   - Cap reached, new candidate priority NOT higher → `cap_reached`, returns empty `recommendation_id`.
   - Concurrent races on same `(scope, agent, category, dedupe_key)` from two agents: serialised by advisory lock OR caught by 23505; loser returns `was_new=false`.
   - Category fails three-segment format → `InvalidInput`.
   - Category does not start with agent's namespace → `InvalidInput`.
   - `scope_id` resolves to a different org → `PermissionDenied`.
   - Non-agent caller (no `agentId` in context) → `InvalidInput`.
3. **`agentRecommendations.routes.test.ts`** (≈12 cases):
   - GET with `scopeType=subaccount` — returns rows for that sub-account, RLS filters cross-org.
   - GET with `scopeType=org`, `includeDescendantSubaccounts=true` — returns org-scope rows + descendant sub-account rows; `subaccount_display_name` populated only for descendants.
   - GET with bad `scopeType` → 422.
   - GET cap: `limit=200` clamped to 100.
   - POST acknowledge → first call 200 `alreadyAcknowledged: false`; second call 200 `alreadyAcknowledged: true`; third call (after manual reset) → again `false`.
   - POST acknowledge on row in different org → 404 (RLS-hidden, not 403).
   - POST dismiss without `cooldown_hours` → uses per-severity default; response includes `dismissed_until`.
   - POST dismiss with admin `cooldown_hours=48` as system admin → uses 48h.
   - POST dismiss with `cooldown_hours=48` as non-admin → silently ignored, falls back to per-severity default.
   - POST dismiss `cooldown_hours` clamps to `[1, 90*24]`.
   - Both routes emit `dashboard.recommendations.changed` socket event.
4. **`AgentRecommendationsListPure.test.ts`** (≈10 cases):
   - `collapsedDistinctScopeId=true` + org-rollup mode + 5 rows from 3 sub-accounts → 3 rows out, highest-priority per sub-account.
   - `collapsedDistinctScopeId=false` → no dedupe; rows preserved.
   - Sub-account scope (single scope_id) → dedupe is no-op even when enabled.
   - `mode='expanded'` → ignores limit, no dedupe.
   - Sort by severity desc → updated_at desc.
   - `total` reported via `onTotalChange` is the post-RLS count, NOT the post-dedupe count.

### Dependencies

- None on other chunks. Chunk 1 is the foundation.
- External: depends on the existing `agents` table (FK target on `producing_agent_id`), the `subaccounts` table (`optimiser_enabled` ALTER target), the existing `emitOrgUpdate` helper, the existing `asyncHandler` / `authenticate` middleware, the existing `requireSystemAdmin` guard for the `cooldown_hours` admin override.

### Acceptance criteria (mapped to spec sections)

- [AC-1] Migration 0267 applied; `agent_recommendations` table exists with all four indexes and RLS policy. (spec §6.1)
- [AC-2] `subaccounts.optimiser_enabled` column exists with default true. (spec §4)
- [AC-3] `RLS_PROTECTED_TABLES` contains an entry for `agent_recommendations` pointing at `0267_agent_recommendations.sql`. (DEVELOPMENT_GUIDELINES §1)
- [AC-4] `output.recommend` registered in `SKILL_HANDLERS`; calls from a non-agent context throw `InvalidInput`. (spec §6.2)
- [AC-4a] `action_hint` shape-validated at write time: `null`/omitted accepted; non-null must match `/^[a-z][a-z0-9-]*:\/\/[^\s]+$/`. Malformed values reject with `InvalidInput`. Six test cases enumerated in error-handling section above.
- [AC-5] `output.recommend` decision flow honours the order in spec §6.2 (cooldown → open-match → cap → eviction-or-drop), with the advisory lock + `FOR UPDATE` row lock holding for the entire transaction.
- [AC-6] `materialDelta` predicates match spec §2 thresholds; sub-threshold deltas are full no-ops (no DB write, no LLM call, no event emit).
- [AC-7] Eviction sets `dismissed_until = now() + 6h` AND `dismissed_reason = 'evicted_by_higher_priority'` AND emits `recommendations.evicted_lower_priority` log line.
- [AC-8] Cap-reached drops emit `recommendations.dropped_due_to_cap` log line.
- [AC-8a] Every non-insert decision branch in `output.recommend` emits a structured log line with the deciding context: `recommendations.skipped.cooldown` (carries `{category, dedupe_key, dismissed_until_remaining_s, current_severity, candidate_severity}`), `recommendations.skipped.sub_threshold` (carries `{category, dedupe_key, prev_evidence_hash, next_evidence_hash}`), `recommendations.no_change.hash_match` (carries `{category, dedupe_key, evidence_hash}`). Without these the cooldown / threshold / hash-equality paths are invisible — a row that "should have appeared" but didn't has no audit trail. The eviction and cap-drop log lines from AC-7 / AC-8 already cover the non-skip rejection paths.
- [AC-9] HTTP routes implement the CTE pattern from spec §6.5; idempotent on second call; 404 vs 200-already-X distinguished.
- [AC-10] Dismiss `cooldown_hours` clamps to `[1, 24*90]`; per-severity defaults (24/168/336) apply when omitted.
- [AC-11] Pre-hash canonicalisation honours the 8 rules pinned in the `canonicaliseEvidence` contract above (key sort, undefined-drop, null-preserve, number-normalise, NFC strings, boolean-as-bool, array-sort, no-special-date-handling). `evidence_hash` is sha256 hex of canonical-JSON. Determinism test asserts byte-equal hash for inputs that differ only in key order / key insertion sequence / equivalent number representations.
- [AC-12] `<AgentRecommendationsList>` props match the spec §6.3 surface; `collapsedDistinctScopeId` default rule per the spec; `onTotalChange` fires the post-RLS total.
- [AC-13] Socket event `dashboard.recommendations.changed` emits from `output.recommend` (created / updated paths) and from ack / dismiss routes; hook debounces with 250ms trailing window.
- [AC-14] All targeted unit and integration tests in this chunk pass via `npx vitest run <path>`.
- [AC-15] `npm run lint` and `npm run typecheck` clean.
- [AC-16] No file imports `db` directly outside services / lib (DEVELOPMENT_GUIDELINES §2). Routes call services.
- [AC-16a] **Single-writer invariant for `agent_recommendations`.** `agentRecommendationsService.upsertRecommendation` is the ONLY function that issues `INSERT`/`UPDATE` against `agent_recommendations` (ack/dismiss routes update via the same service through dedicated entry points). The skill handler in `skillExecutor.ts` calls `upsertRecommendation`; nothing else does. Verification: `Grep` for `db.insert(agentRecommendations)` and `db.update(agentRecommendations)` across the repo MUST return zero hits outside `server/services/agentRecommendationsService.ts`. Test: `agentRecommendations.singleWriter.test.ts` (small static-analysis-style test) confirms via `Grep`-equivalent inside Vitest that only the one file matches the write pattern. Future agents that want to emit recommendations MUST go through `output.recommend`; direct writes are a build-time invariant violation.

### Verification commands

```bash
# Lint and typecheck
npm run lint
npm run typecheck

# Targeted tests authored in this chunk
npx vitest run server/services/__tests__/agentRecommendationsServicePure.test.ts
npx vitest run server/services/__tests__/agentRecommendations.skillExecutor.test.ts
npx vitest run server/services/__tests__/agentRecommendations.singleWriter.test.ts
npx vitest run server/services/__tests__/agentRecommendations.skipReasonCoverage.test.ts
npx vitest run server/routes/__tests__/agentRecommendations.routes.test.ts
npx vitest run client/src/components/recommendations/__tests__/AgentRecommendationsListPure.test.ts

# Migration apply (local DB only — confirms schema parses)
npm run db:generate
```

Do NOT run `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `scripts/verify-*.sh`, or any whole-repo verification script. CI runs those.

---

## Chunk 2 — Phase 2 — Telemetry rollup queries + cross-tenant median view (~8h)

**Scope.** Build the 8 telemetry-query modules under `server/services/optimiser/queries/` (one per category), the cross-tenant peer-median materialised view (migration `0267a`), the nightly refresh job, and per-query unit tests against fixture telemetry. The phrase tokeniser (originally a separate Phase 5 in `progress.md`) ships here as part of `escalationPhrases.ts` per spec §9.

**Out of scope for this chunk.** No agent definition (Chunk 3). No scan-skill markdown specs (Chunk 3). No evaluator modules (Chunk 3). No write to `agent_recommendations` (the queries return raw evidence shapes; the evaluator wraps and `output.recommend` writes — both in Chunk 3).

### Files to create

- `server/services/optimiser/queries/agentBudget.ts` — reads `cost_aggregates`. Returns `Array<{ agent_id, this_month, last_month, budget, top_cost_driver }>`.
- `server/services/optimiser/queries/escalationRate.ts` — joins `flow_runs` + `flow_step_outputs` + `review_items` + `actions`. Returns `Array<{ workflow_id, run_count, escalation_count, common_step_id }>`. `common_step_id` is the modal `flow_step_outputs.stepId` of escalating runs (per spec §3 telemetry table + §6.5 deep-link table).
- `server/services/optimiser/queries/skillLatency.ts` — extracts skill_slug + duration from `agent_execution_events.payload` JSONB filtered to `event_type='tool_call.completed'`. Computes per-sub-account p95 over 7 days, joins to `optimiser_skill_peer_medians` view via `withAdminConnection()` (the view is sysadmin-bypassed RLS per spec §3 access posture — read it through the admin connection inside this query module). **Staleness guard:** before joining the view, this module reads `pg_stat_user_tables` (or the materialised view's `pg_class.relhasindex`-adjacent metadata via `pg_stat_all_tables.last_analyze` / a sentinel `view_refreshed_at` row in a dedicated `optimiser_view_metadata` table written by the refresh job) and confirms the last refresh is within the spec §3 24h window. If the view is stale (last refresh > 24h ago), the query returns `[]` and emits a `recommendations.scan_skipped.peer_view_stale` log line carrying `{view_age_hours, threshold_hours: 24}`. The whole skill-slow recommendation category is suppressed for that run rather than returning rows derived from outdated peer data — spec §3 staleness window is contractual, not advisory. The simplest implementation: `migration 0267a` ALSO creates `CREATE TABLE optimiser_view_metadata (view_name text PRIMARY KEY, refreshed_at timestamptz NOT NULL)`, and `refreshOptimiserPeerMedians.ts` writes `INSERT … ON CONFLICT (view_name) DO UPDATE SET refreshed_at = now()` after each successful refresh. `skillLatency.ts` reads that single row.
- `server/services/optimiser/queries/inactiveWorkflows.ts` — joins `subaccount_agents` rows where `scheduleEnabled=true AND scheduleCron IS NOT NULL` to `agent_runs.startedAt` last-run; expected cadence computed via `scheduleCalendarServicePure.computeNextHeartbeatAt` (file already exists at `server/services/scheduleCalendarServicePure.ts` per architecture).
- `server/services/optimiser/queries/escalationPhrases.ts` — tokenises `review_items.reviewPayloadJson` over 7 days; minimal stemmer (lowercase + strip punctuation + suffix-strip `-ing`/`-ed`/`-s`); n-gram counter; ≥3 occurrences threshold. Returns `Array<{ phrase, count, sample_escalation_ids }>`. `sample_escalation_ids` is sorted ascending (per spec §6.2 "Default-safe array sorting" — no `@preserveOrder` annotation needed since it isn't semantic).
- `server/services/optimiser/queries/memoryCitation.ts` — reads `memory_citation_scores`. Returns `Array<{ agent_id, low_citation_pct, total_injected, projected_token_savings }>`.
- `server/services/optimiser/queries/routingUncertainty.ts` — reads `fast_path_decisions`. Returns `Array<{ agent_id, low_confidence_pct, second_look_pct, total_decisions }>`. `total_decisions` is the row count required by spec §2 materialDelta volume floor.
- `server/services/optimiser/queries/cacheEfficiency.ts` — reads `llm_requests` cache columns. Returns `Array<{ agent_id, creation_tokens, reused_tokens, dominant_skill }>`.
- `migrations/0267a_optimiser_peer_medians.sql` (+ `.down.sql`) — `CREATE MATERIALIZED VIEW optimiser_skill_peer_medians AS …` over `agent_execution_events` filtered to `event_type='tool_call.completed'`; computes p50/p95/p99 per `skill_slug` across all sub-accounts. HAVING clause enforces `count(distinct subaccount_id) >= 5` so single-tenant data cannot leak per spec §3.
- `server/jobs/refreshOptimiserPeerMedians.ts` — pg-boss job handler that runs `REFRESH MATERIALIZED VIEW CONCURRENTLY optimiser_skill_peer_medians` then `INSERT INTO optimiser_view_metadata (view_name, refreshed_at) VALUES ('optimiser_skill_peer_medians', now()) ON CONFLICT (view_name) DO UPDATE SET refreshed_at = excluded.refreshed_at`. Registered to fire at `00:00 UTC` per spec §3 staleness window. Uses `withAdminConnection` (the view is system-scoped). Idempotency posture: `safe` — `REFRESH` is a no-op if the view is already current; metadata UPSERT is idempotent. The metadata write is the staleness signal `skillLatency.ts` reads.
- `server/services/optimiser/queries/__tests__/agentBudgetPure.test.ts` — pure tests against fixture `cost_aggregates` rows.
- `server/services/optimiser/queries/__tests__/escalationRatePure.test.ts` — pure tests against fixture flow_runs + step_outputs.
- `server/services/optimiser/queries/__tests__/skillLatencyPure.test.ts` — pure tests against fixture events; mocks the peer-median view's response with a stubbed admin-connection result. Includes the staleness-guard cases per AC-24a (mock `optimiser_view_metadata.refreshed_at` at 23h / 25h / null and assert the rows / empty / empty + log triple).
- `server/services/optimiser/queries/__tests__/inactiveWorkflowsPure.test.ts` — pure tests against fixture `subaccount_agents` + `agent_runs`.
- `server/services/optimiser/queries/__tests__/escalationPhrasesPure.test.ts` — ~10 tokeniser cases covering casing, stopwords, suffix-stripping, n-gram counting, and the ≥3 threshold (per spec §9 Phase 2 line 638).
- `server/services/optimiser/queries/__tests__/memoryCitationPure.test.ts` — pure tests against fixture `memory_citation_scores`.
- `server/services/optimiser/queries/__tests__/routingUncertaintyPure.test.ts` — pure tests against fixture `fast_path_decisions`; asserts `total_decisions` is the row count.
- `server/services/optimiser/queries/__tests__/cacheEfficiencyPure.test.ts` — pure tests against fixture `llm_requests`.
- `server/services/optimiser/queries/__tests__/peerMedianViewIntegration.test.ts` — DB-backed test (NOT `*Pure`) that asserts the view definition produces the right output for a fixture set: 5 sub-accounts using a skill → median computed; 3 sub-accounts using a skill → no row returned (HAVING clause filters).

### Files to modify

- `server/lib/jobConfig.ts` (or wherever job retry / timeout config lives) — register `refresh_optimiser_peer_medians` queue config.
- `server/index.ts` (or the boot path that registers job workers) — boot the new job worker and schedule.
- `tasks/builds/subaccount-optimiser/progress.md` — mark Phase 2 in progress / complete.

### Contracts

Each query module exports a single async function with a `withAdminConnection`-or-`withOrgTx` boundary chosen per the data's scope. The query module is responsible for its own transaction; the caller (Chunk 3 evaluator) just consumes the typed return value.

```ts
// server/services/optimiser/queries/agentBudget.ts
export interface AgentBudgetRow {
  agent_id: string;
  this_month: number;       // integer cents
  last_month: number;       // integer cents
  budget: number;           // integer cents
  top_cost_driver: string;  // skill_slug or 'unknown'
}
export async function queryAgentBudget(input: { subaccountId: string; organisationId: string }): Promise<AgentBudgetRow[]>;
```

```ts
// server/services/optimiser/queries/skillLatency.ts
export interface SkillLatencyRow {
  skill_slug: string;
  latency_p95_ms: number;   // integer
  peer_p95_ms: number;      // integer; sourced from optimiser_skill_peer_medians via withAdminConnection
  ratio: number;            // 4 decimal places
}
export async function querySkillLatency(input: { subaccountId: string; organisationId: string }): Promise<SkillLatencyRow[]>;
```

(... and analogous shapes for the other 6 queries — each returns an array of typed rows whose fields directly populate the matching `RecommendationEvidence` shape minus the `category` discriminator.)

**Tokeniser contract** (escalationPhrases.ts):

```ts
export function tokenisePhrase(payload: string): string[];      // lowercase + strip punct + suffix-strip
export function countNGrams(tokens: string[], n: number): Map<string, number>;
export function extractFrequentPhrases(reviewPayloads: Array<{ id: string; payload: string }>, opts: { minOccurrences: number; maxNgram: number }): Array<{ phrase: string; count: number; sample_escalation_ids: string[] }>;
```

`sample_escalation_ids` returned ascending sorted (so the canonicalisation step in Chunk 1's `output.recommend` is a no-op rather than a re-sort).

**Materialised view definition** (0267a):

```sql
CREATE MATERIALIZED VIEW optimiser_skill_peer_medians AS
SELECT
  payload->>'skill_slug' AS skill_slug,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'duration_ms')::int) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'duration_ms')::int) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY (payload->>'duration_ms')::int) AS p99_ms,
  count(DISTINCT subaccount_id) AS contributing_subaccount_count
FROM agent_execution_events
WHERE event_type = 'tool_call.completed'
  AND timestamp >= now() - INTERVAL '7 days'
  AND payload->>'skill_slug' IS NOT NULL
  AND payload->>'duration_ms' IS NOT NULL
GROUP BY payload->>'skill_slug'
HAVING count(DISTINCT subaccount_id) >= 5;

CREATE UNIQUE INDEX ON optimiser_skill_peer_medians (skill_slug);
-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
```

The view's exact `payload->>` paths must match the discriminated-union `tool_call.completed` shape pinned in `shared/types/agentExecutionLog.ts` per spec §3 — verify this by reading that file before writing the view, and adjust if the actual JSON path differs (`payload.skill_slug` vs `payload.tool.name`, etc.).

### Error handling

- Each query module catches `withAdminConnection` / `withOrgTx` errors at the boundary and re-throws with a service-shape `{ statusCode: 500, message: 'optimiser query failed', errorCode: '<query_name>_failed' }`. Chunk 3 then catches at the run level and emits `recommendations.scan_failed` rather than aborting the run (per spec §13 risk mitigation).
- Queries with no matching telemetry return `[]`, NOT throw. Empty array is the normal "nothing to recommend" signal.
- `skillLatency.ts` returns the row only when `peer_p95_ms` is non-null (i.e. the view returned a row for that skill_slug). When the view has no row (skill used by < 5 sub-accounts), the row is omitted entirely — the evaluator never sees it.
- The `refresh_optimiser_peer_medians` job uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` so a long-running refresh doesn't block reads. If the concurrent refresh fails (no unique index, etc.), it falls back to non-concurrent refresh inside the same job.

### Test considerations

For each of the 8 query modules, the unit-test file:

1. Seeds fixture telemetry rows in a transaction-rollback test DB (Vitest `beforeEach` opens a tx, `afterEach` rolls back).
2. Calls the query function with a `subaccountId` matching the fixture.
3. Asserts the returned shape, including the date-window filter (per spec §9 Phase 1 "Query cost guardrails for scan modules" — every query MUST have `WHERE created_at >= now() - interval '7 days'` or equivalent).
4. Determinism: each test runs the query twice against the same fixture; asserts byte-equal output.
5. Composite-index check (per spec §9 Phase 1): each test queries `pg_indexes` for the source table and asserts the existence of the relied-upon composite index (`agent_runs(organisation_id, started_at)`, `agent_execution_events(run_id, timestamp)`, `cost_aggregates(scope_id, created_at)`, `memory_citation_scores(run_id, created_at)`, `fast_path_decisions(agent_id, created_at)`, `llm_requests(agent_id, created_at)`). If any required index is missing, the test fails — adding the missing index is part of this chunk's responsibility.

The phrase tokeniser test (`escalationPhrasesPure.test.ts`) is fully pure (no DB) and covers ~10 cases:

1. Casing collapse: "guarantee" + "Guarantee" → count 2.
2. Suffix-strip: "guarantee" + "guaranteed" + "guarantees" → count 3.
3. Stopword filter: "the" / "and" / "or" excluded.
4. N-gram counting: bigram and trigram across a fixture of phrases.
5. ≥3 threshold: phrases with count 2 are filtered out; count 3 included.
6. Empty input: returns `[]`.
7. Punctuation stripped: "guarantee!" + "guarantee," → count 2.
8. Multi-line payload: tokenises across newlines.
9. JSONB shape: input `{ "reason": "uses guarantee" }` → tokeniser pulls from any string value.
10. `sample_escalation_ids` sorted ascending in output.

The peer-median view integration test seeds 5 sub-accounts using `skill.x` and 3 sub-accounts using `skill.y`, refreshes the view, asserts `skill.x` has a row and `skill.y` does not.

### Dependencies

- Chunk 1's schema (`agent_recommendations`, `subaccounts.optimiser_enabled`) must be importable for type re-exports, but no Chunk 2 file actually writes to those tables. Practically, do Chunk 1 first.
- Existing tables read from: `cost_aggregates`, `flow_runs`, `flow_step_outputs`, `review_items`, `actions`, `agent_execution_events`, `subaccount_agents`, `agent_runs`, `memory_citation_scores`, `fast_path_decisions`, `llm_requests`, `subaccounts`. All exist on `main` per spec §3.
- Existing helpers used: `withOrgTx`, `withAdminConnection`, `scheduleCalendarServicePure.computeNextHeartbeatAt`, `getPgBoss`.

### Acceptance criteria (mapped to spec sections)

- [AC-17] Migration 0267a applied; `optimiser_skill_peer_medians` materialised view exists with the HAVING ≥ 5 clause. (spec §3, §9 Phase 1)
- [AC-18] Unique index on `(skill_slug)` exists so `REFRESH ... CONCURRENTLY` works.
- [AC-19] `refresh_optimiser_peer_medians` pg-boss job registered and scheduled for `00:00 UTC` daily. (spec §3 "Refresh staleness")
- [AC-20] All 8 query modules return typed rows whose fields match the `RecommendationEvidence` shapes from spec §6.5.
- [AC-21] Each query module's SQL includes a `WHERE <timestamp_column> >= now() - interval '7 days'` clause (or equivalent for non-`created_at` columns); per-query unit test asserts via parser. (spec §9 Phase 1 "Query cost guardrails")
- [AC-22] Composite-index existence test passes for all 6 source tables. (spec §9 Phase 1 "Composite-index check")
- [AC-23] Tokeniser collapses casing + minimal suffixes (`-ing`/`-ed`/`-s`); ≥3 threshold enforced; `sample_escalation_ids` sorted ascending. (spec §9 Phase 1 escalationPhrases.ts paragraph)
- [AC-24] `skillLatency.ts` reads peer-median values via `withAdminConnection`; returns NO row when peer-median view has no entry for the skill. (spec §3 access posture + minimum-tenant threshold)
- [AC-24a] `skillLatency.ts` returns `[]` and emits `recommendations.scan_skipped.peer_view_stale` when `optimiser_view_metadata.refreshed_at` is > 24h ago (spec §3 staleness window). Test asserts: with `refreshed_at = now() - interval '25 hours'` the query returns `[]`; with `refreshed_at = now() - interval '23 hours'` it returns rows; with NO row in `optimiser_view_metadata` (first run before initial refresh) it returns `[]` and treats absence as stale.
- [AC-24b] Migration 0267a creates `optimiser_view_metadata (view_name text PRIMARY KEY, refreshed_at timestamptz NOT NULL)`; the refresh job writes the row after every successful refresh.
- [AC-25] All targeted unit + integration tests in this chunk pass via `npx vitest run <path>`.
- [AC-26] `npm run lint` and `npm run typecheck` clean.

### Verification commands

```bash
npm run lint
npm run typecheck

# Per-query targeted tests
npx vitest run server/services/optimiser/queries/__tests__/agentBudgetPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/escalationRatePure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/skillLatencyPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/inactiveWorkflowsPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/escalationPhrasesPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/memoryCitationPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/routingUncertaintyPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/cacheEfficiencyPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/peerMedianViewIntegration.test.ts

# Migration apply
npm run db:generate
```

Test-gate suites and full verification scripts are CI-only.

---

## Chunk 3 — Phase 3 — Optimiser agent definition + scan skills (~6h)

**Scope.** Author the `subaccount-optimiser` agent definition, the 8 scan-skill markdown specs, the 8 evaluator modules that wrap query output into recommendation candidates, the 8 scan-skill executor cases, the LLM render step, the schedule registration with `singletonKey`, the deploy-time backfill script, and the `subaccountService.create` hook for new sub-accounts. After this chunk, the optimiser runs daily on every opted-in sub-account.

**Out of scope for this chunk.** Dashboard rendering (Chunk 4). Verification + doc sync (Chunk 5).

### Files to create

- `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` — agent role, system prompt (per spec §4 draft text), skill manifest naming the 8 scan skills + `output.recommend`, and the namespace declaration `optimiser`. Use `companies/automation-os/agents/portfolio-health-agent/AGENTS.md` as the structural template — do NOT merge with portfolio-health.
- `server/skills/optimiser/scan_agent_budget.md`
- `server/skills/optimiser/scan_workflow_escalations.md`
- `server/skills/optimiser/scan_skill_latency.md`
- `server/skills/optimiser/scan_inactive_workflows.md`
- `server/skills/optimiser/scan_escalation_phrases.md`
- `server/skills/optimiser/scan_memory_citation.md`
- `server/skills/optimiser/scan_routing_uncertainty.md`
- `server/skills/optimiser/scan_cache_efficiency.md`
- `server/services/optimiser/recommendations/agentBudget.ts` — evaluator: takes `AgentBudgetRow[]` from query, applies the spec §2 trigger predicate (`> 1.3× budget for 2 consecutive months`), emits `{ category: 'optimiser.agent.over_budget', severity: 'critical', evidence, dedupe_key, action_hint }` candidates.
- `server/services/optimiser/recommendations/playbookEscalation.ts` — evaluator for `optimiser.playbook.escalation_rate` (trigger > 60% rate over 14 days).
- `server/services/optimiser/recommendations/skillSlow.ts` — evaluator for `optimiser.skill.slow` (trigger ratio > 4 sustained 7 days; rows already filtered by ≥5 peer count via the query module).
- `server/services/optimiser/recommendations/inactiveWorkflow.ts` — evaluator for `optimiser.inactive.workflow`.
- `server/services/optimiser/recommendations/repeatPhrase.ts` — evaluator for `optimiser.escalation.repeat_phrase`. Action-hint construction must degrade gracefully when F1's `subaccount_artefacts` brand-voice memory block is not present (see Cross-feature degradation paths section below).
- `server/services/optimiser/recommendations/memoryCitation.ts` — evaluator for `optimiser.memory.low_citation_waste`.
- `server/services/optimiser/recommendations/routingUncertainty.ts` — evaluator for `optimiser.agent.routing_uncertainty`.
- `server/services/optimiser/recommendations/cacheEfficiency.ts` — evaluator for `optimiser.llm.cache_poor_reuse`.
- `server/services/optimiser/optimiserCronPure.ts` — pure helper exporting `computeOptimiserCron(subaccountId: string): string` per the deterministic-staggering rule above. Pure (no I/O, no clock); fully unit-testable.
- `server/services/optimiser/evaluatorBoundsPure.ts` — pure helper `assertPercentInBounds(value: number, fieldName: string): boolean` returning `true` when `value` is in `[0, 1]` and finite, `false` otherwise (and emitting a `recommendations.evaluator_bounds_violation { category, field: fieldName, value, source_query }` log line on `false`). Each evaluator that consumes a percent field (`escalation_pct`, `low_citation_pct`, `low_confidence_pct`, `second_look_pct`, `cache_hit_pct` if present) calls the helper before generating a candidate; an out-of-bounds row is dropped with the log line, NOT thrown. This catches upstream data corruption (e.g. cost-aggregate computation overflow producing negative percents) without crashing the entire run. Cents and counts (which have no natural upper bound) are NOT bounds-checked here — only percent fields.
- `server/services/optimiser/__tests__/optimiserCronPure.test.ts` — pure tests: distribution check (1000 fake UUIDs → minutes spread roughly uniformly across 0-59 with χ² well below the rejection threshold; hours spread across 6-11), determinism (same input → same output), output format (`/^\d{1,2} \d{1,2} \* \* \*$/`).
- `server/services/optimiser/__tests__/evaluatorBoundsPure.test.ts` — pure tests: in-bounds value (0.5) → returns true, no log; out-of-bounds (1.5, -0.1, NaN, Infinity) → returns false + emits one `recommendations.evaluator_bounds_violation` log line each; field name passed through to log payload.
- `server/services/optimiser/optimiserOrchestrator.ts` — top-level orchestration that the agent calls. Sequentially invokes the 8 scan skills, collects raw query output, runs each evaluator, sorts candidates by spec §6.2 "Pre-write candidate ordering" priority tuple, then calls `output.recommend` once per candidate. Wraps each scan invocation in try/catch and emits `recommendations.scan_failed` log lines on failure (per spec §13 + §9 Phase 2). The render-LLM call (raw evidence → 2-3 sentence operator copy) lives here, batched at the end with cache key `(category, dedupe_key, evidence_hash, render_version)`. Render uses Sonnet via `llmRouter` (per DEVELOPMENT_GUIDELINES §4 — never call provider adapters directly).
- `scripts/backfill-optimiser-schedules.ts` — one-shot script per spec §4 + §9 Phase 2. For every sub-account where `subaccounts.optimiser_enabled=true`: `INSERT INTO subaccount_agents (...) ON CONFLICT DO NOTHING` to create the optimiser link, then call `agentScheduleService.updateSchedule(linkId, { scheduleCron, scheduleEnabled: true, scheduleTimezone })`. **The cron is computed deterministically per sub-account** via the shared helper `computeOptimiserCron(subaccountId)` in `server/services/optimiser/optimiserCronPure.ts` (created in this chunk): `minute = hash(subaccountId) % 60`, `hour = 6 + (hash(subaccountId) >> 6) % 6` — yielding `${minute} ${hour} * * *` distributed across `06:00`–`11:59` local. This replaces the spec §13 "stagger by `created_at` hash across a 6-hour window" backfill-only mitigation: the offset is now a permanent property of each sub-account's schedule, NOT a one-time backfill effect. Both the backfill script AND the `subaccountService.create` hook call `computeOptimiserCron` so new sub-accounts inherit the same staggering rule. Without this change, every new sub-account created post-backfill drifts back into the default `0 6 * * *` cluster, re-creating the schedule storm risk over time. Backfill log line per sub-account: `{ subaccountId, action, computed_cron, schedule_registered }`.
- `server/services/__tests__/optimiserOrchestrator.test.ts` — DB-backed integration test: seeds telemetry for one fake sub-account hitting all 8 categories; runs orchestrator end-to-end; asserts 8 rows appear in `agent_recommendations` with the expected dedupe keys, severities, and namespaced categories. A second case asserts that a scan-failure in one category does not abort the others (only 7 rows + 1 `recommendations.scan_failed` log line).
- `server/services/optimiser/recommendations/__tests__/repeatPhraseDegradationPure.test.ts` — pure tests for the F1-degradation logic in `repeatPhrase.ts`: given the F1 brand-voice memory block exists → action_hint includes `?phrase=...`; given F1 not yet merged (memory block absent) → action_hint falls back to a brand-voice landing page without the phrase param OR to a generic Configuration Assistant landing per the spec §12 "graceful degradation" requirement.

### Files to modify

- `server/services/skillExecutor.ts` — add 8 new SKILL_HANDLERS entries for the optimiser scan skills. Each handler imports the corresponding query module and returns the raw row array. Per DEVELOPMENT_GUIDELINES §8.23, every action in `ACTION_REGISTRY` needs a SKILL_HANDLERS entry — verify whether scan skills need an `actionRegistry` entry (most direct skills like `web_search`, `read_workspace` do not; the optimiser scan skills are the same shape, so they likely do not).
- `server/services/agentScheduleService.ts` — extend `registerSchedule` (line 255) to accept an optional `singletonKey` parameter and pass it through to `pgboss.schedule(scheduleName, cron, data, { tz, singletonKey })`. The optimiser schedule passes `singletonKey: 'subaccount-optimiser:${subaccountId}:${agentId}'` per spec §6.2 "Run-level atomicity invariant" — this prevents a still-running optimiser run from overlapping with the next day's fire. Backwards-compatible: existing callers omit `singletonKey` and behaviour is unchanged.
- `server/services/subaccountService.ts` (or whichever file owns `create`/`createSubaccount` per the file inventory in `architecture.md` — the spec §9 Phase 2 calls it `subaccountService.create`) — add a hook fired on new sub-account creation: when `optimiser_enabled=true` (the default), idempotently create the optimiser `subaccount_agents` link and register its daily schedule using `computeOptimiserCron(newSubaccountId)` from the shared helper. Same `INSERT … ON CONFLICT DO NOTHING` shape as the backfill so re-running is safe. NEVER hard-codes `0 6 * * *` — the deterministic per-sub-account stagger applies to new sub-accounts as well.
- `server/lib/jobConfig.ts` (if needed) — the optimiser scheduled run reuses the existing `agent-scheduled-run` queue per `agentScheduleService.ts` line 20. No new queue config needed.
- `tasks/builds/subaccount-optimiser/progress.md` — mark Phase 3 in progress / complete.

### Contracts

**Agent definition** (per the existing `companies/automation-os/agents/portfolio-health-agent/AGENTS.md` shape):

```yaml
# companies/automation-os/agents/subaccount-optimiser/AGENTS.md frontmatter
role: subaccount-optimiser
namespace: optimiser            # category prefix enforced by output.recommend
scope: subaccount               # mirrors all 15+ business agents per migration 0106
defaultSchedule:
  cronStrategy: per-subaccount-deterministic   # computed at registration time via computeOptimiserCron(subaccountId)
  cronWindow: '06:00–11:59 local'              # spread across 360 minutes via hash(subaccountId)
  timezoneSource: subaccount.timezone
defaultEnabled: true             # gated by subaccounts.optimiser_enabled
skills:
  - optimiser.scan_agent_budget
  - optimiser.scan_workflow_escalations
  - optimiser.scan_skill_latency
  - optimiser.scan_inactive_workflows
  - optimiser.scan_escalation_phrases
  - optimiser.scan_memory_citation
  - optimiser.scan_routing_uncertainty
  - optimiser.scan_cache_efficiency
  - output.recommend
```

The exact YAML keys must match the existing agent-definition loader; copy from `portfolio-health-agent/AGENTS.md` rather than guessing.

**Evaluator contract** (each evaluator module):

```ts
// server/services/optimiser/recommendations/agentBudget.ts
import type { AgentBudgetRow } from '../queries/agentBudget.js';
import type { OutputRecommendInput } from 'shared/types/agentRecommendations.js';

export interface RecommendationCandidate {
  category: string;            // namespaced, e.g. 'optimiser.agent.over_budget'
  severity: 'info' | 'warn' | 'critical';
  evidence: Record<string, unknown>;  // matches the corresponding RecommendationEvidence shape
  dedupe_key: string;
  action_hint?: string;
}
export function evaluateAgentBudget(rows: AgentBudgetRow[]): RecommendationCandidate[];
```

The orchestrator's render step takes `RecommendationCandidate` + cached title/body lookup and builds the final `OutputRecommendInput` for the skill executor.

**Render-step contract**:

```ts
interface RenderInput {
  category: string;
  evidence: Record<string, unknown>;
}
interface RenderOutput {
  title: string;     // operator-facing, plain English, no slugs
  body: string;      // 2-3 sentences, concrete numbers
}
async function renderRecommendation(
  input: RenderInput,
  ctx: { renderVersion: number; cacheKey: string },
): Promise<RenderOutput>;
```

**Render output validation.** A successful LLM call can still return garbled output (empty string, single-character titles, 5000-character bodies). The render step validates the response against pinned bounds before caching:

```
title:  trimmed length in [10, 120] chars; no leading slug-like prefix (rejects /^[a-z_.]+:/)
body:   trimmed length in [40, 600] chars; ends with '.', '!', or '?'
```

If validation fails: retry once with a slightly stronger prompt clause ("Respond in 2 sentences, 40-200 chars, ending with a period."). If the second attempt also fails validation, treat the same as a render failure per the existing error-handling rule (log `recommendations.render_validation_failed { category, dedupe_key, attempt, fail_reason }`, do NOT call `output.recommend`, retry next day). The retry attempt costs one extra LLM call per garbled output — acceptable because the cache means most renders never retry, and a garbled-but-shipped row erodes operator trust more than a 24-hour delay does.

**Per-run soft timeout.** The orchestrator carries a wall-clock budget of 60 seconds per invocation. Before each scan-skill call AND before each render call, check `Date.now() - runStartedAt`; if elapsed > 60s, abort the remaining work and emit `recommendations.run_timeout { subaccount_id, agent_id, completed_categories, remaining_categories, elapsed_ms }`. The next day's scheduled fire picks up where this run left off. singletonKey already prevents two runs from the same sub-account overlapping, but a single 5-minute stuck run could miss the next day's schedule entirely (pg-boss singleton drops the queued fire if the prior run hasn't completed). 60s is generous: 8 categories × ~2s SQL + 8 render calls × ~3s LLM ≈ 40s steady-state. Tunable in code per `OPTIMISER_RUN_BUDGET_MS = 60_000` constant alongside `RENDER_VERSION`.

**Per-run candidate cap.** After scanning + evaluating + sorting, the orchestrator hard-caps the candidate list at 25 entries before render. If `candidates.length > 25`, log `recommendations.run_candidate_cap_exceeded { subaccount_id, total: <n>, kept: 25, dropped: <n - 25> }` and truncate to the top 25 (the sort is already by spec §6.2 priority, so the highest-priority candidates are kept). This is a cost guardrail, NOT a correctness rule: a query bug (e.g. tokeniser threshold misconfigured) could otherwise return 200 candidates → 200 render calls before the per-scope cap of 10 runs eviction. The 25-cap caps render-call cost at ~25 LLM calls per sub-account per run worst case, regardless of upstream bugs. Tunable per `OPTIMISER_RUN_CANDIDATE_CAP = 25` constant.

**Run-summary log line.** At the end of every orchestrator run (success OR partial-success on timeout / scan failure), emit one structured log line that captures the full outcome:

```
recommendations.run_summary {
  subaccount_id,
  agent_id,
  total_candidates,        // post-sort, post-truncate-to-25
  written,                 // was_new=true inserts
  updated_in_place,        // updated_in_place reason returns
  skipped_cooldown,
  skipped_sub_threshold,
  skipped_no_change,       // hash_match
  evicted_lower_priority,
  dropped_due_to_cap,
  render_failures,         // includes both raw failures and validation-retry-then-drop
  candidate_cap_exceeded,  // boolean
  duration_ms,
  status                   // 'completed' | 'completed_with_failures' | 'timed_out'
}
```

This is the single line a debugger reaches for first when something looks off. Granular logs (cooldown / sub_threshold / cap / etc.) remain for drill-down. The summary is computed in-memory during the run and emitted once in a `try/finally` so it fires even on uncaught throws.

**LLM model selection.** The render call MUST pin model, max_tokens, and temperature explicitly via `llmRouter` options:

```ts
await llmRouter.complete({
  model: 'claude-sonnet-4-6',     // Sonnet 4.6 — the current cost-effective tier per spec §8 cost model
  max_tokens: 300,                 // ~200 token budget per spec §8 + 50% headroom
  temperature: 0.2,                // low to keep title/body deterministic across runs with same evidence
  prompt: …,
});
```

The model alias is pinned so an upstream router upgrade cannot silently re-route to Opus (or to a future model whose token cost is higher). When Anthropic ships a newer Sonnet (4.7+), bumping the alias is a deliberate one-line change accompanied by a `RENDER_VERSION` bump (because the rendered copy may differ subtly enough to invalidate the cache). Without the explicit pin, the cost contract in spec §8 is unverifiable.

**Body-must-contain-digit heuristic.** As part of render output validation (above), the body string MUST contain at least one digit (`/\d/`). Every category surfaces a concrete number in evidence — cost in cents, percentage, count, or duration in ms — and an operator-facing body with no digit is almost certainly vague filler ("the agent has been escalating frequently"). Add to the validation rule set: if `!body.match(/\d/)` → treat as failed validation, retry once with the existing stronger-prompt clause, then drop + log per the existing rule. This catches ~80% of low-quality LLM outputs that pass length checks.

**Global kill switch.** Read `process.env.OPTIMISER_DISABLED === 'true'` at orchestrator entry AND at schedule-registration entry. When true: orchestrator returns immediately without running any scans (logs `recommendations.run_skipped { reason: 'global_kill_switch' }`); schedule registration in `subaccountService.create` and the backfill script skips creating the optimiser link. Permitted under `docs/spec-context.md` `feature_flags: only_for_behaviour_modes` — this is a behaviour-mode toggle for incident response, not a rollout flag. Documented in the AGENTS.md frontmatter so operators know it exists. Per-sub-account `subaccounts.optimiser_enabled` remains the day-to-day control; the env flag is the global panic button for cost spikes, broken render, or any incident requiring an immediate halt across the fleet without a database write.

Cache key: `(category, dedupe_key, evidence_hash, render_version)`. Cache backing: re-use the existing prompt-result cache (whichever `agentExecutionService` uses) OR — if that's not feasible without spec changes — write a small in-process LRU cache (`Map<string, { title: string; body: string }>` bounded at **5000 entries** with LRU eviction) per DEVELOPMENT_GUIDELINES §8.24. Sizing rationale: 100 sub-accounts × 8 categories × ~3 evidence variants over the daily run set ≈ 2400 active entries; 5000 leaves headroom for evidence-shape variants (e.g. multiple agents per sub-account hitting `agent.over_budget`) without churning. Per-run invalidation is not needed; cross-run cache hits are the whole point. If observed working-set under steady load exceeds 5000 (logged via a periodic cache-stats line), revisit toward a shared cache rather than further bumping the in-process bound — beyond ~10k entries the per-process Map is the wrong primitive.

**`singletonKey` contract** for the schedule (spec §6.2):

```ts
const singletonKey = `subaccount-optimiser:${subaccountId}:${agentId}`;
await pgboss.schedule(scheduleName, cron, data, { tz, singletonKey });
```

If a previous optimiser run is still executing when the next schedule fires, the second job is dropped (pg-boss singleton semantics). This is the desired behaviour per spec §6.2 "Run-level atomicity invariant".

### Error handling

- Each scan-skill handler is wrapped by the orchestrator in try/catch. On failure: emit `recommendations.scan_failed` log line `{ category, error_type, error_message_redacted }` (per spec §9 Phase 2). The run continues with the remaining categories.
- The render step calls Sonnet via `llmRouter`. On LLM failure: skip rendering that one candidate (do NOT skip the whole batch), emit a `recommendations.render_failed` log line, and DO NOT call `output.recommend` for that candidate — better to drop than to write garbled or empty title/body. The next day's run will retry rendering when the same evidence_hash is seen.
- The backfill script's `INSERT … ON CONFLICT DO NOTHING` is safe to re-run. The script logs each per-sub-account result `{ subaccountId, action: 'created' | 'already_existed', schedule_registered: boolean }` so re-runs are observable.
- The `subaccountService.create` hook wraps the optimiser-link creation in a try/catch; if the link creation fails (e.g. `agents` row for the optimiser is missing), log the error and let sub-account creation succeed — the optimiser is non-critical infrastructure, not core sub-account onboarding. The next backfill run will close the gap.
- Schedule registration failures during boot are already log-and-continue per `registerAllActiveSchedules` line 244–247.

### Test considerations

1. **`optimiserOrchestrator.test.ts`** (DB-backed):
   - Happy path: 1 sub-account with seeded telemetry hitting all 8 categories → 8 rows in `agent_recommendations` with namespaced categories (`optimiser.agent.over_budget`, etc.), correct severities, correct dedupe keys.
   - Scan failure path: stub `queryAgentBudget` to throw → 7 rows produced, 1 `recommendations.scan_failed` log line emitted, orchestrator returns successfully.
   - Render cache hit: run twice with byte-equal evidence → second run produces zero LLM calls (assert via `llmRouter` spy), zero new rows (open match path returns `was_new=false` no-reason).
   - Material-delta sub-threshold: change one evidence field by less than the threshold → second run produces zero LLM calls AND zero DB writes (sub_threshold path).
   - Material-delta over-threshold: change evidence by more than the threshold → second run produces an LLM call (re-render) AND an `updated_in_place` row update with `acknowledged_at` cleared.
   - Cap eviction: seed 10 open recs for one `(scope, agent)` of severity warn → produce a critical candidate → assert one warn row gets dismissed with `dismissed_reason='evicted_by_higher_priority'`, evicted row carries `dismissed_until = now() + 6h`.
   - Pre-write sort determinism: seed 5 candidates of varied severity / category / dedupe_key; run orchestrator three times with the scan results returned in three different orders (permutations of the same set); assert the sequence of `output.recommend` calls is byte-equal across all three runs. Confirms the eviction outcome cannot vary by scan-order luck.
   - Render output validation retry: stub `llmRouter` to return `{ title: '', body: 'x' }` on first call and `{ title: 'Agent over budget', body: 'Sales agent spent $1.4k vs $1k budget this month, mostly on llm.complete.' }` on second; assert exactly two LLM calls, no `recommendations.render_validation_failed` log, row written successfully.
   - Render output validation drop: stub `llmRouter` to return invalid output on both attempts; assert two LLM calls, one `recommendations.render_validation_failed` log line, NO `output.recommend` call for that candidate, other candidates proceed.
   - Run-budget timeout: stub `queryAgentBudget` to `await new Promise(r => setTimeout(r, 70_000))` (use Vitest fake timers — DO NOT actually sleep 70s); assert remaining 7 categories are skipped, `recommendations.run_timeout` log line fires with `completed_categories: ['agent.over_budget']` and `remaining_categories.length === 7`.
   - Per-run candidate cap: stub `escalationPhrases` query to return 200 candidates; assert exactly 25 render calls, `recommendations.run_candidate_cap_exceeded` log fires once with `total: 200, kept: 25, dropped: 175`.
   - Body-no-digit retry: stub LLM render to return `{ title: 'Agent escalation rate is high', body: 'The agent has been escalating frequently.' }` first call (no digit), then a valid body with digit on second call → assert two LLM calls, no validation-failed log, row written.
   - Run-summary line: happy-path run → assert exactly one `recommendations.run_summary` line emitted with the full counter shape; throw inside scan #4 → assert summary still emitted from `try/finally` with `status: 'completed_with_failures'` and `render_failures: 0` but populated other counters.
   - Global kill switch (orchestrator): set `process.env.OPTIMISER_DISABLED = 'true'` for the test; invoke orchestrator → assert no DB writes, no LLM calls, exactly one `recommendations.run_skipped { reason: 'global_kill_switch' }` log line, NO `recommendations.run_summary` line (the run did not start).
   - Global kill switch (create hook): with the env flag set, call `subaccountService.create` for a new sub-account → assert no `subaccount_agents` link row created for the optimiser, no schedule registered.
   - Model + tokens + temperature pin: spy on `llmRouter.complete` calls; assert each call's options equal `{ model: 'claude-sonnet-4-6', max_tokens: 300, temperature: 0.2 }` (plus the prompt). Single round-trip is enough to catch a router-config drift.
   - Percent-bounds evaluator: feed `playbookEscalation.ts` a row with `escalation_pct: 1.5` (out of `[0, 1]`); assert no candidate produced and exactly one `recommendations.evaluator_bounds_violation { category: 'optimiser.playbook.escalation_rate', field: 'escalation_pct', value: 1.5 }` log line. Repeat with `-0.1` → same result.
2. **`repeatPhraseDegradationPure.test.ts`** (pure):
   - Given a fake `lookupBrandVoiceBlock` returning a present block → action_hint is `configuration-assistant://brand-voice/<sub_id>?phrase=guarantee`.
   - Given a fake returning null (F1 not yet merged) → action_hint is `configuration-assistant://subaccount/<sub_id>?focus=brand-voice` (or whichever degraded form the implementer picks; the spec §12 only requires "graceful degradation", not the exact path).
3. Backfill script: dry-run in a test DB; assert idempotent re-run produces zero new rows the second time.
4. `subaccountService.create` hook: create a sub-account in a test DB; assert the optimiser `subaccount_agents` link exists with `scheduleEnabled=true`. Toggle `optimiser_enabled=false` in the create payload; assert no link is created.

### Dependencies

- Chunk 1 must be merged: `output.recommend` must be in `SKILL_HANDLERS`, the `RecommendationEvidence` shapes must exist in `shared/types/agentRecommendations.ts`, the `agent_recommendations` table must exist.
- Chunk 2 must be merged: the 8 query modules must exist and be importable.
- F1 (`subaccount-artefacts`) — NOT a hard dependency. The `repeatPhrase.ts` evaluator degrades gracefully per the cross-feature degradation paths section.

### Acceptance criteria (mapped to spec sections)

- [AC-27] `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` exists with namespace `optimiser`, daily 06:00 cron, manifest naming all 8 scan skills + `output.recommend`. (spec §4)
- [AC-28] All 8 scan-skill markdown specs exist under `server/skills/optimiser/`. (spec §5)
- [AC-29] All 8 SKILL_HANDLERS entries registered in `skillExecutor.ts`. (spec §9 Phase 2)
- [AC-30] All 8 evaluator modules emit candidates with `optimiser.<area>.<finding>` three-segment categories. (spec §6.2 "Category naming hard rule")
- [AC-31] `optimiserOrchestrator.ts` invokes scans sequentially within a run, sorts candidates by the priority tuple before calling `output.recommend`, batches the render-LLM call. (spec §6.2 "Run-level atomicity invariant"). The pre-write sort is DETERMINISTIC across input permutations: orchestrator test seeds 5 candidates in 3 different scan-order permutations and asserts byte-equal output ordering after sort. Without determinism, evicted-row identity could vary across runs with identical evidence — and the spec's "byte-equal evidence is full no-op" guarantee would silently weaken.
- [AC-31a] Render-step output validation enforces title length [10, 120] chars and body length [40, 600] chars ending in `.`, `!`, or `?`. One retry on validation failure with a stronger prompt clause; second failure logs `recommendations.render_validation_failed` and skips writing per the render-failure rule. Test: feed a stub LLM returning `{ title: '', body: 'x' }` — assert one retry, then drop + log on second failure.
- [AC-31b] Orchestrator carries a 60s wall-clock budget per invocation (`OPTIMISER_RUN_BUDGET_MS = 60_000`); aborts remaining categories when exceeded and emits `recommendations.run_timeout` with completed/remaining category lists. Test: stub one query to sleep > 60s; assert subsequent categories are skipped and the timeout log line fires once.
- [AC-31c] Orchestrator hard-caps the candidate list at 25 per run (`OPTIMISER_RUN_CANDIDATE_CAP = 25`) before render. When `candidates.length > 25`, log `recommendations.run_candidate_cap_exceeded` and truncate to top 25 (post-priority-sort). Test: stub `escalationPhrases` query to return 200 phrases → assert exactly 25 render calls happen and the cap-exceeded log fires once with `total: 200, kept: 25, dropped: 175`.
- [AC-31d] Render output validation includes a body-must-contain-digit check (`/\d/`). On failure: one retry with the stronger-prompt clause; second failure follows the existing drop+log path. Test: stub LLM to return `{ title: 'Agent escalation rate is high', body: 'The agent has been escalating frequently.' }` (no digit) → assert one retry, then drop on second-failure variant.
- [AC-31e] Render call pins `model: 'claude-sonnet-4-6'`, `max_tokens: 300`, `temperature: 0.2` explicitly via `llmRouter.complete` options. Test: spy on `llmRouter.complete` and assert the options object matches exactly. Bumping model alias is paired with a `RENDER_VERSION` bump (documented in `renderVersion.ts` top comment).
- [AC-31f] Orchestrator emits exactly one `recommendations.run_summary` log line per run via `try/finally`, with all counters from the decision branches plus `duration_ms` and `status`. Test: run a happy path → assert exactly one summary line; throw mid-run → assert the summary still fires (with `status: 'completed_with_failures'`).
- [AC-31g] `OPTIMISER_DISABLED=true` env flag short-circuits orchestrator (logs `recommendations.run_skipped { reason: 'global_kill_switch' }` and returns) AND skips schedule registration in `subaccountService.create` and the backfill script. Test: set env, run orchestrator → assert no scans executed, no DB writes, summary log NOT fired (because the run never started). Test: set env, call subaccountService.create → assert no optimiser link row created.
- [AC-31h] Each evaluator that consumes a percent field calls `assertPercentInBounds` from `evaluatorBoundsPure.ts`; out-of-bounds rows are dropped with the `recommendations.evaluator_bounds_violation` log line. Test: feed `playbookEscalation.ts` a row with `escalation_pct: 1.5` → assert no candidate produced, exactly one bounds-violation log line.
- [AC-32] Each scan invocation wrapped in try/catch; failures emit `recommendations.scan_failed`; run continues on failure. (spec §13 silent-scan-failures + §9 Phase 2)
- [AC-33] Render LLM call cached by `(category, dedupe_key, evidence_hash, render_version)`. Re-run with byte-equal evidence is zero-LLM-cost. (spec §2 + §6.2)
- [AC-34] `agentScheduleService.registerSchedule` accepts optional `singletonKey`; the optimiser schedule passes `subaccount-optimiser:${subaccountId}:${agentId}`; backwards compatible for existing callers. (spec §6.2)
- [AC-35] `scripts/backfill-optimiser-schedules.ts` is idempotent; uses `computeOptimiserCron(subaccountId)` to stagger registrations across the `06:00–11:59` window deterministically. (spec §4 + §13 schedule storm — the plan extends this from one-time stagger to permanent stagger; see deterministic-cron note below)
- [AC-35a] `computeOptimiserCron(subaccountId)` is pure, deterministic, and used by BOTH the backfill script AND the `subaccountService.create` hook. New sub-accounts inherit the same staggering rule rather than clustering on a fixed cron. χ²-style distribution test in `optimiserCronPure.test.ts` confirms the spread.
- [AC-36] `subaccountService.create` hook creates the optimiser link + schedule when `optimiser_enabled=true`; no link when `optimiser_enabled=false`; idempotent insert. (spec §4)
- [AC-37] `repeatPhrase.ts` action_hint degrades gracefully when F1's brand-voice memory block is absent. (spec §12)
- [AC-38] All targeted unit + integration tests in this chunk pass via `npx vitest run <path>`.
- [AC-39] `npm run lint` and `npm run typecheck` clean.

### Verification commands

```bash
npm run lint
npm run typecheck

# Targeted tests authored in this chunk
npx vitest run server/services/__tests__/optimiserOrchestrator.test.ts
npx vitest run server/services/optimiser/recommendations/__tests__/repeatPhraseDegradationPure.test.ts
npx vitest run server/services/optimiser/__tests__/optimiserCronPure.test.ts
npx vitest run server/services/optimiser/__tests__/evaluatorBoundsPure.test.ts

# Backfill script smoke test (does not commit anything; logs the per-sub-account decisions)
npx tsx scripts/backfill-optimiser-schedules.ts --dry-run
```

Test-gate suites and full verification scripts are CI-only.

---

## Chunk 4 — Phase 4 — Home dashboard wiring (~3h)

**Scope.** Insert the new "A few things to look at" section into `DashboardPage.tsx` between "Pending your approval" and "Your workspaces". Wire `<AgentRecommendationsList>` (delivered in Chunk 1) with scope derived from `Layout.tsx`'s `activeClientId`. Add the rec-count badge to the sidebar. Optionally add a `<RecommendationsCard>` to `SubaccountDetailPage.tsx`.

**Out of scope for this chunk.** No new component (Chunk 1 shipped it). No `/suggestions` standalone page (deferred to v1.1 per spec §7). No solving the broader Home-dashboard scope-inconsistency tension (deferred per spec §1, §7, §13).

### Files to modify

- `client/src/pages/DashboardPage.tsx` — add a new section after `{/* ── Pending approval ──────... */}` (line ~401) and before `{/* [LAYOUT-RESERVED: Piece 3 — Operational metrics] */}` (line ~420). Section header `"A few things to look at"` (h2 with the same `text-[17px] font-bold text-slate-900 tracking-tight mb-3.5` style as siblings). Sub-header line (12.5px slate-500) with the freshness label + `"See all N →"` affordance on the right. Body: `<AgentRecommendationsList ... />` wired per spec §7 scope-aware rendering.
- `client/src/components/Sidebar.tsx` — add a small numeric badge next to the dashboard nav entry showing total open recs for the current scope (org or sub-account). Reads from the same `useAgentRecommendations` hook with a thin scope-only fetch shape. Hidden when count is 0.
- `client/src/pages/SubaccountDetailPage.tsx` (optional, deferred-or-not based on operator confirmation) — add a card showing the same recommendations filtered to that sub-account. F2 owns this card per the file-collision matrix in `concurrent-build-plan.md` §3 (additive-only with F3's `BaselineStatusBadge` + `ManualBaselineForm`). If skipped here, file under "Open architectural questions" below.
- `client/src/lib/relativeTime.ts` (already exists) — confirm it has the `< 4h → "this morning"` and `> 4h → "yesterday"` thresholds the freshness label needs. If not, extend it. **Freshness source:** the label is derived from `max(updated_at)` of the rows currently displayed, NOT the dashboard mount time and NOT the last optimiser-run timestamp. Pinning to row data is the only way the label stays accurate across refetches and socket updates — a fresh socket event that adds a row will pull the freshness forward; an idle dashboard tab that hasn't refetched will show stale freshness, which is the correct UX signal. The hook exposes `latestUpdatedAt: Date | null` alongside `rows` and `total`; the dashboard formats it via `relativeTime.format(latestUpdatedAt)` and stores in `recsFreshness`.
- `tasks/builds/subaccount-optimiser/progress.md` — mark Phase 4 in progress / complete.

### Files to create

- `client/src/pages/__tests__/DashboardPagePure.test.ts` — pure-logic tests for the scope-derivation function (org context → org+descendants; sub-account context → that sub-account only). Extract the scope-deriver into `client/src/pages/dashboardPageScopePure.ts` and test directly (matches the extract-pure-logic convention).
- `client/src/pages/dashboardPageScopePure.ts` — the extracted pure helper.

### Contracts

**Scope derivation** (the one new piece of logic in this chunk):

```ts
// client/src/pages/dashboardPageScopePure.ts
import type { AgentRecommendationsListProps } from '../components/recommendations/AgentRecommendationsList.js';

export function deriveDashboardScope(input: {
  activeClientId: string | null;
  userOrganisationId: string;
}): AgentRecommendationsListProps['scope'] & { includeDescendantSubaccounts?: boolean } {
  if (input.activeClientId === null) {
    return { scope: { type: 'org', orgId: input.userOrganisationId }, includeDescendantSubaccounts: true };
  }
  return { scope: { type: 'subaccount', subaccountId: input.activeClientId } };
}
```

**Section JSX shape** (in `DashboardPage.tsx`):

```tsx
const [recsMode, setRecsMode] = useState<'collapsed' | 'expanded'>('collapsed');
const [recsTotal, setRecsTotal] = useState(0);
const [recsLatestUpdatedAt, setRecsLatestUpdatedAt] = useState<Date | null>(null);
const recsFreshness = recsLatestUpdatedAt ? formatRelativeTime(recsLatestUpdatedAt) : null;
const { scope, includeDescendantSubaccounts } = deriveDashboardScope({
  activeClientId,
  userOrganisationId: user.organisationId,
});

// Conditional render — section is hidden entirely when recsTotal === 0
{recsTotal > 0 && (
  <div className="mb-8">
    <div className="flex items-baseline justify-between mb-3.5">
      <h2 className="text-[17px] font-bold text-slate-900 tracking-tight">
        A few things to look at
      </h2>
      {recsTotal > 3 && recsMode === 'collapsed' && (
        <button
          type="button"
          className="text-[12.5px] text-slate-500 hover:text-slate-700"
          onClick={() => setRecsMode('expanded')}
        >
          See all {recsTotal} →
        </button>
      )}
    </div>
    {recsFreshness && (
      <p className="text-[12.5px] text-slate-500 mb-2">{recsFreshness}</p>
    )}
    <AgentRecommendationsList
      scope={scope}
      includeDescendantSubaccounts={includeDescendantSubaccounts}
      mode={recsMode}
      limit={3}
      emptyState="hide"
      onTotalChange={setRecsTotal}
      onLatestUpdatedAtChange={setRecsLatestUpdatedAt}
      onExpandRequest={() => setRecsMode('expanded')}
    />
  </div>
)}
```

Per CLAUDE.md user preferences and DEVELOPMENT_GUIDELINES §8.25, the "See all N →" button has `type="button"` (it is not a form submit).

**Sidebar badge** (in `Sidebar.tsx`):

```tsx
const { total } = useAgentRecommendations({ scope, limit: 0 }); // limit=0 returns total only
{total > 0 && (
  <span className="text-[10px] bg-slate-200 text-slate-700 rounded-full px-1.5">
    {total > 99 ? '99+' : total}
  </span>
)}
```

The hook's `limit: 0` shape is pinned in Chunk 1's GET endpoint contract — the server short-circuits to a `COUNT(*)` so the sidebar render is cheap even for org scopes with hundreds of open recs.

### Error handling

- The hook's fetch failure is non-blocking — the section renders nothing (or shows the count badge as 0) and falls back to the empty-state hide rule. No user-facing error message on the dashboard for this surface; failed fetches log to the existing client-side error reporter.
- The `relativeTime` formatter is pure; never throws.
- Socket disconnection is handled by the existing socket layer; no new error path.

### Test considerations

1. **`DashboardPagePure.test.ts`** (≈4 cases):
   - `activeClientId === null` → returns `{ scope: { type: 'org', orgId }, includeDescendantSubaccounts: true }`.
   - `activeClientId !== null` → returns `{ scope: { type: 'subaccount', subaccountId } }` with no `includeDescendantSubaccounts`.
   - Determinism: same input twice → same output.
   - Boundary: empty-string `activeClientId` is treated as a valid sub-account id (the parent state is the source of truth — no normalisation here).
2. The section render is exercised manually (per Chunk 5's manual end-to-end). No RTL test; matches existing convention (KNOWLEDGE.md 2026-04-21 entry).

### Dependencies

- Chunk 1: `<AgentRecommendationsList>`, `useAgentRecommendations` hook, the read endpoint.
- Chunk 3: actual recommendation data is produced. The dashboard renders nothing until at least one optimiser run has fired and produced rows. Both can land independently — the dashboard wiring is correct even with zero rows in the table.

### Acceptance criteria (mapped to spec sections)

- [AC-40] Dashboard renders the new section between "Pending your approval" and "Your workspaces". (spec §7)
- [AC-41] Section header is `"A few things to look at"`. (spec §7)
- [AC-42] Section is HIDDEN when `recsTotal === 0`. (spec §7 "Hidden when empty")
- [AC-43] Org context (no sub-account selected) → `scope.type='org'`, `includeDescendantSubaccounts=true`. (spec §7)
- [AC-44] Sub-account context → `scope.type='subaccount'`, no `includeDescendantSubaccounts`. (spec §7)
- [AC-45] `"See all N →"` link expands the section in place via `setRecsMode('expanded')`. No navigation in v1. (spec §7)
- [AC-45a] Freshness label is derived from `max(updated_at)` of displayed rows via `onLatestUpdatedAtChange` callback (NOT from dashboard mount time, NOT from last optimiser-run timestamp). Pure-test asserts `formatRelativeTime` of the returned Date drives the label string; rendered label updates when a socket event refetch brings in a newer row.
- [AC-46] Sidebar badge shows total open recs for current scope; hidden when 0. (concurrent-build-plan §3)
- [AC-47] Dashboard does not solve the broader scope-inconsistency tension (spec §7). Sibling widgets remain as they are.
- [AC-48] All targeted unit tests in this chunk pass via `npx vitest run <path>`.
- [AC-49] `npm run lint`, `npm run typecheck`, `npm run build:client` all clean.

### Verification commands

```bash
npm run lint
npm run typecheck
npm run build:client

# Targeted tests authored in this chunk
npx vitest run client/src/pages/__tests__/DashboardPagePure.test.ts
```

Test-gate suites and full verification scripts are CI-only.

---

## Chunk 5 — Phase 6 — Verification + doc sync (~2h)

**Scope.** Static-check the entire branch, run all targeted tests authored in Chunks 1–4, perform a manual end-to-end run on a test sub-account, sample cost behaviour, and update the two reference docs that this work changes (`docs/capabilities.md` and `architecture.md`). Closeout `progress.md`.

**Out of scope for this chunk.** Test-gate scripts. Whole-repo verification scripts. These run in CI.

### Files to modify

- `docs/capabilities.md` — under "Sub-account observability" (or the closest existing section): add a paragraph describing the optimiser ("daily proactive efficiency advice surfaced as a section on the Home dashboard, scoped per sub-account or rolled up across clients"). Per the `docs/capabilities.md § Editorial Rules` and KNOWLEDGE.md 2026-04-16 entry, write in vendor-neutral marketing-ready language — no internal slugs (`agent.over_budget`), no engineering terms (`materialised view`, `pg-boss`), no provider names. Also add a short paragraph describing the new generic recommendations primitive ("any agent can write to a shared operator-facing recommendations surface").
- `architecture.md` — add an entry under the relevant "Key files per domain" section for the new `agent_recommendations` primitive. Document the cross-tenant `optimiser_skill_peer_medians` materialised view as a sysadmin-bypassed read pattern (cite spec §3 access posture). Document `output.recommend` as a reusable skill any agent may carry. Per CLAUDE.md §13 doc style: agent-facing → dense, bullets, signal-density. ≤2 sentences per rule unless code is the point.
- `tasks/builds/subaccount-optimiser/progress.md` — add a Closeout section at the bottom listing what landed, decisions captured during the build, deferred items routed to `tasks/todo.md`, and any cross-build lessons worth promoting to `KNOWLEDGE.md`.
- `KNOWLEDGE.md` — append entries for any non-obvious patterns discovered during the build (per CLAUDE.md §3 — be specific, file paths and function names where relevant). Likely candidates: anything new about pg-boss `singletonKey` semantics, anything new about the canonical-JSON / SHA hashing pipeline, anything about RLS interaction with the `subaccount_display_name` join. Append-only.

### Manual verification steps

1. **Migrate a test database to migration 0267 + 0267a.** Confirm both views/tables exist; confirm `subaccounts.optimiser_enabled = true` for all existing sub-accounts after migration.
2. **Seed a test sub-account with telemetry hitting all 8 categories.** Use the integration test fixtures from Chunk 3.
3. **Trigger an optimiser run manually** via `pgboss.send('agent-scheduled-run', { subaccountAgentId: <test_link_id>, … })` or by calling `agentExecutionService.executeRun` directly with the optimiser agent.
4. **Verify all 8 recommendations appear** in `agent_recommendations` with namespaced categories, plain-English titles, no slug strings in the rendered title or body.
5. **Open the dashboard in BOTH org context and sub-account context.** Confirm the section appears with correct rows in both. Confirm it's hidden when no rows exist.
6. **Acknowledge one row, dismiss another with a reason.** Confirm `dashboard.recommendations.changed` fires and the section refetches. Confirm dismissed row stays gone for the per-severity cooldown (verify by triggering a re-run within the cooldown window — row should not reappear).
7. **Sample cost.** Run optimiser for 5 sub-accounts × 7 days against fixture data; sum the `llm_requests` rows tagged with the optimiser render call; confirm < $0.10 total LLM spend per spec §11.

### Acceptance criteria

- [AC-50] `npm run lint` clean.
- [AC-51] `npm run typecheck` clean.
- [AC-52] `npm run build:client` clean.
- [AC-53] All targeted tests authored in Chunks 1–4 pass on a single re-run via the per-chunk `npx vitest run` invocations.
- [AC-54] Manual end-to-end run produces 8 expected recommendations; UI renders them in both org and sub-account context; ack/dismiss round-trip works.
- [AC-55] Cost sample under $0.10 LLM spend for 5-sub-account × 7-day run.
- [AC-56] `docs/capabilities.md` updated with vendor-neutral copy describing the optimiser AND the reusable primitive.
- [AC-57] `architecture.md` updated with the cross-tenant median view + reusable primitive entries.
- [AC-58] `progress.md` Closeout section appended.
- [AC-59] Every load-bearing pattern captured as a `KNOWLEDGE.md` entry.

### Verification commands

```bash
npm run lint
npm run typecheck
npm run build:client

# Re-run all targeted tests authored in this build (per-file, not the suite)
npx vitest run server/services/__tests__/agentRecommendationsServicePure.test.ts
npx vitest run server/services/__tests__/agentRecommendations.skillExecutor.test.ts
npx vitest run server/routes/__tests__/agentRecommendations.routes.test.ts
npx vitest run client/src/components/recommendations/__tests__/AgentRecommendationsListPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/agentBudgetPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/escalationRatePure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/skillLatencyPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/inactiveWorkflowsPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/escalationPhrasesPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/memoryCitationPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/routingUncertaintyPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/cacheEfficiencyPure.test.ts
npx vitest run server/services/optimiser/queries/__tests__/peerMedianViewIntegration.test.ts
npx vitest run server/services/__tests__/optimiserOrchestrator.test.ts
npx vitest run server/services/optimiser/recommendations/__tests__/repeatPhraseDegradationPure.test.ts
npx vitest run client/src/pages/__tests__/DashboardPagePure.test.ts
```

After all four pass:

```bash
# Run spec-conformance against the build slug
"spec-conformance: verify the current branch against docs/sub-account-optimiser-spec.md"

# After spec-conformance returns CONFORMANT_AFTER_FIXES (or CONFORMANT), run pr-reviewer
"pr-reviewer: review the changes on claude/subaccount-optimiser"
```

`dual-reviewer` and `adversarial-reviewer` are optional second-phase reviews — only run if the user explicitly asks AND the session is local (per CLAUDE.md review-pipeline rules).

Do NOT run any test-gate scripts, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`, or umbrella `npm run test:*` commands. CI runs the full suite as a pre-merge gate.

---

## Risks + mitigations

The spec already enumerates 7 risks in §13. Re-stated here so the executor can find them in one place; mitigations are pulled directly from the spec — this plan introduces no new mitigations beyond what the spec authorises.

| Risk | Spec §13 mitigation summary | Where in this plan |
|------|------------------------------|--------------------|
| Recommendation noise (operators ignore the surface) | Severity tuning, dedupe by `(scope, category, dedupe_key)`, hard cap of 10 with priority eviction, per-category material-change thresholds, per-severity dismiss cooldown, severity-escalation bypass, top-3 + "see all" pattern. | Chunk 1 (cap + eviction + cooldown); Chunk 1 + Chunk 4 (top-3 default). |
| Cross-tenant median view leakage (single-tenant data revealed) | 5-tenant minimum threshold enforced inside the view definition (HAVING clause). | Chunk 2 (migration 0267a HAVING clause + skillLatency.ts skip-when-no-row). |
| Cost overrun on LLM render | Cache key `(category, dedupe_key, evidence_hash, render_version)`; byte-equal evidence is full no-op; RENDER_VERSION bumps are explicit and infrequent. | Chunk 1 (renderVersion.ts) + Chunk 3 (orchestrator render-cache wiring). |
| Schedule storm (100+ daily crons at boot overwhelm pg-boss) | Plan extends spec §13's one-time backfill stagger into a PERMANENT per-sub-account deterministic stagger via `computeOptimiserCron(subaccountId)`, applied by both the backfill script and the create hook. Cron clusters cannot re-form for new sub-accounts. | Chunk 3 (`optimiserCronPure.ts` + backfill script + `subaccountService.create` hook). |
| Primitive over-extension (widget registry, layout engine, etc.) | §6.4 enumerates explicit out-of-scope; this plan inherits that boundary. | All chunks — explicit "out of scope" lines on Chunk 1 and Chunk 4. |
| Pre-existing Home dashboard scope tension | Documented as out-of-scope; flag for follow-up spec. | Chunk 4 explicit out-of-scope. |
| Slug leakage to UI | Render layer enforces operator-facing strings only; integration test asserts no slug appears in rendered title/body. | Chunk 3 (optimiserOrchestrator.test.ts asserts no namespaced category appears in rendered title or body). |
| Silent scan failures | Each scan-skill invocation wrapped in try/catch; emits `recommendations.scan_failed` log line; run continues. | Chunk 3 (orchestrator try/catch + log emission). |

### Plan-introduced risk: F1 may not have merged when Chunk 3 starts

This is a known dependency per spec §12 and progress.md. Mitigation lives in the next section.

### Plan-introduced risk: Pre-existing violation of §8.23 if optimiser scan skills accidentally land in `ACTION_REGISTRY` without `SKILL_HANDLERS` entries (or vice versa)

The 8 scan-skill markdowns + the 8 `SKILL_HANDLERS` entries must be authored together in Chunk 3. Per DEVELOPMENT_GUIDELINES §8.23, registration in one without the other leaves the action unreachable at runtime with no compile-time error. Verify both are present in the final commit; the integration test in Chunk 3 (`optimiserOrchestrator.test.ts`) would fail if a handler were missing.

---

## Cross-feature degradation paths

Per the kickoff prompt and concurrent-build-plan: F2 must work whether or not F1 has merged, and must not require F3 at all.

### F1 dependency: `escalation.repeat_phrase` action_hint

**The dependency.** F1 (`subaccount-artefacts`, migration 0266) ships the brand-voice memory block (a tier-1 sub-account artefact). F2's `optimiser.escalation.repeat_phrase` recommendation's `action_hint` per spec §6.5 is `configuration-assistant://brand-voice/<subaccount_id>?phrase=<urlencoded_phrase>` — that surface presupposes the brand-voice artefact exists.

**Degradation path** (implemented in Chunk 3, `repeatPhrase.ts`).

```ts
// Pseudocode for the degradation path
async function buildRepeatPhraseActionHint(input: { subaccountId: string; phrase: string }): Promise<string> {
  const brandVoiceBlock = await tryFetchBrandVoiceMemoryBlock(input.subaccountId);
  if (brandVoiceBlock !== null) {
    // F1 has merged AND a brand-voice block exists for this sub-account
    return `configuration-assistant://brand-voice/${input.subaccountId}?phrase=${encodeURIComponent(input.phrase)}`;
  }
  // F1 not merged OR no brand-voice block yet for this sub-account
  // Fall back to a generic Configuration Assistant landing — the operator still gets pointed somewhere useful
  return `configuration-assistant://subaccount/${input.subaccountId}?focus=brand-voice`;
}
```

The `tryFetchBrandVoiceMemoryBlock` helper:

- If F1 has merged and `memory_blocks.tier='tier1'` rows exist with the brand-voice domain: returns the block.
- If F1 has not merged: the `tier` column does not exist; the helper detects `column "tier" does not exist` (Postgres error code `42703`) and returns null. NO migration check, NO branch on environment — the SQL error is the signal.
- If F1 has merged but this sub-account has no brand-voice block yet: returns null.

The recommendation still fires; only the deep-link target degrades. The recommendation row itself is identical regardless of F1's state.

**Verification.** The `repeatPhraseDegradationPure.test.ts` in Chunk 3 covers both paths. The integration test in `optimiserOrchestrator.test.ts` runs against the F2-only schema and asserts the degraded action_hint is produced. After F1 merges to main, the F2 branch rebases onto main; the test should re-pass with the F1-aware action_hint as long as a fixture brand-voice block is seeded.

### Riley W3 categories

`context.gap.persistent` and `context.token_pressure` (per spec §15) are not in F2's scope at all. They depend on `context.assembly.complete` events that don't exist in `agentExecutionService.ts` today (verified per spec §15 line 787). They're listed under "Out of scope" in `progress.md` and will be added as v1.1 / Phase 5 follow-up when Riley W3 ships. This plan does not include any code or tests for them.

### F3 (`baseline-capture`) is fully independent

F2 reads no F3 data. Both touch `client/src/pages/SubaccountDetailPage.tsx` (additive components, no shared mutation per concurrent-build-plan §3) but neither blocks the other. F2 can land before, after, or alongside F3. No degradation path needed.

### F1's `subaccountOnboardingService.ts` extensions

F1 extends `subaccountOnboardingService.markArtefactCaptured`. F2 does NOT touch this file per the collision matrix. No coordination needed.

---

## Open architectural questions for the operator to confirm

These are the small set of questions where the spec authorises latitude and the plan picks a recommended answer. Confirm or override before starting Chunk 1.

1. **Does the optimiser need a `<RecommendationsCard>` on `SubaccountDetailPage.tsx` in v1?** The concurrent-build-plan §3 lists this in F2's column ("F2 + F3 add new card components — no shared mutation; merge order doesn't matter"), but the spec §7 only describes the Home dashboard surface — it does not mandate a sub-account-detail-page card. The plan currently lists it as **optional in Chunk 4**.
   - Recommended: include it. The component is already built (Chunk 1's `<AgentRecommendationsList>`); rendering it on `SubaccountDetailPage` is one extra call site with `scope={{ type: 'subaccount', subaccountId }}`. ~15 minutes of work; closes a UX gap where operators in sub-account-detail context see no recommendations even though they exist.
   - Override if: you prefer a stricter "spec-only" interpretation and want this listed as deferred.

2. **Should the optimiser's render-cache backing be the existing prompt-result cache OR a new in-process LRU?** Spec §6.2 / §8 require the cache to exist, do not specify the implementation. Chunk 3 currently lists "re-use existing prompt-result cache OR write a small in-process LRU bounded at 5000 entries with LRU eviction".
   - Recommended: in-process LRU bounded at 5000 entries (sized for 100 sub-accounts × 8 categories × ~3 evidence variants ≈ 2400 active entries plus headroom). Per DEVELOPMENT_GUIDELINES §8.24, module-level Maps used as process-lifetime dedup require an explicit size cap with LRU eviction. The simplest path is a small `LruMap` wrapper around `Map` with insertion-order eviction. The existing prompt-result cache is keyed by full-prompt hash, not by the per-recommendation key the spec defines, so re-use needs adapter code.
   - Override if: the existing cache infrastructure (whichever module owns prompt-cache hits on `agentExecutionService`) can accept a custom cache key cheaply, OR if you anticipate the working set exceeding ~10k entries (e.g. operator plans 500+ sub-accounts) — at that scale move to a shared cache (Redis or the existing prompt-result cache with an adapter) rather than scaling the in-process Map further.

3. **Should the `subaccountService.create` hook live in `subaccountService.ts` or in a new `optimiserOnboardingService.ts`?** Spec §9 Phase 2 calls it `subaccountService.create` but doesn't pin the file. The current plan extends `subaccountService.ts`.
   - Recommended: extend `subaccountService.ts` with a small private helper. Don't create a new service file for one method — DEVELOPMENT_GUIDELINES §2 says a new service file requires multiple DB interactions or multiple callers.
   - Override if: you anticipate other agents needing similar hooks soon (Portfolio Health Agent's auto-link-on-create, etc.) — then a dedicated `agentOnboardingService.ts` is justified upfront.

4. **Does the dismiss endpoint's `cooldown_hours` admin override need a system-admin permission check at the route, or is silent ignore-when-not-admin acceptable?** Spec §6.5 says "admin-only — silently ignored if the caller is not a system admin per the standard `requireSystemAdmin` guard pattern". The current plan implements silent-ignore.
   - Recommended: silent-ignore at the route level (do not 403). It's a power-user override, not a security boundary; non-admins simply get the per-severity default, which is correct. Matches the spec literal.
   - Override if: you'd rather 403 to make the misuse loud. (Spec wins if you do — re-read §6.5.)

5. **Should the 10-rec cap be supplemented with a per-category sub-cap (e.g. max 3 per category per scope)?** Spec §6 pins the global cap at 10 with severity-based eviction; it does NOT pin a per-category cap. The eviction comparator already prefers higher-severity / more-recent rows, so a critical finding from any other category will displace a same-or-lower-severity row from a noisy category — but within the same severity, one chatty category can occupy all 10 slots and crowd out signal from quiet categories.
   - Recommended: do NOT add a per-category cap in v1. The eviction comparator's severity tiebreaker is the primary defence; if dashboard data shows one category dominating after rollout, add the sub-cap as a follow-up driven by evidence rather than speculation. Adds non-trivial logic to the cap-enforcement transaction (count-by-category inside the locked region) for a benefit we cannot yet measure.
   - Override if: you have prior evidence from comparable surfaces that one category dominates by default and want to pre-empt the issue. The implementation is a per-(scope, agent, category) count + threshold check inside the same advisory-locked region as the global cap.

6. **Should repeat dismissals escalate the cooldown beyond the per-severity defaults?** Spec §6 defines per-severity cooldowns (24h / 168h / 336h) but does NOT define escalating suppression. A row that gets dismissed three times in a row reappears at the same cooldown each cycle.
   - Recommended: do NOT add escalating suppression in v1. Operators dismissing the same recommendation repeatedly is a signal — either the recommendation is wrong (fix the threshold) or the underlying issue is real and the operator is choosing to ignore it (a UX-level decision the system should not silently override). Adding 30-day suppression after 3 dismissals risks burying recurring problems. If post-rollout data shows operators expressing fatigue, add it as a follow-up with the right cadence.
   - Override if: you have a strong UX preference for "if I dismissed it three times, stop nagging me". Implementation: count `agent_recommendations` rows for the same `(scope, category, dedupe_key)` with `dismissed_at IS NOT NULL AND dismissed_at >= now() - interval '30 days'`; if `>= 3`, set `dismissed_until = now() + interval '30 days'` instead of the per-severity default.

If you do not respond to these, the executor proceeds with the recommended answers.

---

## Plan-time concerns

Items I noticed while planning that the spec does not fully resolve. None block proceeding; all listed for Chunk 5 doc-sync or follow-up.

1. **The spec uses `subaccount-optimiser` namespace for categories (`optimiser.agent.over_budget`).** The category-naming hard rule in spec §6.2 says the namespace is derived from the calling agent's `AGENTS.md` role definition. The role per spec §4 is `subaccount-optimiser`, but the namespace per spec §6.2 examples is `optimiser` (e.g. `optimiser.agent.over_budget`, not `subaccount-optimiser.agent.over_budget`). This implies the agent definition declares `namespace: optimiser` separate from the `role`. Chunk 3's AGENTS.md frontmatter contract reflects this. Confirm during implementation by reading the existing agent-definition loader; if it doesn't support a separate `namespace` key, the spec needs an amendment to allow `role: optimiser` (which would clash with the existing convention) OR to allow per-agent namespace declaration. The plan currently assumes the loader supports `namespace:`.

2. **The render cache key includes `render_version` per spec §2 + §6.2, but the `agent_recommendations` row schema does not store it.** This is consistent with the spec's intent (render_version is a runtime cache key, not a row column), but it means a row stored under render_version=1 is invisible to a render_version=2 cache lookup (cache miss → re-render → `updated_in_place` if evidence_hash also changes, or no-op `was_new=false` if evidence_hash matches). The behaviour is correct (rendering is invalidated on version bump) but worth flagging because re-rendering 100 sub-accounts × 8 categories on a render_version bump is a one-off ~$10 LLM hit. Plan-time call: that's acceptable per the spec's cost model, but Chunk 3's executor should log `recommendations.render_version_bump_invalidated` at the first render after a version bump so the spend spike is auditable.

3. **The spec assumes `subaccounts.optimiser_enabled` defaults to true on existing rows.** Migration 0267's `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT true` populates existing rows with `true` — confirmed correct Postgres semantics. But the backfill script in Chunk 3 still needs to SELECT WHERE `optimiser_enabled = true` (not assume "all rows are eligible"), because someone could have toggled the column before the backfill runs. Plan reflects this.

4. **The `subaccount_display_name` join in the GET endpoint** (spec §6.3 + §6.5) is not described at the SQL level. The plan in Chunk 1 lists "the hook joins to `subaccounts.name` server-side and returns the resolved string" but the actual SQL needs to LEFT JOIN `subaccounts ON subaccounts.id = scope_id AND scope_type = 'subaccount'`. RLS on `subaccounts` filters cross-org rows automatically. Confirm the column name is `subaccounts.name` (not `display_name`) before writing the route — read `server/db/schema/subaccounts.ts` to verify.

5. **Phase numbering.** `progress.md` originally listed 6 phases including a standalone "Phase 5 — Brand-voice / phrase classifier (~3h)". Spec §9 folded the tokeniser into Phase 1 (now this plan's Chunk 2). I have updated `progress.md` to reflect that fold (Phase 5 marked "folded into Phase 2") so the two stay aligned. The plan's chunk numbering is 1–5 (skipping 5-as-separate). If you'd rather keep 6 distinct phases for some external tracker, let me know and I'll add a Chunk 5 split between query-modules and tokeniser.

6. **The render-LLM call uses Sonnet via `llmRouter`.** Spec §9 Phase 2 says "Uses Sonnet (cheap, no need for Opus)". Confirm `llmRouter` exposes a Sonnet-tier alias (not just opaque routing) before relying on this — if the router picks the model for you and the optimiser run inadvertently lands on Opus, the cost model breaks. Chunk 3 should call out the model tier explicitly in the call options.

7. **The spec does not pin the exact ALS/principal-context shape for the optimiser run.** Optimiser runs are scheduled, so they have no initiating user. Per `SkillExecutionContext.userId`'s comment ("Undefined for scheduled / system runs"), this is expected. But canonical reads (per DEVELOPMENT_GUIDELINES §4) require `PrincipalContext` constructed via `fromOrgId(orgId, subaccountId)`. Chunk 3's orchestrator must construct this principal context before calling any `canonicalDataService` read. The plan does not currently call out this requirement explicitly — flag for Chunk 3 implementer to verify whether any optimiser query module reads through `canonicalDataService` (none should, per the telemetry sources in spec §3 — they all read raw tables — but verify).

8. **`server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` is the actual canonical dictionary file** (not `server/db/canonicalDictionary.ts` as the spec §6.1 suggests). The spec text is loose; the plan's file inventory uses the correct path. No spec amendment needed; just a discrepancy worth noting.

9. **Run-level render dedupe is already covered — do NOT add a separate `runSeenKeys` Set.** A reviewer may suggest "add an in-memory `runSeenKeys` set in the orchestrator before render to prevent duplicate LLM calls within a single run". The plan deliberately does NOT include this because the protection already exists on two layers:
   - The pg-boss `singletonKey: 'subaccount-optimiser:${subaccountId}:${agentId}'` (Chunk 3 AC-34) prevents two concurrent runs for the same sub-account regardless of trigger source. Manual `pgboss.send` invocations honour the same singletonKey when set on the queue, so a manual + scheduled collision is also blocked.
   - The 5000-entry LRU render cache keyed by `(category, dedupe_key, evidence_hash, render_version)` is shared across all candidates within a single run. Two candidates from different categories that happen to produce byte-equal evidence (rare but possible) hit the cache on the second lookup — one LLM call, two consumers.
   Adding `runSeenKeys` on top is redundant and creates a third truth-of-record for the same invariant. If the singletonKey contract is ever weakened, fix it at the singletonKey layer; do not add belt-and-braces guards that make the actual control plane harder to find.

10. **Render failure currently drops the candidate — known trade-off; do NOT add a `render_failed` column without spec amendment.** Chunk 3's error handling skips `output.recommend` when the render LLM call fails, with retry on the next daily run. A reviewer may suggest writing the row anyway with a generic title/body template plus a `render_failed=true` column. The plan deliberately does NOT take that path because: (a) it adds a new schema column and a new UI state for a failure mode that retries within 24 hours; (b) generic templates risk shipping non-actionable rows that erode operator trust in the surface; (c) the spec's cost model assumes render is the bottleneck — a fallback path would cache the failure and need its own invalidation rules. Cost of the current approach: a 24h delay on first appearance for a category whose render failed. Acceptable per the spec. Document this trade-off explicitly so future sessions don't re-litigate it as a "missing fallback".

11. **The primitive is intentionally NOT a full producer-registry / cross-agent-priority system in v1.** A reviewer may suggest extending the primitive with a producer registry, cross-agent priority weighting, and cross-agent dedupe. These are explicitly out of scope per spec §6.4 ("widget registry / layout engine framework — explicitly resisted"). The cap + eviction comparator + per-category material-delta predicates handle the v1 multi-producer story adequately when only the optimiser writes. If a second producer (Portfolio Health, system-monitoring, custom user agent) starts writing high volume in v1.1+, revisit: (a) per-producer cap shares; (b) cross-producer dedupe by `(scope, dedupe_key)` ignoring `producing_agent_id`; (c) priority weighting that considers producer trust score. None of those belong in this build.

12. **Evidence schema evolution is handled by the discriminated union, NOT a separate version column.** A reviewer may suggest adding `evidence_schema_version: number` to the row schema for future-proofing. The plan declines this because the `category` field IS the discriminator: adding a new field to an evidence shape means either (a) a new variant in the discriminated union with a new `category` value (old rows unaffected), or (b) bumping `RENDER_VERSION` and accepting that material-delta comparisons across the version boundary fall through to "treat as new" (which is correct behaviour for a meaningful schema change). A separate version column adds storage and a per-row branching point in `materialDelta` for a problem the existing primitives already solve. If a future schema change spans multiple categories simultaneously and needs coordinated rollout, add the version column then — not speculatively now.

13. **Dry-run mode is deferred to v1.1.** A reviewer may suggest adding `optimiser.run({ dryRun: true })` that returns the candidate set + decisions (would-write, would-evict, skip reasons) without persisting or calling LLM render. This would be useful for operator-triggered "show me what would happen" inspection and for debugging in production. The plan does NOT include it in v1 because: (a) the orchestrator test already exercises the decision logic with assertions, so the build-time confidence is there; (b) the structured log lines added per AC-8a / AC-31b cover most production debugging needs; (c) dry-run requires plumbing a flag through the skill executor, which is a small but non-zero change to a generic primitive. Add in v1.1 if production debugging proves painful or if an operator-facing "preview my optimiser run" UI surfaces. Implementation sketch: orchestrator accepts `dryRun: boolean` option; when true, calls `agentRecommendationsService.computeUpsertDecision(...)` (a new pure-ish function extracted from `upsertRecommendation` that returns the decision + would-write payload without executing the write) and skips render entirely (returning the candidate evidence in place of rendered title/body).

14. **Cross-category soft dedupe is deferred to v1.1.** A reviewer may suggest adding cross-category dedupe — if two categories produce the same `(dedupe_key, evidence_hash)` for the same scope, collapse them. The plan does NOT include this in v1 because category-scoped dedupe is the spec's design and cross-category collisions are rare (`dedupe_key` shapes per category are deliberately distinct: `agent.over_budget` uses `agent_id`, `playbook.escalation_rate` uses `workflow_id`, etc.). If post-rollout data shows operators seeing the same underlying issue surface twice through different categories, add a soft cross-category dedupe at write time then. Until that evidence exists, building it is speculation.

15. **Cold-start behaviour is implicit and correct — documenting so it's not re-discovered.** First run after deployment for a new sub-account: cost-aggregate query returns `[]` for any sub-account with < 2 months of cost data → no `over_budget` candidate (the query's date-window filter does the work). Peer-median view absent or stale on the very first deployment → AC-24a / AC-24b cause `skillLatency.ts` to return `[]` → no `skill.slow` candidate. Material-delta predicates compare `prev` (open-match row, may be null) vs `next` — when `prev=null`, the row is a fresh insert (`was_new=true`), no comparison happens. So insufficient-history sub-accounts simply produce fewer (or zero) candidates without errors. NO special "first-run mode" is needed; the empty-array signal IS the cold-start handling. Operators see the recommendation surface populate gradually as data accumulates, which is the correct UX. If post-rollout it's confusing that a brand-new sub-account has zero recommendations for the first 60+ days, consider adding a pinned dashboard banner ("Optimiser is collecting data; recommendations appear once 2 months of history exist") in v1.1 — but do NOT add it speculatively.

16. **Namespace storage in DB is a generic agent-registry concern, not optimiser scope.** A reviewer may suggest persisting each agent's namespace in a dedicated DB column at agent-registration time so the runtime validator reads from the snapshot rather than parsing AGENTS.md every time. This would isolate the optimiser from a hypothetical future agent-rename without breaking historical category prefixes. The plan does NOT add this because: (a) the `category` column on `agent_recommendations` already records the historical namespace per row at write time — renaming an agent's namespace doesn't break old rows; (b) the namespace-snapshot column is a multi-agent platform concern that should be solved once for all agents in a separate platform PR, not bolted on for the optimiser specifically; (c) the runtime validator reading AGENTS.md is consistent with how other agent metadata is loaded. If a renamed-agent breakage actually happens, the fix is one well-scoped platform PR — better than speculating now.

17. **Process-restart mid-run is handled by existing primitives — no `run_id` plumbing needed.** A reviewer may suggest tracking a `run_id` across pg-boss retries so a `recommendations.run_restarted` log line can fire when the same logical run resumes after a crash. The plan does NOT add this because: (a) the dedupe + open-match path naturally handles partial-then-resume — recommendations written by scans 1-3 of a crashed run will hit the `was_new=false` no-op path on the retry; (b) advisory-lock + transaction means a mid-write crash rolls back, so no orphan rows persist; (c) the `recommendations.run_summary` line (AC-31f) on the retry will look identical to a fresh first-run summary, which is the correct mental model. Adding `run_id` requires plumbing through pg-boss job state, which is heavier than the debug value warrants.

18. **50-subaccount load test is deferred to v1.1.** A reviewer may suggest a production-style load test simulating 50 sub-accounts firing simultaneously. The plan does NOT include it because: (a) the deterministic 6-hour cron stagger (AC-35a) means simultaneous-fire contention at any clock minute is essentially zero — at 100 sub-accounts spread across 360 minutes, the expected per-minute concurrency is 0.28 sub-accounts; (b) the per-run 60s budget (AC-31b), per-run candidate cap of 25 (AC-31c), and pinned LLM model (AC-31e) bound steady-state cost regardless of fleet size; (c) the 5-sub-account × 7-day cost sample in Chunk 5 covers the cost contract. A load test without realistic contention to find is busywork. If post-rollout production data shows advisory-lock contention or unexpected N+1 query patterns, build the load test then with the actual observed shapes.

---

*Plan finalised by `architect` agent on 2026-05-02; review-driven refinements applied across three rounds on 2026-05-02. Round 1 added: advisory-lock granularity pin, full canonicalisation rules, decision-branch observability, count-only `limit=0` short-circuit, peer-view staleness guard, deterministic per-sub-account cron, LRU sizing rationale, two new operator-facing open questions (per-category cap, repeat-dismissal suppression), three plan-time concerns (run-level dedupe clarification, render-failure trade-off, producer-registry boundary). Round 2 added: single-writer invariant via service.upsertRecommendation + static-analysis test, skip-reason exhaustiveness meta-test, render output validation with one retry, 60s per-run wall-clock budget, pre-write sort determinism assertion, freshness label sourced from `max(updated_at)`, action_hint shape validation at write, three deferred-to-v1.1 considerations (evidence schema versioning, dry-run mode, cross-category dedupe). Round 3 added: per-run candidate cap of 25, body-must-contain-digit render heuristic, run-summary log line via try/finally, OPTIMISER_DISABLED global kill switch, explicit LLM model + max_tokens + temperature pins (claude-sonnet-4-6, 300, 0.2), percent-bounds evaluator helper, four documentation-only plan-time concerns (cold-start, namespace storage, restart behaviour, load-test posture). Total estimate ~25 hours across 5 active chunks. Ready for Sonnet-driven `superpowers:executing-plans` / `subagent-driven-development` execution after the operator reviews and confirms (or overrides) the open architectural questions above. **PLAN LOCKED FOR BUILD.**
