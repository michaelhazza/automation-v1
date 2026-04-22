# CRM Query Planner — Development Spec v1

**Status:** Draft — handoff target is implementation after `spec-reviewer` pass.
**Branch:** `claude/crm-query-planner`
**Supersedes:** none. This is the first spec on this branch.
**Source brief:** `tasks/crm-query-planner-brief.md` (read that first for rationale; this spec is implementation-ready, the brief is architectural).
**Related:**
- `shared/types/briefResultContract.ts` + `docs/brief-result-contract.md` (committed contract; planner emits into this)
- `tasks/research-questioning-design-notes.md` (universal Brief surface, separate branch)
- `architecture.md` §Orchestrator Capability-Aware Routing (the layer this subordinates to)
- `docs/spec-authoring-checklist.md` (authoring checklist this spec was written against)

**Task class:** Significant — new service layer, new typed contracts, crosses multiple existing services. `spec-reviewer` required before implementation.

**Authored:** 2026-04-22

---

## Contents

1. Scope + non-goals
2. Closed decisions from brief §11 (what this spec locks in; what remains open)
3. Architectural overview
4. Data flow — end-to-end
5. File / module layout
6. Type contracts
7. Intent normalisation
8. Stage 1 — Registry-backed matcher
9. Stage 2 — Plan cache
10. Stage 3 — LLM planner
11. Stage 4 — Validator
12. Canonical executor + `canonicalQueryRegistry`
13. Live executor
14. Hybrid executor
15. Result normaliser + approval card generation
16. Governance integration (llmRouter, runCostBreaker, rate limiter, RLS)
17. Observability
18. API surface
19. Phased delivery plan
20. Test plan
21. Rollout + feature flags
22. Open questions for implementation
- **Deferred Items** — consolidated v1 exclusions with verdicts
23. Risks
24. Success criteria

---

## 1. Scope + non-goals

### 1.1 In scope (v1)

- A **CRM Query Planner service** (`server/services/crmQueryPlanner/`) that classifies free-text CRM data questions into `canonical | live | hybrid | unsupported` and routes to the correct executor.
- A 4-stage planner pipeline: Intent Normalisation → Stage 1 (Registry Matcher) → Stage 2 (Plan Cache) → Stage 3 (LLM Fallback) → Stage 4 (Validator). Stages 1 and 2 never call the LLM.
- A first-class `canonicalQueryRegistry` with 8 v1 entries (§12).
- A canonical executor wrapping `canonicalDataService` (with extensions for non-metric reads).
- A live executor wrapping `ghlAdapter` read helpers, read-only by structural import restriction.
- One hybrid pattern: `canonical_base_with_live_filter` (§14).
- A result normaliser that emits `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` per `shared/types/briefResultContract.ts`.
- One illustrative approval-card follow-up (`crm.send_email` targeting a **single contact** from the result set — see §15.4 for why v1 is one-contact-at-a-time).
- Governance wiring through existing primitives: `llmRouter.routeCall`, `runCostBreaker`, `getProviderRateLimiter`, `withPrincipalContext`. No new governance primitives.
- Observability events + derived metrics (§17).
- One skill + one route (§18) for agents / chat surface to invoke.

### 1.2 Out of scope (v1)

- Hybrid patterns beyond `canonical_base_with_live_filter`. Other hybrid queries return `unsupported_query` with refinement suggestions.
- Semantic / fuzzy plan-cache matching. Exact-match normalised-intent only.
- Query Memory Layer surfacing. Logging is captured v1; the promotion dashboard is a follow-on feature with its own brief.
- Non-GHL live executors (HubSpot, Salesforce, Pipedrive). Same planner layer, new adapters — later.
- Agent-facing `crm.schema_describe` diagnostic as a first-class skill. Schema is injected automatically at Stage 3.
- Export / saved-segment affordances from the result view (owned by Brief-surface branch).
- External MCP exposure of the planner.
- The universal Brief chat surface itself (separate branch).
- Free-text writes. All writes remain review-gated `crm.*` skills; the planner only emits read results and approval cards that point at existing structured skills.

### 1.3 Non-goals (durable)

These are the brief's non-goals, carried through:

- Replacing canonical ingestion. Canonical stays the record of truth for everything ClientPulse and reporting depend on.
- An internal MCP protocol hop to call our own adapters. The planner calls services directly.
- Provider-specific UX. The planner is CRM-shaped; every surface stays provider-neutral.
- Parity with external Claude-Code + MCP setups. We absorb the category by offering better governance, not by cloning UX.

---

## 2. Closed decisions from brief §11

The brief's §11 listed 12 open decisions for architect. This spec locks them as follows. Each decision is restated, the position is called out, and the rationale is given. Implementation follows these positions; any change requires updating the spec, not the code.

| § | Decision | Position (v1) | Why |
|---|---|---|---|
| 11.1 | Initial `canonicalQueryRegistry` entries | 8 entries as listed in brief §6.1 / this spec §12.2 | ClientPulse already covers these conceptually via canonical rollups; adds no new data modelling; mirrors the questions real operators ask |
| 11.2 | Hybrid v1 posture | One pattern: `canonical_base_with_live_filter` | Rejects "unsupported" becoming the common error; keeps scope bounded |
| 11.3 | `crm.schema_describe` helper | **Not shipped v1.** Automatic schema injection at Stage 3 is sufficient | Every call paying an extra round-trip for schema lookup is the wrong default |
| 11.4 | Validator scope | Field existence + operator sanity + date-range sanity + entity-relation validity + aggregation compatibility | Brief's full list. Tighter = catches more bad plans before executor; not so tight it rejects legitimate edge cases |
| 11.5 | Per-subaccount rate-limit budget | **Deferred.** `getProviderRateLimiter('ghl')` already queues fairly; add budget only when real traffic signals abuse | Defensive budgets without signal are premature optimisation |
| 11.6 | LLM tier escalation rules | Haiku default; Sonnet escalation on `confidence < 0.6`, hybrid path, or large post-filter schema; single retry, no loop | Matches brief §5.3. Retry loops are where cost leaks happen |
| 11.7 | Caching posture | Plan cache (exact-match normalised intent, 60s TTL). Result cache deferred | Plans are more stable than results; result caching has low hit rate for free-text |
| 11.8 | Approval-card follow-up scope | One end-to-end example: `crm.send_email` approval card for a **single contact** (the top row) from a contact result — one card per dispatchable action per §15.4 | Proves the wiring against the real `crm.send_email` schema; batch-email requires a new action slug (Deferred Items) |
| 11.9 | Observability surface | Full event set per brief §11.9 + `stageResolved` + derived metrics per §17 | Locked; feeds future Query Memory Layer |
| 11.10 | Contract drift check | Confirmed no drift: `shared/types/briefResultContract.ts` unchanged since 2026-04-22 merge | Re-verify at spec-reviewer time |
| 11.11 | Schema injection strategy | Entity-level summaries + top-N fields per entity + per-query filtering + per-subaccount cache keyed on `canonical_subaccount_mutations` version. Hard token budget: 2k default, 4k on escalation | Prevents bloat and hallucination |
| 11.12 | Query Memory Layer | **Logging only in v1.** Events shaped for future consumption; no surfacing | Surfacing is its own feature with its own brief |

### 2.1 Decisions still open for implementation-time discovery

These are *not* closed by this spec — they need real code context to resolve, and are flagged as `// TODO(spec-open-N)` comments in the implementation:

1. The exact alias list per `canonicalQueryRegistry` entry. Seed list in §12.2 is a starting point — pressure test (brief §13) will expand it.
2. The exact schema-context compression ratio per provider. 2k default may need tuning once real schemas are tried.
3. The `confidence < 0.6` threshold for escalation — may need tuning against real Stage 3 output distributions.

These do not block implementation; they are settled inside the first test pass.

---

## 3. Architectural overview

The planner is a single service with four internal stages, three executors, and one normaliser. It sits below the Orchestrator in the capability hierarchy (Orchestrator owns capability routing; Planner owns data-query routing for CRM reads). Every surface that reads CRM data — Brief chat, agent tool call, stopgap Ask CRM panel — calls the planner; no surface calls the provider adapters directly.

The planner is deterministic-first: Stages 1 and 2 never consult the LLM. The LLM is the Stage 3 fallback, invoked only when pattern matching and cache both miss. The validator is Stage 4 and is authoritative — LLM output is advisory. Each query resolves to exactly one validated QueryPlan; no parallel candidate plans.

See §6 for type contracts and §7–§11 for per-stage behaviour.

---

## 4. Data flow — end-to-end

```text
User / agent emits intent → Brief chat surface
                              ↓
                    POST /api/crm-query-planner/query
                    Body: { rawIntent, subaccountId, briefId? }
                    Principal (organisationId, userId, runId?) derived from `authenticate` middleware, never accepted from the body
                              ↓
             ┌───────────────────────────────────────┐
             │  normaliseIntent(rawIntent)           │
             │  → NormalisedIntent { hash, tokens, …}│
             └───────────────────────────────────────┘
                              ↓
     ┌─────────────────────── Stage 1 ─────────────────────────┐
     │  canonicalQueryRegistry.lookupByAlias(normalised)        │
     │  hit → QueryPlan { source: 'canonical', stageResolved:1 }│
     │  miss → next                                             │
     └──────────────────────────────────────────────────────────┘
                              ↓
     ┌─────────────────────── Stage 2 ─────────────────────────┐
     │  planCache.get(normalised.hash, subaccountId)            │
     │  hit → QueryPlan (loaded, stageResolved: 2)              │
     │  miss → next                                             │
     └──────────────────────────────────────────────────────────┘
                              ↓
     ┌─────────────────────── Stage 3 ─────────────────────────┐
     │  schemaContext = buildSchemaContext(subaccountId, hints) │
     │  response = await llmRouter.routeCall({                  │
     │    messages: buildPrompt(intent, schemaContext),         │
     │    context: {                                            │
     │      organisationId, subaccountId, runId,                │
     │      sourceType: 'system',                               │
     │      taskType: 'crm_query_planner',                      │
     │      featureTag: 'crm-query-planner',                    │
     │      model: resolvePlannerTier(orgId, escalate:false),   │
     │      systemCallerPolicy: 'bypass_routing',               │
     │    },                                                    │
     │    postProcess: (c) => DraftQueryPlanSchema.parse(       │
     │      JSON.parse(c)),                                     │
     │  })                                                      │
     │  draft = DraftQueryPlanSchema.parse(                      │
     │    JSON.parse(response.content))                         │
     │  → DraftQueryPlan { confidence, canonicalCandidateKey, … }│
     │  if confidence < ESCALATION_THRESHOLD → one retry at     │
     │  escalated tier; no further retries                      │
     └──────────────────────────────────────────────────────────┘
                              ↓
     ┌─────────────────────── Stage 4 ─────────────────────────┐
     │  validateQueryPlan(draft, schemaContext, registry)       │
     │  • field / operator / entity / aggregation checks         │
     │  • canonical-precedence tie-breaker                      │
     │  • hybrid-pattern shape check                            │
     │  pass → QueryPlan { stageResolved: 3, validated: true }  │
     │  fail → BriefErrorResult { code: 'ambiguous_intent' }    │
     │  On pass: planCache.set(normalised.hash, plan)           │
     └──────────────────────────────────────────────────────────┘
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
     canonicalExecutor   liveExecutor   hybridExecutor
              ↓               ↓               ↓
              └───────────────┼───────────────┘
                              ↓
             ┌────────────────┴───────────────┐
             │  resultNormaliser(execResult)  │
             │  → BriefStructuredResult       │
             │    + optional BriefApprovalCard│
             └────────────────────────────────┘
                              ↓
                        Response to caller
```

Emitted artefacts match `shared/types/briefResultContract.ts` exactly. The response shape is one `BriefStructuredResult` plus zero-to-N `BriefApprovalCard` suggestions, or one `BriefErrorResult` if any stage failed.

---

## 5. File / module layout

Every file below is new unless marked `[existing — extend]`. All TypeScript; all pure modules have a sibling `*Pure.test.ts` per the repo convention.

```
server/
├── services/
│   └── crmQueryPlanner/
│       ├── index.ts                            # Public facade: runQuery(intent, context)
│       ├── crmQueryPlannerService.ts           # Orchestration (4-stage pipeline)
│       ├── normaliseIntentPure.ts              # §7 — shared normaliser utility
│       ├── registryMatcherPure.ts              # §8 — Stage 1 deterministic matcher
│       ├── planCache.ts                        # §9 — Stage 2 in-process cache
│       ├── planCachePure.ts                    # §9 — pure key / eviction logic
│       ├── llmPlanner.ts                       # §10 — Stage 3 LLM fallback
│       ├── llmPlannerPromptPure.ts             # §10 — prompt assembly (pure)
│       ├── validatePlanPure.ts                 # §11 — Stage 4 validator
│       ├── schemaContextService.ts             # §11.11 — schema summarisation + cache
│       ├── schemaContextPure.ts                # §11.11 — compression / filtering (pure)
│       ├── executors/
│       │   ├── canonicalExecutor.ts            # §12 — registry-backed
│       │   ├── canonicalQueryRegistry.ts       # §12 — registry of 8 v1 entries
│       │   ├── liveExecutor.ts                 # §13 — ghlAdapter-backed, read-only
│       │   └── hybridExecutor.ts               # §14 — canonical_base_with_live_filter only
│       ├── resultNormaliser.ts                 # §15 — QueryPlan + executor result → Brief artefact
│       ├── resultNormaliserPure.ts             # §15 — pure envelope construction
│       ├── approvalCardGeneratorPure.ts        # §15 — follow-up action detection
│       ├── plannerEvents.ts                    # §17 — structured event emission
│       ├── plannerCostPure.ts                   # §16.2.1 — single cost calculator (token usage → BriefCostPreview)
│       └── __tests__/
│           ├── normaliseIntentPure.test.ts
│           ├── registryMatcherPure.test.ts
│           ├── planCachePure.test.ts
│           ├── llmPlannerPromptPure.test.ts
│           ├── validatePlanPure.test.ts
│           ├── schemaContextPure.test.ts
│           ├── resultNormaliserPure.test.ts
│           ├── approvalCardGeneratorPure.test.ts
│           ├── plannerCostPure.test.ts           # §16.2.1 — token-usage → BriefCostPreview derivation
│           ├── canonicalQueryRegistry.test.ts
│           ├── liveExecutor.test.ts            # §13.6 — plan-to-provider translation + rate-limit lifecycle (mocked ghlReadHelpers)
│           ├── hybridExecutor.test.ts          # §14.4 — canonical+live merge + 10-call cap (mocked executors)
│           ├── crmQueryPlannerService.test.ts  # §20.2 — orchestration with mocked registry/cache/llmRouter/executors/runCostBreaker
│           └── integration.test.ts             # §20.2 — RLS isolation only; uses existing rls.context-propagation.test.ts harness
├── services/
│   ├── canonicalDataService.ts                 # [existing — extend] add non-metric reads
│   ├── systemPnlService.ts                     # [existing — extend in P3] add planner metrics subsection
│   ├── systemSettingsService.ts                # [existing — extend] add planner-related rows (§21.2) to the `SETTING_KEYS` allowlist so the new keys can be written/read through the existing settings path
│   └── adapters/
│       └── ghlReadHelpers.ts                   # [existing — extend in P2] add `listGhlOpportunities`, `listGhlAppointments`, `listGhlConversations`, `listGhlTasks` to cover the v1 live-query surface (§13.1 dispatcher). Current exports cover contacts / users / automations / from-addresses / from-numbers only; the additions land in P2 with the live executor
├── routes/
│   └── crmQueryPlanner.ts                      # §18 — POST /api/crm-query-planner/query
├── config/
│   └── actionRegistry.ts                       # [existing — extend] register `crm.query` skill
├── index.ts                                    # [existing — extend] mount `/api/crm-query-planner/query` route on the express app (§18)
└── db/schema/
    ├── llmRequests.ts                          # [existing — extend] add `'crm_query_planner'` to the `TASK_TYPES` const array (no DB-level schema change — TS const only; §10.1)
    └── (no tables / columns added in v1)       # Plan cache is in-memory; see §9

scripts/
├── verify-crm-query-planner-read-only.sh      # §13.3 / §16.6 — static gate: no write-helper imports under executors/
└── run-all-gates.sh                            # [existing — extend] append the new verify script to the aggregate gate runner

shared/
└── types/
    ├── briefResultContract.ts                  # [existing — no changes]
    └── crmQueryPlanner.ts                      # §6 — QueryPlan, registry, events, mapOperatorForWire

client/
└── src/pages/
    └── SystemPnlPage.tsx                       # [existing — extend in P3] render planner metrics subsection

tasks/builds/crm-query-planner/
└── pressure-test-results.md                    # §20.3 — created during P2 pressure-test pass
```

### 5.1 Reasons for this layout

- **Pure / impure split** mirrors the rest of the server. Every planner stage's decision logic is pure (`*Pure.ts`) and unit-tested in isolation; the imperative wrappers (adapter calls, cache mutations, router calls) own side effects.
- **`crmQueryPlanner/` subdirectory** keeps the 18 new files together without polluting `server/services/` root. The pattern matches `server/services/workspaceHealth/` (eight detector files under one dir).
- **Registry under `executors/`** because the registry is only consumed by the canonical executor and Stage 1 matcher. Other registries that cross broader surfaces (e.g. `actionRegistry`) live in `server/config/`; this one doesn't.
- **No new DB tables v1.** Plan cache is in-process (§9). Observability events flow into existing run-trace infrastructure (§17).
- **Client changes scoped to P3.** P1/P2 add no client files. P3 extends the existing `SystemPnlPage.tsx` with the planner-metrics subsection (§19 P3). The Brief surface branch (separate branch) renders `BriefStructuredResult` already; the planner produces exactly that.

---

## 6. Type contracts

All types defined in `shared/types/crmQueryPlanner.ts` so both server and (future) client consume the same shapes. TypeScript strict mode assumed (already set repo-wide).

### 6.1 Normalised intent

```ts
export interface NormalisedIntent {
  hash: string;                    // stable key for cache + registry lookups
  tokens: string[];                // lowercased, stop-word stripped, synonym-collapsed
  rawIntent: string;               // preserved for logging + error responses
}
```

Purity: `normaliseIntent` returns only these fields — no clock stamp, no side-effects (see §7.4). If the service layer needs a diagnostic timestamp (e.g. for cache-freshness logs), it is stamped outside the pure function at the call-site.

**Hash derivation:** `sha256(tokens.join(' ')).slice(0, 16)`. Sixteen hex chars = 64 bits of entropy, collision-safe for any realistic cache size.

### 6.2 QueryPlan

```ts
export type QuerySource = 'canonical' | 'live' | 'hybrid';

// Matches the wire contract `BriefResultSource` exactly. Unsupported queries
// never reach the executor — the planner surfaces them as a `BriefErrorResult`
// with `errorCode: 'unsupported_query'` (see §15.1). Keeping `QuerySource` tight
// prevents §15.2 from ever copying an invalid wire value into a
// `BriefStructuredResult.source` field.

export type QueryIntentClass =
  | 'list_entities'
  | 'count_entities'
  | 'aggregate'
  | 'lookup'
  | 'trend_request'
  | 'segment_request'
  | 'unsupported';  // planner-internal — never emitted on the wire; routes to `BriefErrorResult`

export type PrimaryEntity =
  | 'contacts'
  | 'opportunities'
  | 'appointments'
  | 'conversations'
  | 'revenue'
  | 'tasks';

// Matches the wire contract `BriefResultEntityType` exactly (minus 'runs' and
// 'other', which are non-CRM surfaces owned by other features). Tag-related
// queries use `primaryEntity: 'contacts'` with tag grouping — see the
// `contacts.count_by_tag` registry entry in §12.2.

export type StageResolved = 1 | 2 | 3;

export interface QueryFilter {
  field: string;
  operator: 'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte'
          | 'contains' | 'starts_with' | 'is_null' | 'is_not_null'
          | 'between';
  value: unknown;
  humanLabel: string;              // for filtersApplied rendering
}

// Wire translation — `BriefResultFilter.operator` is a string per the
// committed contract, but its doc-comment documents the set
// `eq | neq | gt | gte | lt | lte | in | contains | between | exists`.
// Three planner-internal operators don't round-trip cleanly:
//   - `ne`          → 'neq'         (spelling drift)
//   - `is_null`     → 'exists' with value=false
//   - `is_not_null` → 'exists' with value=true
// `nin` and `starts_with` are emitted as-is (wire type is `string`, additive);
// consumers ignore unknown values per the contract's "additive changes" rule.
// The result normaliser (§15.2) MUST route every `QueryFilter.operator` through
// `mapOperatorForWire` before populating `BriefResultFilter.operator`; no other
// code path should copy operators through.

export function mapOperatorForWire(op: QueryFilter['operator']):
  { operator: string; value?: unknown } {
  switch (op) {
    case 'ne':          return { operator: 'neq' };
    case 'is_null':     return { operator: 'exists', value: false };
    case 'is_not_null': return { operator: 'exists', value: true };
    default:            return { operator: op };
  }
}

export interface QueryPlan {
  source: QuerySource;
  intentClass: QueryIntentClass;
  primaryEntity: PrimaryEntity;
  relatedEntities?: PrimaryEntity[];
  filters: QueryFilter[];
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit: number;
  projection?: string[];
  aggregation?: {
    type: 'count' | 'sum' | 'avg' | 'group_by';
    field?: string;
    groupBy?: string[];
  };
  dateContext?: {
    kind: 'relative' | 'absolute';
    from?: string;                 // ISO 8601
    to?: string;
    description?: string;
  };
  canonicalCandidateKey: string | null;    // registry key if canonical-promotable
  confidence: number;              // 0..1; always 1.0 for Stages 1 & 2
  stageResolved: StageResolved;
  hybridPattern?: 'canonical_base_with_live_filter';  // v1 sole pattern
  costPreview: BriefCostPreview;   // from shared/types/briefResultContract.ts
  validated: true;                 // literal — present only after Stage 4
}

export interface DraftQueryPlan extends Omit<QueryPlan, 'validated' | 'stageResolved' | 'costPreview'> {
  // Shape Stage 3 emits before validation. `costPreview` is NOT on the draft
  // — the LLM must not emit planner-derived cost; `crmQueryPlannerService`
  // fills it post-parse via `computePlannerCostPreview` (§16.2.1).
  clarificationNeeded?: boolean;
  clarificationPrompt?: string;
}
```

**Why the `validated: true` literal:** prevents unvalidated draft plans from reaching the executor by TypeScript compile-time check. The executor signature is `(plan: QueryPlan) => Promise<ExecutorResult>` — a `DraftQueryPlan` cannot be passed in without explicit widening, which no production code path does.

### 6.3 Canonical query registry

```ts
export interface CanonicalQueryRegistryEntry {
  key: string;                                   // 'contacts.inactive_over_days'
  aliases: string[];                             // normalised-intent strings Stage 1 matches against
  primaryEntity: PrimaryEntity;
  requiredCapabilities: string[];                // e.g. ['canonical.contacts.read'] — enforced by canonicalExecutor (§12.1)
  handler: CanonicalQueryHandler;
  description: string;                           // for docs and diagnostics

  // Static field/operator map used by the Stage 1 reduced validator subset
  // (§8.3). Keyed on canonical field name; value declares the operators
  // legal for that field. Declared inline per entry — does NOT depend on
  // the runtime `schemaContext` that Stage 3 uses. Lets Stage 1 run in P1
  // before `schemaContextService` ships in P2.
  allowedFields: Record<string, {
    operators: readonly QueryFilter['operator'][];
    projectable: boolean;                        // true if the field can appear in `projection[]`
    sortable: boolean;                           // true if the field can appear in `sort[].field`
  }>;

  // Parses free-text args out of the normalised intent into typed filters /
  // dateContext / limit / sort / projection. Pure. Returns null if the intent
  // is an alias match but the args could not be parsed — caller falls through
  // to Stage 2 (see §8.3). Invoked only by the Stage 1 matcher.
  parseArgs?: (intent: NormalisedIntent) => ParsedArgs | null;
}

export interface ParsedArgs {
  filters?: QueryFilter[];
  dateContext?: QueryPlan['dateContext'];
  limit?: number;
  sort?: QueryPlan['sort'];
  projection?: string[];
}

export interface CanonicalQueryHandlerArgs {
  orgId: string;
  subaccountId: string;
  filters: QueryFilter[];
  dateContext?: QueryPlan['dateContext'];
  limit: number;
  sort?: QueryPlan['sort'];
  projection?: string[];
}

export type CanonicalQueryHandler = (
  args: CanonicalQueryHandlerArgs
) => Promise<ExecutorResult>;

export type CanonicalQueryRegistry = Readonly<Record<string, CanonicalQueryRegistryEntry>>;
```

### 6.4 Executor result (internal — not on the wire)

```ts
export interface ExecutorResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  truncationReason?: 'result_limit' | 'cost_limit' | 'time_limit';
  actualCostCents: number;
  source: QuerySource;             // echoed for provenance
  providerLatencyMs?: number;      // for live / hybrid only
}
```

### 6.5 Plan cache entry

```ts
export interface PlanCacheEntry {
  plan: QueryPlan;
  cachedAt: number;                // epoch ms
  subaccountId: string;            // part of cache key
  hits: number;                    // for Query Memory Layer later
}
```

### 6.6 Planner events

```ts
export type PlannerEventKind =
  | 'planner.stage1_matched'
  | 'planner.stage1_missed'
  | 'planner.stage2_cache_hit'
  | 'planner.stage2_cache_miss'
  | 'planner.stage3_parse_started'
  | 'planner.stage3_parse_completed'
  | 'planner.stage3_escalated'
  | 'planner.validation_failed'
  | 'planner.classified'
  | 'planner.executor_dispatched'
  | 'planner.canonical_promoted'
  | 'planner.result_emitted'
  | 'planner.error_emitted';

export interface PlannerEvent<K extends PlannerEventKind = PlannerEventKind> {
  kind: K;
  at: number;
  orgId: string;
  subaccountId: string;
  runId?: string;
  intentHash: string;
  payload: Record<string, unknown>;   // per-kind shape documented in §17
}
```

All emitted through `plannerEvents.emit(event)` which forwards to structured logs and the run-trace event stream (§17).

---

## 7. Intent normalisation

**File:** `server/services/crmQueryPlanner/normaliseIntentPure.ts`

Shared utility consumed by **both** Stage 1 (matcher) and Stage 2 (cache). Single source of truth for how raw intent text maps to a `NormalisedIntent` — enforced by both stages importing this function only.

### 7.1 Algorithm

```ts
export function normaliseIntent(rawIntent: string): NormalisedIntent {
  // 1. lowercase
  // 2. strip punctuation except digits and '-' in "30-day" style
  // 3. collapse whitespace to single spaces
  // 4. tokenise on whitespace
  // 5. remove stop words (see STOP_WORDS below)
  // 6. apply synonym canonicalisation (see SYNONYMS below)
  // 7. sort-stabilise date literals: "last 30 days" / "30 days ago" / "past month" → "last_30d"
  // 8. compute hash = sha256(tokens.join(' ')).slice(0,16)
}
```

### 7.2 Stop words (v1 list)

`a, an, the, is, are, was, were, to, of, for, on, in, at, by, with, me, my, our, show, get, find, list`

Conservative list. Intent-bearing words (`all`, `only`, `without`, `not`) are kept.

### 7.3 Synonyms (v1 map)

```ts
const SYNONYMS: Record<string, string> = {
  'deals': 'opportunities',
  'deal': 'opportunities',
  'leads': 'contacts',
  'lead': 'contacts',
  'customer': 'contacts',
  'customers': 'contacts',
  'client': 'contacts',
  'clients': 'contacts',
  'pipeline': 'opportunities',
  'inactive': 'stale',
  'dormant': 'stale',
  'idle': 'stale',
  'upcoming': 'future',
  // ... seed list; pressure test expands
};
```

The synonym map is the primary lever for Stage 1 hit rate. The pressure test in §20.3 identifies missing synonyms; they're added here.

### 7.4 Determinism invariants

- Same input → same output. No randomness, no clock dependency — `NormalisedIntent` has no timestamp field (see §6.1). Diagnostic timestamps, if needed, are stamped outside the pure function by the service layer.
- Pure function. No side effects. No external state. Enables full unit-test coverage.
- Order of synonym application is deterministic (single pass in insertion order). No rule can override a prior rule within the same call.

### 7.5 Test plan (pure)

`normaliseIntentPure.test.ts` — minimum 15 cases:

- 3 identity cases (already-normalised input)
- 3 whitespace / casing variants produce identical hash
- 3 synonym replacements work bidirectionally (original + alias produce same hash)
- 3 stop-word stripping cases
- 3 date-literal canonicalisation cases

---

## 8. Stage 1 — Registry-backed matcher

**File:** `server/services/crmQueryPlanner/registryMatcherPure.ts`
**Stage contract:** given a `NormalisedIntent` + the `canonicalQueryRegistry` + the caller's `PrincipalContext`, return a `QueryPlan` or `null`. The principal context is required because the Stage 1 reduced validator subset (§8.3) runs Rule 9 (projection overlap) and Rule 10 (per-entry capability check), both of which are caller-specific. Stage 1 cannot be pure over `(intent, registry)` alone.

### 8.1 Algorithm

```ts
export function matchRegistryEntry(
  intent: NormalisedIntent,
  registry: CanonicalQueryRegistry
): QueryPlan | null {
  // 1. Build alias index (memoised; see §8.2)
  // 2. Look up intent.hash in alias index → registry key
  // 3. If found, construct a QueryPlan with:
  //    - source: 'canonical'
  //    - stageResolved: 1
  //    - canonicalCandidateKey: <registry key>
  //    - confidence: 1.0
  //    - validated: true  (Stage 1 hits skip Stage 4 — see §8.3)
  //    - filters/dateContext: extracted from the raw intent via per-entry parsers
  // 4. If not found, return null
}
```

### 8.2 Alias index construction

```ts
function buildAliasIndex(
  registry: CanonicalQueryRegistry
): Map<string, string /* registry key */> {
  const index = new Map();
  for (const [key, entry] of Object.entries(registry)) {
    for (const alias of entry.aliases) {
      const aliasHash = normaliseIntent(alias).hash;
      if (index.has(aliasHash)) {
        throw new Error(`Alias collision: "${alias}" in ${key} conflicts with ${index.get(aliasHash)}`);
      }
      index.set(aliasHash, key);
    }
  }
  return index;
}
```

Built once at module load and cached in a module-level `WeakMap<CanonicalQueryRegistry, Map<string, string>>`. Collision throw at build prevents two entries claiming the same normalised alias (caught at startup, not runtime).

### 8.3 Stage 1 hits run a reduced validator subset

A Stage 1 match is mostly structurally valid — the registry entry names the `primaryEntity`, the handler is typed, and the intent was deterministically matched. Most of Stage 4's rules (entity existence, operator sanity on registry-fixed filters, entity-relation validity, aggregation compatibility, hybrid-pattern check, canonical-precedence tie-breaker) are trivially satisfied and skipped.

But the `parseArgs` hook extracts filters / projection / sort / dateContext from free-text intent — those *are* user-derived and MUST pass:

- **Rule 2 — field existence** for any `parseArgs`-produced `filters[].field`, `sort[].field`, and `projection[]` entry, against the **registry entry's `allowedFields`** map (a static per-entry list of canonical field names, declared on `CanonicalQueryRegistryEntry.allowedFields`; see §6.3). This is a **P1 static map**, not `schemaContext` — `schemaContext` / `schemaContextService` ship in P2 and are not available at P1.
- **Rule 3 — operator sanity** for any `parseArgs`-produced filter, using the registry entry's static operator-per-field map (also on the registry entry). Pure.
- **Rule 9 — projection overlap** (read-permission check) for any `parseArgs`-produced projection field, against the same `allowedFields` map filtered by caller capabilities (`CanonicalQueryRegistryEntry.requiredCapabilities` defines the read scope).

These three rules run via `validatePlanPure` in "stage1_mode" (the validator takes a mode flag that scopes it to the subset above and swaps `schemaContext` for the registry-entry static maps). If any fail, the Stage 1 result is discarded and the caller falls through to Stage 2. If `parseArgs` itself returns `null`, Stage 1 also falls through.

Stage 1 is still the zero-LLM fast path; the reduced-validator-subset is pure, cheap, and ships entirely in P1 without any Stage 3 / Stage 4 schema-context dependency. It closes the gap that would otherwise let a badly-parsed alias dispatch a plan referencing a nonexistent field.

### 8.4 Test plan (pure)

`registryMatcherPure.test.ts`:

- For every registry entry (§12.2), every listed alias (35 total) produces a hit. One test case per alias.
- Alias-collision detection fires at index build time
- Empty / malformed intent returns null
- Intent that normalises to a non-aliased hash returns null
- QueryPlan emitted has `validated: true` and `stageResolved: 1`

Total: ~40 cases (35 alias hits + ~5 edge cases). The §20.1 summary row uses the same count; keep the two in sync when the alias list grows.

---

## 9. Stage 2 — Plan cache

**Files:** `server/services/crmQueryPlanner/planCache.ts` + `planCachePure.ts`
**Stage contract:** given a `NormalisedIntent` hash + subaccountId, return a cached `QueryPlan` or `null`.

### 9.1 Cache shape

In-process `Map<string /* cacheKey */, PlanCacheEntry>`. Key format:

```ts
const cacheKey = (hash: string, subaccountId: string) => `${subaccountId}:${hash}`;
```

Subaccount scoping prevents cross-subaccount cache pollution (two subaccounts with identical intents may have different schema shapes, so plans differ).

### 9.2 Eviction policy

- **TTL:** 60 seconds from `cachedAt`. Mirrors `crmLiveDataService` picker cache convention.
- **Max entries:** 500 per process. LRU eviction on overflow. Matches picker cache.
- **Overwrite:** most-recent-wins. A successful validation always overwrites any prior entry for the same key.
- **Invalidation on schema change:** **not in v1.** The 60s TTL is short enough that schema-drift will flush through within one cache generation. Schema-change-driven flush (listening for `canonical_subaccount_mutations` version bumps) is tracked in the Deferred Items section as a v2 concern.

### 9.3 Cache-write rules

- **Only validated plans** (`stageResolved === 3`) are written to cache. Stage 1 hits are already free and don't need caching. Stage 2 hits don't re-cache (the entry is already present).
- Cache write happens inside the validator's success path, not inside the LLM planner, so a Stage 3 plan that fails validation is never cached.

### 9.3.1 Cache hits rerun per-principal validation rules

Plan cache is keyed on `(subaccountId, intentHash)` only; it is **not** scoped per principal. That keeps hit-rate high but means a cached plan that was validated for principal A's field visibility must NOT be reused wholesale for principal B in the same subaccount — B might have narrower `canonical.<entity>.read` capability.

On every cache hit the service reruns the subset of validator rules that depend on the caller's principal (not on the plan's shape):

1. **Rule 9 — projection overlap** — every `plan.projection[]` field must be permitted for `plan.primaryEntity` under the caller's principal context (same check Stage 4 runs post-LLM).
2. **Rule 10 — per-entry capability check** — caller must still possess every capability in `registry[plan.canonicalCandidateKey].requiredCapabilities` (canonical / hybrid plans).

If either fails, the cache hit is **discarded** (not evicted — the entry remains for other principals) and the caller falls through to Stage 3. The plan itself is not mutated. The two rules are pure functions over `(plan, principalContext, registry)`; no extra LLM cost and no extra DB round-trip beyond what §16.4's `withPrincipalContext` nesting already incurs.

The checks are co-located on `planCache.get(...)` — callers never receive a plan they aren't authorised for, and the service's Stage 2 hit path emits `planner.stage2_cache_hit` only after the post-hit rules pass (a discarded hit emits `planner.stage2_cache_miss` with a `reason: 'principal_mismatch'` payload field).

**Invariant — cache never bypasses validation.** Any validator rule whose output depends on the caller's principal reruns on every cache hit. Non-principal rules (field existence against the plan's own shape, operator sanity, entity-relation validity, aggregation compatibility, hybrid-pattern shape, canonical-precedence tie-breaker) are safe to skip because their inputs were fully captured at cache-write time and cannot change between put and get — the plan's shape is frozen once cached. **Future validator rules must be classified as principal-dependent or plan-dependent at the time they are added; principal-dependent rules join the rerun list in §9.3.1. This classification is mandatory when any new rule is added to §11.2** — the spec update that adds the rule also updates §9.3.1 and §8.3 to reflect whether the rule runs on cache hit and in Stage 1's reduced subset.

### 9.4 Future alignment with Query Memory Layer (brief §11.12)

The `PlanCacheEntry` includes a `hits` counter incremented on every cache hit. Combined with eviction, this forms the dataset the Query Memory Layer will consume for "top N live queries → canonical promotion candidates" analytics (brief §11.12). No v1 surfacing — the counter exists solely so v2 has the data.

### 9.5 Test plan (pure)

`planCachePure.test.ts`:

- Cache put + get round-trip produces identical plan
- Entry expiry at `cachedAt + TTL_MS` returns null
- LRU eviction fires at 501st entry; oldest-accessed entry evicted
- Overwrite updates `cachedAt` and resets `hits`
- Cross-subaccount isolation: same hash, different subaccount → two entries, no collision

---

## 10. Stage 3 — LLM planner

**Files:** `server/services/crmQueryPlanner/llmPlanner.ts` + `llmPlannerPromptPure.ts`
**Stage contract:** given a `NormalisedIntent` + `SchemaContext` + `BriefCostPreview` budget, return a `DraftQueryPlan` or throw.

### 10.1 Router call

```ts
const response: ProviderResponse = await llmRouter.routeCall({
  messages: buildPrompt(intent, schemaContext),    // §10.2
  context: {
    organisationId,                                // renamed from orgId — matches LLMCallContextSchema
    subaccountId,
    runId,
    sourceType: 'system',
    taskType: 'crm_query_planner',                 // new enum value — adds one row to TASK_TYPES in server/db/schema/* (§5 lists the schema file)
    featureTag: 'crm-query-planner',
    model: resolvePlannerTier(orgId, escalate),    // §10.3 — `context.model`, not a top-level router arg
    systemCallerPolicy: 'bypass_routing',          // planner pins its own tier per org config; valid values are 'respect_routing' | 'bypass_routing'
  },
  postProcess: (content) => { DraftQueryPlanSchema.parse(JSON.parse(content)); },
                                                   // `postProcess` receives the raw response string; throw `ParseFailureError` on bad JSON/shape so the router records status='parse_failure'
  abortSignal,
});
const draft: DraftQueryPlan = DraftQueryPlanSchema.parse(JSON.parse(response.content));
```

`llmRouter.routeCall` returns a `ProviderResponse` with a string `.content` field (see `server/services/providers/types.ts`). The planner parses that content into `DraftQueryPlan`. `postProcess` runs inside the router for ledger attribution; the explicit re-parse after the call gives the planner the typed object for downstream use — both use the same `DraftQueryPlanSchema`, so there is one authority for the response shape.

Routing through `llmRouter.routeCall` is **mandatory** — the repo-wide gate (`verify-no-direct-adapter-calls.sh`) blocks direct provider imports. The planner is not allowed to bypass this.

### 10.2 Prompt shape

`buildPrompt(intent, schemaContext)` is a pure function in `llmPlannerPromptPure.ts`. Structure:

```
SYSTEM:
  You are a CRM Query Planner. Convert the user's intent into a structured QueryPlan.

  Rules:
  - Prefer canonical sources when the question matches one of the canonical registry keys below.
  - For hybrid questions, set source='hybrid' ONLY if it matches the v1 pattern:
    one canonical base + one live filter refinement.
  - For questions outside the registry and not matching the hybrid pattern,
    set source='live'.
  - For questions that cannot be expressed within the available entities/fields,
    set intentClass='unsupported' and include a clarificationPrompt. Leave
    `source` set to the closest plausible value (typically 'live'); the service
    treats `intentClass: 'unsupported'` as the terminal signal and short-circuits
    to a `BriefErrorResult` before executor dispatch, so the `source` value on
    an unsupported plan is never read.

  Always include a confidence score (0..1). Low confidence triggers escalation.

  CANONICAL REGISTRY:
  {{registryKeysWithDescriptions}}

  AVAILABLE SCHEMA (filtered for relevance):
  {{schemaContext.compressed}}

  RESPONSE FORMAT (JSON):
  {{DraftQueryPlanSchema}}

USER:
  {{intent.rawIntent}}
```

Prompt is assembled as a single system + user message pair. No few-shot examples in v1 (keeps tokens lean; pressure test §20.3 determines if any are needed).

### 10.3 Tier resolution

`resolvePlannerTier` returns a **concrete provider/model string** (e.g. `'claude-haiku-4-5'`, `'claude-sonnet-4-6'`) — not an abstract tier name. `llmRouter.routeCall` in `bypass_routing` mode expects a concrete model identifier in `context.model`; it does not resolve tiers.

```ts
function resolvePlannerTier(orgId: string, escalate: boolean): string {
  const config = loadOrgPlannerConfig(orgId);  // org-level override, else system default
  return escalate ? config.escalation_model : config.default_model;
}
```

**System defaults** (in `systemSettings` table; the values stored are the same provider/model strings the router passes to the adapter registry — `claude-haiku-4-5` and `claude-sonnet-4-6` are the current v1 defaults; the key names retain the legacy `_tier` suffix to match the rows already planned for `SETTING_KEYS` in §21.2):

```ts
{
  crm_query_planner_default_tier:       'claude-haiku-4-5',
  crm_query_planner_escalation_tier:    'claude-sonnet-4-6',
  crm_query_planner_confidence_threshold: 0.6,
}
```

Per-org overrides live in `organisation_hierarchies.operational_config.crm_query_planner` if present. Values are always concrete model strings, never abstract tier tokens.

### 10.4 Escalation (single retry, never a loop)

```ts
const draft1 = await runLlmPlanner({ ..., escalate: false });
if (draft1.confidence >= threshold || draft1.source === 'canonical' /* always escalate-safe */) {
  return draft1;
}
const draft2 = await runLlmPlanner({ ..., escalate: true });
return draft2;  // No further retry — validator will reject if still bad
```

Hybrid-path detection also auto-escalates:

```ts
if (detectLikelyHybrid(intent, schemaContext)) {
  return runLlmPlanner({ ..., escalate: true });  // Skip Stage 3 at default tier
}
```

`detectLikelyHybrid` is a simple heuristic (intent references both a canonical-known entity and a live-only field). Cheap pre-check; avoids an escalation round-trip.

**Retry contract — explicit invariant.** Stage 3 issues **at most two LLM calls per request**: one initial parse at the default tier, plus at most one escalation retry at the escalated tier. Escalation is triggered only by (a) `confidence < threshold` on the initial parse, (b) the `detectLikelyHybrid` heuristic firing (which skips the default-tier call entirely and replaces it with a single escalated call), or (c) large-schema trigger (§11.11 / brief §5.3). There are no further retries on parse failure, adapter timeout, rate-limit rejection, or validation failure — any of those surfaces as a `BriefErrorResult` on the first occurrence. There is no multi-model escalation chain beyond the single default-tier → escalation-tier step. This invariant is the cost envelope for Stage 3: worst case per request is `default_tier_tokens + escalation_tier_tokens`, never more.

**Retry tie-break (deterministic resolution).** If both the default-tier and escalation-tier calls return valid `DraftQueryPlan` objects, the **escalation attempt is authoritative** — its draft is the one passed to Stage 4. The default-tier draft is discarded; its cost is still captured on the `planner.stage3_parse_completed` event (for the `avg_query_cost_cents` metric) but its content is not referenced past the escalation decision. This rules out any "best-of-N" selection and keeps the same-input-same-plan determinism property for the planner.

### 10.5 Test plan

Pure tests in `llmPlannerPromptPure.test.ts`:

- Prompt includes all registry keys
- Prompt includes schema context verbatim
- Prompt truncates raw intent at 2k chars (safety)
- Registry descriptions have no placeholder-injection risk

Integration tests for `llmPlanner.ts` mock `llmRouter.routeCall` and assert:

- Confidence < threshold → escalation call fires
- Confidence ≥ threshold → no escalation
- Hybrid heuristic → escalates on first call
- Router errors surface as `BriefErrorResult` with `errorCode: 'ambiguous_intent'`

---

## 11. Stage 4 — Validator

**File:** `server/services/crmQueryPlanner/validatePlanPure.ts`
**Stage contract:** given a `DraftQueryPlan` + `SchemaContext` + `CanonicalQueryRegistry` + the caller's `PrincipalContext`, return a validated `QueryPlan` or `ValidationError`. The principal context is required for Rule 9 (projection overlap, read-permission check) and Rule 10 (per-entry capability check); validator purity holds over the extended argument tuple. `validatePlanPure` is pure over its full input — same inputs always produce the same result, no hidden state.

### 11.1 Authority

The validator is **authoritative**. LLM output is advisory. This is not enforced by convention — it's enforced by the TypeScript literal `validated: true` on `QueryPlan` (§6.2). A `DraftQueryPlan` cannot reach any executor without passing through `validatePlan`.

**Single-plan invariant (reiterated from §3).** The planner produces exactly one validated `QueryPlan` per request. No parallel or competing plans are constructed, ranked, or compared. Stage resolution is linear: the first stage to produce a passing plan is the answer; later stages never run. This keeps cost attribution, event correlation, and cache semantics one-to-one with the request.

**Stage 1's reduced validator subset (§8.3) is a scoped application of this authority, not an exemption.** The rules Stage 1 skips are structurally guaranteed by the deterministic registry match — the registry entry fixes `primaryEntity`, operator compatibility on registry-declared fields, entity-relation validity, aggregation compatibility, hybrid-shape non-applicability, and canonical-precedence non-applicability. The rules Stage 1 **runs** (field existence, operator sanity, projection overlap) are the ones whose inputs come from `parseArgs` (user-derived free text) or from caller-specific principal context, and those always run. In every other stage, the full rule set (§11.2) runs.

### 11.2 Validation rules

**Classification — spec-enforceable invariant.** Every rule in this list MUST declare its classification inline: `[principal-dependent]` (inputs include `PrincipalContext` — reruns on cache hit per §9.3.1) or `[plan-dependent]` (inputs are pure over the cached plan shape — does not rerun on cache hit). Additionally, a `[stage1-subset]` tag marks rules that run under Stage 1's reduced subset per §8.3. A rule without a classification tag is a **spec violation**; `spec-reviewer` and `pr-reviewer` both check for it. When adding or modifying a rule, update §9.3.1 (cache-hit rerun list) and §8.3 (Stage 1 subset list) in the same edit if the tag changes.

Per brief §11.4, in order:

1. **Entity existence** `[plan-dependent]` — `primaryEntity` is in `PrimaryEntity` enum; resolved via schemaContext.
2. **Field existence** `[plan-dependent]` `[stage1-subset]` — every `filter.field`, `sort.field`, `projection` field, `aggregation.field`, `aggregation.groupBy` entry exists on `primaryEntity` per the subaccount's schemaContext.
3. **Operator sanity** `[plan-dependent]` `[stage1-subset]` — each filter's `operator` is valid for the field's type (e.g. no `gt` on a string field unless it's date-ish).
4. **Date-range sanity** `[plan-dependent]` — `dateContext.from < dateContext.to` when both present.
5. **Entity-relation validity** `[plan-dependent]` — e.g. filtering on `opportunity.stage` requires `primaryEntity === 'opportunities'`.
6. **Aggregation compatibility** `[plan-dependent]` — `sum`/`avg` only on numeric fields; `group_by` fields must exist on `primaryEntity`.
7. **Hybrid pattern check** `[plan-dependent]` — if `source === 'hybrid'`, plan must match `canonical_base_with_live_filter` shape:
   - `canonicalCandidateKey` is non-null and in the registry
   - Exactly one filter is a "live" filter (live-only field per schemaContext)
   - Other filters are canonical-resolvable
   - `limit` ≤ canonical base's native limit
   - `hybridPattern` field set to `'canonical_base_with_live_filter'`.
8. **Canonical-precedence tie-breaker** `[plan-dependent]` — applies only when `source === 'live'` AND `canonicalCandidateKey` is non-null and registry-valid. Three cases:
   - **Zero live-only filters present** → promote `source` to `'canonical'`, **keep `canonicalCandidateKey` on the plan** (canonicalExecutor requires it — see §12.1), log `planner.canonical_promoted`, dispatch via canonical executor.
   - **Live-only filters present AND plan matches `canonical_base_with_live_filter` shape** → promote to `source: 'hybrid'` with `hybridPattern: 'canonical_base_with_live_filter'`, **keep `canonicalCandidateKey`** so the hybrid executor can reuse the canonical base path, log `planner.canonical_promoted` with `toSource: 'hybrid'`, dispatch via hybrid executor (once P3 ships — see §19.1 P2 rejection rule).
   - **Live-only filters present AND plan does NOT match the hybrid shape** → keep as `source: 'live'`, no promotion. The filters the user asked for are preserved.

   The rule never silently strips filters. Dropping a user-specified filter would change query semantics — which is a correctness bug, not a tie-breaker. Promotion keeps `canonicalCandidateKey` populated because both canonical and hybrid executors dereference it to find the registry handler.
9. **Projection overlap** `[principal-dependent]` `[stage1-subset]` — `projection` fields must be a subset of fields permitted for `primaryEntity` on the caller's principal context (read-permission check).
10. **Per-entry capability check** `[principal-dependent]` — for canonical and hybrid plans (`source !== 'live'`), the caller's `capabilityMap` must contain every capability in `registry[plan.canonicalCandidateKey].requiredCapabilities`. This rule enforces the per-entry gate that the canonical executor otherwise runs at dispatch (§12.1); running it in the validator means cache hits and Stage 3 drafts are caught before executor dispatch. For v1, `requiredCapabilities` is forward-looking metadata (see §12.1 note) — the rule executes against whatever capabilities the caller's `capabilityMap` actually exposes, treating missing entries as absent.

### 11.3 Validation failure

On any rule failing:

```ts
throw new ValidationError({
  rejectedRule: 'field_existence' | 'operator_sanity' | ...,
  rejectedValue: <the offending value>,
  suggestions: generateRefinementSuggestions(draft, rejectedRule),
});
```

The caller (`crmQueryPlannerService`) catches `ValidationError` and emits `BriefErrorResult { errorCode: 'ambiguous_intent', message, suggestions }`. **No retry.** No second LLM call. The refinement is the user's next Brief.

### 11.4 On validation success

`validatePlanPure` is strictly pure — it returns a validated `QueryPlan` (with `stageResolved: 3` and `validated: true`) and performs no I/O or event emission. The imperative wrapper in `crmQueryPlannerService.ts` handles side effects after the pure call returns success:

- Writes the plan to `planCache` (§9).
- Emits `planner.classified` event with full plan shape.
- Dispatches to the executor.

Keeping cache writes and event emission out of `validatePlanPure` mirrors the repo's pure/impure split and keeps `validatePlanPure.test.ts` hermetic (no mock cache, no mock event bus).

For Stage 1 "stage1_mode" calls (§8.3), the service does NOT cache the plan — Stage 1 results are deterministic functions of `(registry, intent)` so caching adds no value. Only Stage 3 successes are cached.

### 11.5 Test plan (pure)

`validatePlanPure.test.ts` — at least 20 cases:

- One pass case per rule (rule's check succeeds, plan emerges validated)
- One fail case per rule (rule's check fails, `ValidationError` thrown with correct `rejectedRule`)
- Canonical-precedence tie-breaker: live plan with valid `canonicalCandidateKey` promotes to canonical
- Hybrid-pattern check: matching plan passes; extra filter → rejected; no `canonicalCandidateKey` → rejected
- Cross-subaccount field leak attempt (projection includes field from another subaccount's schema) → rejected

---

## 12. Canonical executor + `canonicalQueryRegistry`

**Files:** `server/services/crmQueryPlanner/executors/canonicalExecutor.ts` + `canonicalQueryRegistry.ts`

### 12.1 Executor contract

```ts
export async function executeCanonical(
  plan: QueryPlan,
  context: ExecutorContext
): Promise<ExecutorResult> {
  if (plan.source !== 'canonical') {
    throw new Error('canonicalExecutor dispatched with non-canonical plan');
  }
  if (!plan.canonicalCandidateKey) {
    throw new Error('canonical plan missing canonicalCandidateKey');
  }
  const entry = canonicalQueryRegistry[plan.canonicalCandidateKey];
  if (!entry) {
    throw new Error(`registry key not found: ${plan.canonicalCandidateKey}`);
  }
  // Per-entry capability check — enforced at dispatch, not at the route.
  // `context.callerCapabilities` is hydrated from the caller's permission
  // context (see §16.4). Missing any required capability surfaces as
  // `BriefErrorResult { errorCode: 'missing_permission' }` upstream.
  for (const cap of entry.requiredCapabilities) {
    if (!context.callerCapabilities.includes(cap)) {
      throw new MissingPermissionError(cap);
    }
  }
  return entry.handler({
    orgId: context.orgId,
    subaccountId: context.subaccountId,
    filters: plan.filters,
    dateContext: plan.dateContext,
    limit: plan.limit,
    sort: plan.sort,
    projection: plan.projection,
  });
}
```

`MissingPermissionError` is a small service-layer error thrown by the executor and caught by `crmQueryPlannerService.ts` → emitted as `BriefErrorResult { errorCode: 'missing_permission', message }`.

**Capability taxonomy note for v1.** Per-entry `requiredCapabilities` slugs (`canonical.contacts.read`, `canonical.opportunities.read`, `canonical.revenue.read`, `clientpulse.health_snapshots.read`, etc.) describe the read scope each registry handler logically needs; the repo does **not** currently own a canonical-data integration or a `canonical.*` capability catalogue. For v1 the per-entry check executes against the caller's `capabilityMap.read_capabilities` (existing `CapabilityMap` shape from `server/services/capabilityMapService.ts`) and treats any slug not yet registered anywhere as absent. The only capability actually granted via the skill system in v1 is `crm.query` (the `actionType: 'crm.query'` registered in §18.2) — that is the v1 gate. The per-entry slugs stay on the registry as forward-looking metadata; they become live gates in a v2 follow-up that declares the canonical-data capability surface concretely. Consequently, a v1 agent granted `crm.query` passes the route gate but can hit the per-entry block for any entry whose `requiredCapabilities` include a not-yet-granted `canonical.*` slug — until v2 ships, treat the per-entry list on each entry as aspirational: the concrete v1 enforcement path is `crm.query` route gate → canonical dispatch, with per-entry blocks firing only when the caller's `capabilityMap` actually grants the listed slugs (none in v1 unless the org has grafted `canonical.*` onto its reference manually).

This is tracked explicitly in Deferred Items so the per-entry enforcement becomes a real gate the moment the capability source-of-truth file lands.

### 12.2 Registry — 8 v1 entries

```ts
export const canonicalQueryRegistry: CanonicalQueryRegistry = Object.freeze({
  'contacts.inactive_over_days': {
    key: 'contacts.inactive_over_days',
    primaryEntity: 'contacts',
    aliases: [
      'inactive contacts',
      'stale contacts',
      'contacts no activity',
      'contacts without activity',
      'dormant contacts',
    ],
    requiredCapabilities: ['canonical.contacts.read'],
    description: 'Contacts with no activity since N days ago',
    handler: contactsInactiveOverDaysHandler,
  },
  'accounts.at_risk_band': {
    key: 'accounts.at_risk_band',
    primaryEntity: 'contacts',
    aliases: [
      'at risk accounts',
      'churn risk',
      'accounts likely to churn',
      'red accounts',
      'yellow accounts',
    ],
    requiredCapabilities: ['canonical.contacts.read', 'clientpulse.health_snapshots.read'],
    description: 'ClientPulse health band rollup (green/yellow/red)',
    handler: accountsAtRiskBandHandler,
  },
  'opportunities.pipeline_velocity': {
    key: 'opportunities.pipeline_velocity',
    primaryEntity: 'opportunities',
    aliases: [
      'pipeline velocity',
      'deal velocity',
      'stage velocity',
      'how fast are deals moving',
    ],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Stage velocity metrics over a time window',
    handler: pipelineVelocityHandler,
  },
  'opportunities.stale_over_days': {
    key: 'opportunities.stale_over_days',
    primaryEntity: 'opportunities',
    aliases: [
      'stale deals',
      'stuck deals',
      'stale opportunities',
      'deals stuck in stage',
      'deals no movement',
    ],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Opportunities in a stage beyond N days',
    handler: staleOpportunitiesHandler,
  },
  'appointments.upcoming': {
    key: 'appointments.upcoming',
    primaryEntity: 'appointments',
    aliases: [
      'upcoming appointments',
      'next appointments',
      'future appointments',
      'scheduled meetings',
    ],
    requiredCapabilities: ['canonical.appointments.read'],
    description: 'Standard appointment list within a window',
    handler: upcomingAppointmentsHandler,
  },
  'contacts.count_by_tag': {
    key: 'contacts.count_by_tag',
    primaryEntity: 'contacts',
    aliases: [
      'contacts by tag',
      'count contacts by tag',
      'tag breakdown',
      'contacts per tag',
    ],
    requiredCapabilities: ['canonical.contacts.read'],
    description: 'Tag-partitioned contact counts',
    handler: contactsByTagHandler,
  },
  'opportunities.count_by_stage': {
    key: 'opportunities.count_by_stage',
    primaryEntity: 'opportunities',
    aliases: [
      'opportunities by stage',
      'deals by stage',
      'pipeline by stage',
      'stage breakdown',
    ],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Stage-partitioned opportunity counts',
    handler: opportunitiesByStageHandler,
  },
  'revenue.trend_over_range': {
    key: 'revenue.trend_over_range',
    primaryEntity: 'revenue',
    aliases: [
      'revenue trend',
      'revenue over time',
      'revenue by month',
      'revenue history',
    ],
    requiredCapabilities: ['canonical.revenue.read'],
    description: 'Revenue aggregation over a date range',
    handler: revenueTrendHandler,
  },
});
```

Alias lists are intentionally conservative v1. Pressure test (§20.3) expands them based on real operator phrasing.

### 12.3 Handler implementations

Each handler is a small function calling `canonicalDataService`. For entries whose underlying query doesn't yet exist on `canonicalDataService` (it's currently metrics-only — see audit in brief context), this spec extends `canonicalDataService` with the needed reads:

```ts
// server/services/canonicalDataService.ts — extensions

export async function listInactiveContacts(
  args: { orgId: string; subaccountId: string; sinceDaysAgo: number; limit: number }
): Promise<{ rows: CanonicalContact[]; rowCount: number; truncated: boolean }>;

export async function listStaleOpportunities(
  args: { orgId: string; subaccountId: string; stageKey?: string; staleSince: Date; limit: number }
): Promise<{ rows: CanonicalOpportunity[]; rowCount: number; truncated: boolean }>;

// ... one extension per registry entry whose data isn't already exposed
```

Handlers then wrap those into `ExecutorResult`:

```ts
async function contactsInactiveOverDaysHandler(
  args: CanonicalQueryHandlerArgs
): Promise<ExecutorResult> {
  const sinceDaysAgo = resolveSinceDaysAgo(args.filters, args.dateContext);  // pure helper
  const { rows, rowCount, truncated } = await listInactiveContacts({
    orgId: args.orgId,
    subaccountId: args.subaccountId,
    sinceDaysAgo,
    limit: args.limit,
  });
  return {
    rows,
    rowCount,
    truncated,
    truncationReason: truncated ? 'result_limit' : undefined,
    actualCostCents: 0,  // canonical reads are free
    source: 'canonical',
  };
}
```

### 12.4 Test plan

`canonicalQueryRegistry.test.ts`:

- Every entry's handler invokable with mock `canonicalDataService` returns a valid `ExecutorResult`
- Every entry's `requiredCapabilities` list references existing canonical capabilities (verified against `server/lib/permissions.ts` or equivalent)
- Registry is `Object.freeze`'d — mutation attempts throw in strict mode

---

## 13. Live executor

**File:** `server/services/crmQueryPlanner/executors/liveExecutor.ts`
**Backed by:** `server/services/adapters/ghlReadHelpers.ts` (existing)

### 13.1 Executor contract

```ts
export async function executeLive(
  plan: QueryPlan,
  context: ExecutorContext
): Promise<ExecutorResult> {
  if (plan.source !== 'live') {
    throw new Error('liveExecutor dispatched with non-live plan');
  }
  // `acquire(key)` is fire-and-forget: it returns `Promise<void>` once a
  // token is consumed from the per-location bucket. The limiter has no
  // `release()` — tokens refill on a timer (see server/lib/rateLimiter.ts).
  // Fair-queueing with ClientPulse is automatic because both callers share
  // the bucket keyed on locationId.
  await getProviderRateLimiter('ghl').acquire(context.subaccountLocationId);
  const translated = translateToProviderQuery(plan);       // §13.2
  const response = await dispatchGhlRead(translated, context);
  return normaliseLiveResponse(response, plan);
}
```

`dispatchGhlRead` is a small pure-ish helper (lives alongside `liveExecutor.ts`) that maps `translated.endpoint` (a discriminated union — one of `'listContacts' | 'listOpportunities' | 'listAppointments' | 'listConversations' | 'listTasks' | 'listUsers'`) to the correct `ghlReadHelpers` export. Current exports of `server/services/adapters/ghlReadHelpers.ts` cover contacts / users / automations / from-addresses / from-numbers only — P2 extends the file with `listGhlOpportunities`, `listGhlAppointments`, `listGhlConversations`, `listGhlTasks` (see §5 file inventory for the `[existing — extend in P2]` marker). `ghlReadHelpers` does **not** expose a generic `.query()`; the planner calls the specific per-resource helpers and the dispatcher is the mapping layer. P1 cannot dispatch live reads because the v1 planner skips live entirely in P1 (Stage 3 stub → `unsupported_query`); the helper additions land alongside the live executor in P2.

### 13.2 Plan-to-provider translation

`translateToProviderQuery(plan)` is a pure function in `liveExecutor.ts`. It maps the plan's `filters`, `sort`, `limit`, `projection`, `dateContext` to a `TranslatedGhlRead` object with an `endpoint` discriminant (e.g. `'listContacts'`) plus the parameter object the matching `ghlReadHelpers` function accepts. `TranslatedGhlRead` is declared inside `liveExecutor.ts`; it is the planner's local type and does not touch the adapter surface. The dispatch layer (`dispatchGhlRead`, §13.1) is the single place that knows which helper belongs to which endpoint value.

### 13.3 Read-only enforcement (static gate)

`liveExecutor.ts` imports `ghlReadHelpers` (read-only module) — it does NOT import `ghlAdapter`'s write methods (`createContact`, `createTask`, etc.). v1 enforces this via a new repo-style static gate: `scripts/verify-crm-query-planner-read-only.sh` greps every file under `server/services/crmQueryPlanner/executors/` for forbidden imports against `server/adapters/ghlAdapter` (write methods) and exits 1 if any are found. The gate is added to `scripts/run-all-gates.sh`.

This matches the convention the repo already uses for `verify-no-direct-adapter-calls.sh` and the other 24 `verify-*.sh` gates — it is a CI-level static check, not a compile-time TypeScript check. Attempted write imports fail the static gate at CI time, not at runtime.

Even if an LLM-generated `QueryPlan` contained a malicious write-like structure, the live executor has no way to reach a mutation method — the write function is not imported and the static gate prevents one from being added without being noticed.

### 13.4 Result-size cap

Default `limit` is 100 rows. If GHL's response exceeds the plan's limit, truncation is applied client-side with `truncated: true` and `truncationReason: 'result_limit'`.

### 13.5 Rate-limit behaviour

`getProviderRateLimiter('ghl').acquire(locationId)` is a token-bucket acquire with no release — it resolves once a token is consumed from the per-location bucket. Tokens refill on the configured interval (see `server/lib/rateLimiter.ts`). ClientPulse polling and planner live queries share the same bucket keyed on `locationId`, so fair-queueing happens automatically. The planner does not set a timeout on the acquire; if the queue depth is pathological, the eventual response will be cost-exceeded or rate-limited depending on which limit fires first.

### 13.6 Test plan

`liveExecutor.test.ts` (pure, with mocked `ghlReadHelpers` module and mocked `getProviderRateLimiter`):

- Plan translation is deterministic per input — each `plan.primaryEntity` maps to the correct `TranslatedGhlRead.endpoint`
- `getProviderRateLimiter('ghl').acquire(locationId)` is awaited exactly once before dispatch
- `dispatchGhlRead` calls the correct `ghlReadHelpers.listGhl*` function for each endpoint discriminant
- Truncation fires at `rows.length > plan.limit`
- Non-live plan throws before any adapter call
- Adapter error (401, 429, 5xx) surfaces as structured error with appropriate `errorCode`

---

## 14. Hybrid executor

**File:** `server/services/crmQueryPlanner/executors/hybridExecutor.ts`
**Pattern:** `canonical_base_with_live_filter` — the **only** v1 hybrid pattern.

### 14.1 Executor contract

```ts
export async function executeHybrid(
  plan: QueryPlan,
  context: ExecutorContext
): Promise<ExecutorResult> {
  if (plan.source !== 'hybrid') {
    throw new Error('hybridExecutor dispatched with non-hybrid plan');
  }
  if (plan.hybridPattern !== 'canonical_base_with_live_filter') {
    throw new Error(`unsupported hybrid pattern: ${plan.hybridPattern}`);
  }
  // 1. Split plan into canonical base + live filter
  const { canonicalBase, liveFilter } = splitHybridPlan(plan);
  // 2. Run canonical base
  const baseResult = await executeCanonical(canonicalBase, context);
  // 3. Run live filter against baseResult.rows (in-memory, one request per unique row group)
  const filtered = await applyLiveFilter(baseResult.rows, liveFilter, context);
  // 4. Merge + truncate
  return mergeHybridResults(baseResult, filtered, plan);
}
```

### 14.2 Constraint enforcement (reiterated from validator §11.2)

The validator guarantees at entry:

- Plan has exactly one "live filter" (one filter referencing a live-only field per schemaContext)
- Other filters are canonical-resolvable
- `limit` ≤ canonical base's native limit
- `primaryEntity` matches a registered canonical entry

Executor does not re-validate; if any of these invariants are violated, it throws (defensive runtime check against an unvalidated plan somehow reaching the executor).

### 14.3 Live-filter application

`applyLiveFilter` fetches only the live-only field for each row in `baseResult.rows`, not a general re-query. This bounds work to `O(rowCount)` live calls at worst — with the result-size cap at 100 rows, that's bounded. In practice, batch endpoints (e.g. "fetch tags for these N contact IDs") let us reduce to `O(1)` or `O(ceil(rowCount / batch_size))` calls.

**Hard cap:** if a hybrid query would require more than 10 live calls (after batching), the executor returns `BriefErrorResult { errorCode: 'cost_exceeded' }` with a suggestion to narrow the canonical base first. This is the circuit breaker for the combinatorial-work risk the brief's §6.3 warned about.

**Cap enforcement is two-layered, never post-hoc.** The 10-call cap holds defensively at both pre-dispatch and mid-iteration:

1. **Pre-dispatch estimate.** The executor computes `ceil(canonicalBase.rowCount / batch_size)` and rejects immediately with `cost_exceeded` if that exceeds 10. The canonical base's row count is known at this point because it has already run (§14.1 step 2).
2. **Mid-iteration short-circuit.** If the true fan-out is only discoverable after the first live call (e.g. tags-per-contact where some contacts return more IDs than the batch schema anticipated), the executor maintains a running call counter and short-circuits the moment the count reaches 10. The partial canonical base is surfaced as a `BriefErrorResult { errorCode: 'cost_exceeded', suggestions: [...] }` — not a partial structured result, because mixing cap-truncated and cap-complete rows would mislead the user.

This guarantees the cap holds even when call count cannot be fully determined pre-execution.

**Short-circuit result shape (explicit invariant).** When the cap fires — at pre-dispatch estimate or mid-iteration — the executor returns `BriefErrorResult { errorCode: 'cost_exceeded', suggestions: [...] }`. **No partial `BriefStructuredResult` is returned in v1**, even if some rows have been live-filtered before short-circuit. Mixing cap-truncated and cap-complete rows in a structured result would mislead the user about query completeness; the error-plus-suggestions shape forces a refinement instead. Partial-result return is explicitly out of scope for v1 (see Deferred Items if it ever becomes signal-driven).

### 14.4 Test plan

`hybridExecutor.test.ts`:

- Canonical + live merge produces rows that appear in both
- Live filter reducing-only semantics (no rows added post-merge)
- 10-live-call cap triggers `cost_exceeded` error
- Non-matching pattern throws before dispatch
- Canonical base failure surfaces cleanly (doesn't attempt live)
- Live failure surfaces cleanly (doesn't corrupt canonical base)

---

## 15. Result normaliser + approval card generation

**Files:** `server/services/crmQueryPlanner/resultNormaliser.ts` + `resultNormaliserPure.ts` + `approvalCardGeneratorPure.ts`

### 15.1 Normaliser contract

```ts
export function normaliseToArtefacts(
  plan: QueryPlan,
  execResult: ExecutorResult,
  context: NormaliserContext
): { structured: BriefStructuredResult; approvalCards: BriefApprovalCard[] } {
  const structured = buildStructuredResult(plan, execResult);
  const approvalCards = generateApprovalCards(plan, execResult, context);
  return { structured, approvalCards };
}
```

`buildStructuredResult` and `generateApprovalCards` are pure and separately testable.

### 15.2 `BriefStructuredResult` construction

Follows the committed contract (`shared/types/briefResultContract.ts`) verbatim. Key fields populated:

| Field | Source |
|---|---|
| `kind` | Literal `'structured'` |
| `summary` | Templated from plan + rowCount (e.g. `"{{rowCount}} contacts inactive 30d"`) |
| `entityType` | `plan.primaryEntity` |
| `filtersApplied` | Every filter from `plan.filters` rendered as a chip with `humanLabel` |
| `rows` | `execResult.rows` (shape varies per entity) |
| `rowCount` | `execResult.rowCount` |
| `truncated` | `execResult.truncated` |
| `truncationReason` | `execResult.truncationReason` |
| `suggestions` | Generated from plan context (see §15.3) |
| `costCents` | `execResult.actualCostCents` |
| `source` | `execResult.source` |

### 15.3 Suggestion generation

`generateSuggestions(plan, execResult)` emits refinement affordances. Rules:

- **If truncated:** suggest narrowing by date, owner, stage, or tag.
- **If rowCount > 50:** suggest sort by a relevant field (last activity, created date, amount).
- **If entity has common follow-ups:** suggest those (e.g. contacts → "Email these contacts").
- **All suggestions must be re-parseable as a new Brief** — full instruction strings, not fragments. Per brief §7 rule.

Suggestions are a pure function of plan + result; no LLM call.

### 15.4 Approval card generation

Per brief §11.8 — one illustrative example ships v1: sending an email to a **single contact** from the returned set. The registered `crm.send_email` action schema (`server/config/actionRegistry.ts`) expects exactly one `toContactId` plus a concrete `from` / `subject` / `body`, so the v1 card is one-contact-at-a-time. Batch-email (one approval, N sends) requires extending the action registry with a new batch slug — that's tracked in the Deferred Items section, not v1 scope.

```ts
export function generateApprovalCards(
  plan: QueryPlan,
  execResult: ExecutorResult,
  context: NormaliserContext
): BriefApprovalCard[] {
  const cards: BriefApprovalCard[] = [];

  // v1 pattern: contact-list result → single-contact email follow-up for the top row.
  // The UI can cycle through other rows to generate additional cards, but each card
  // maps 1:1 to a dispatchable `crm.send_email` action.
  if (plan.primaryEntity === 'contacts' && execResult.rows.length > 0) {
    const top = execResult.rows[0];
    const toContactId = String(top.id);
    cards.push({
      kind: 'approval',
      summary: `Send email to ${top.displayName ?? toContactId}`,
      actionSlug: 'crm.send_email',
      actionArgs: {
        from: context.defaultSenderIdentifier,       // resolved from subaccount config at card-build time
        toContactId,
        subject: '',                                 // user fills at approval time
        body: '',                                    // user fills at approval time
        scheduleHint: 'immediate',
      },
      affectedRecordIds: [toContactId],
      riskLevel: 'low',                              // single-contact email — never more than 'low' in v1
    });
  }

  // Extension points for future cards (not v1):
  // - opportunities → "Update stage for selected"
  // - tasks → "Reassign selected tasks"
  // - appointments → "Reschedule selected"
  // - contacts (batch) → "Send email to N contacts" — requires new batch action slug (Deferred Items)

  return cards;
}
```

`context.defaultSenderIdentifier` is a **new** field on the planner-local `NormaliserContext` type (declared in `server/services/crmQueryPlanner/resultNormaliser.ts` — it is not an existing repo primitive). The planner populates it at runQuery entry by resolving the subaccount's default sender identifier from `subaccount_crm_connections` (existing table used by the shipped `crm.send_email` dispatch path — check that path for the canonical resolution query; the planner reuses that lookup, it does not reinvent it). If the lookup returns no connected sender, the card generator skips email-card emission. The `NormaliserContext` type is added in P1 alongside the rest of the planner's local types.

Approval cards are **suggestions only** — the chat surface renders them; the user fills `subject`/`body` and approves; the approval creates a normal review-gated action via `actionService`. The planner does not execute the action. The `actionArgs` emitted by the generator MUST satisfy the registered action's `parameterSchema` — the registered schema is the source of truth, this generator follows it.

### 15.5 Test plan

`resultNormaliserPure.test.ts`:

- Every `BriefStructuredResult` field populated correctly for canonical, live, hybrid sources
- `filtersApplied` matches plan filters exactly
- Truncation propagates

`approvalCardGeneratorPure.test.ts`:

- Contact-list with ≥1 row → single-contact email card for the top row
- Contact-list with 0 rows → no card
- Opportunity-list → no card in v1
- Subaccount missing `defaultSenderIdentifier` → no card (graceful skip)
- Emitted `actionArgs` satisfy the registered `crm.send_email` zod schema (verified against a test-time copy of the action registry)
- `actionSlug` is a registered skill

---

## 16. Governance integration

No new governance primitives. The planner wires into existing systems.

### 16.1 `llmRouter.routeCall` (mandatory)

All Stage 3 LLM calls route through `llmRouter.routeCall`. This is enforced by the repo-wide static gate `scripts/verify-no-direct-adapter-calls.sh` (exit 1 on direct provider imports) plus the runtime `assertCalledFromRouter()` check inside adapters. The planner has no bypass — and must not attempt one.

The call parameters lock:

```ts
{
  task: 'crm_query_planner',
  context: {
    sourceType: 'system',
    sourceId: 'crm_query_planner',
    featureTag: 'crm-query-planner',
    systemCallerPolicy: 'strict',
    orgId, subaccountId, runId,
  },
  model: resolvePlannerTier(orgId, escalate),
  // ...
}
```

`sourceType: 'system'` + `systemCallerPolicy: 'strict'` means the router applies the system caller's strictest routing policy (no user-override model selection, no per-user budget deviations).

### 16.2 `runCostBreaker`

Per-run cost enforcement is **not called from the planner directly**. `runCostBreaker.assertWithinRunBudgetFromLedger` (`server/lib/runCostBreaker.ts`) is a post-ledger helper — it requires an already-inserted `llm_requests` row id — and it is invoked by `llmRouter` internally on every `routeCall` that carries a `runId`. The planner therefore gets per-run budget enforcement for free, as a side-effect of every Stage 3 call: if the run's ledger sum exceeds the ceiling when the Stage 3 call completes, the router surfaces a `BudgetExceededError`; `crmQueryPlannerService` catches it and emits `BriefErrorResult { errorCode: 'cost_exceeded' }`.

When the caller is a human-initiated Brief (no `runId`), per-run enforcement does not apply — there is no run to accumulate against. The per-query cent ceiling below is the only planner-local cost gate in that case; the router's own budget checks (per-subaccount, per-day) still apply.

Live-executor dispatch does NOT make a new `routeCall`, so `runCostBreaker` does not re-fire pre-dispatch for live. The per-query cent ceiling (below) is the planner's gate before live dispatch when Stage 3 ran.

**Per-query cent ceiling (new — local to planner):** independent of per-run. System default `100` cents (configurable via `systemSettings.crm_query_planner_per_query_cents`). The check fires **after Stage 3 completes** (including any escalation retry, per §10.3), before the validator dispatches to the executor: if the accumulated planner cost for this invocation exceeds the ceiling, short-circuit with `BriefErrorResult { errorCode: 'cost_exceeded' }` without executor dispatch. Pre-Stage-3 there is zero accumulated planner cost — the ceiling is inherently a post-escalation guard. This prevents one exploratory query that escalates to the high tier from burning its entire share of the run's ceiling.

**Executor cost boundary (explicit invariant).** The per-query cent ceiling is a **Stage 3 cost guard only**. Executor runtime cost — canonical executor DB work, live executor provider calls, hybrid executor live-filter calls — is **not pre-bounded** in v1 beyond these two existing guards:

- **Hybrid 10-call cap** (§14.3) — hybrid executor short-circuits at 10 live calls, enforced pre-dispatch and mid-iteration. **The cap bounds call count only, not response payload size or per-call latency.** A hybrid query issuing 9 calls each returning a 10 MB response is within the cap; response-size cost remains unbounded in v1 beyond the canonical `limit` on the base query and the provider's own payload limits.
- **Per-run ledger check** via `runCostBreaker` — fires on any `runId`-carrying Stage 3 call; catches runaway cost at run scope.

No additional planner-local budget is imposed on canonical DB queries or on non-hybrid live calls because (a) canonical reads are bounded by `LIMIT`-capped queries, (b) single live reads are a single provider call, and (c) the brief's §11.5 explicitly defers per-subaccount rate-budget enforcement until signal justifies it. Callers with strict per-query cost requirements must rely on the run-level ceiling (`runCostBreaker`), not a planner-local cap.

### 16.2.1 Cost attribution — one calculator, one source-of-truth field

There is exactly one planner-side cost calculator (`plannerCostPure.ts`) and exactly one source-of-truth field (`QueryPlan.costPreview: BriefCostPreview`, §6.2). The wire contract's `BriefCostPreview` (`shared/types/briefResultContract.ts`) is the final shape — `{ predictedCostCents, confidence, basedOn }`, no actual-cost slot. Actual cost is a separate observability signal, carried only on `planner.result_emitted.actualCostCents` and not on the plan or the wire response.

The calculator is a pure function:

```ts
// server/services/crmQueryPlanner/plannerCostPure.ts
export function computePlannerCostPreview(input: {
  stage3ParseUsage?:      { inputTokens: number; outputTokens: number; model: string };
  stage3EscalationUsage?: { inputTokens: number; outputTokens: number; model: string };
  liveCallCountEstimate?:   number;
  hybridLiveCallCountEstimate?: number;
}): BriefCostPreview {
  /* pure — token×price derivation via pricingService rates; returns
     { predictedCostCents, confidence: 'low'|'medium'|'high',
       basedOn: 'planner_estimate' | 'cached_similar_query' | 'static_heuristic' } */
}

export function computeActualCostCents(input: {
  stage3ParseUsage?:      { inputTokens: number; outputTokens: number; model: string };
  stage3EscalationUsage?: { inputTokens: number; outputTokens: number; model: string };
  liveCallCount?:         number;
  hybridLiveCallCount?:   number;
}): { total: number; stage3: number; executor: number } {
  /* pure — returns the split (§18.2 cost attribution invariant):
     stage3   = token×price for parse + escalation calls
     executor = per-call cost × (liveCallCount + hybridLiveCallCount)
     total    = stage3 + executor                                   */
}
```

- `computePlannerCostPreview` runs **pre-dispatch** and fills `QueryPlan.costPreview`. `confidence` reflects source reliability (static_heuristic for Stage 1, cached_similar_query for Stage 2, planner_estimate for Stage 3). `basedOn` is picked by the caller at call-site.
- `computeActualCostCents` runs **post-dispatch** to populate `planner.result_emitted.actualCostCents` and to feed the per-query ceiling check described in §16.2.
- Stage 3 token counts come from the `ProviderResponse.usage` returned by `llmRouter.routeCall` (the router does NOT return ledger rows — ledger persistence is its internal side-effect; the `usage` object is the caller-visible cost signal). `crmQueryPlannerService` captures the `usage` object from each Stage 3 call (initial parse + optional escalation retry) and feeds it to the calculator.
- Live-call / hybrid-call counts come from the executor layer (each executor increments a local counter as it dispatches).

The per-query ceiling check reads `computeActualCostCents(...).stage3` (after Stage 3, before executor dispatch — only the Stage 3 component matters at this point since executor has not run) and compares to `systemSettings.crm_query_planner_per_query_cents`. Per-run ceiling is enforced by `runCostBreaker` inside the router, post-ledger — see §16.2 for the primitive boundary.

Because `BriefCostPreview` carries only predicted cost and `DraftQueryPlan` must not force the LLM to emit planner-derived values, `DraftQueryPlan` is **`Omit<QueryPlan, 'validated' | 'stageResolved' | 'costPreview'>`**. The planner fills `costPreview` after the Stage 3 parse succeeds, using `computePlannerCostPreview`. Stage 1 / Stage 2 hits fill `costPreview` the same way on their own code paths (with `basedOn: 'static_heuristic'` and `'cached_similar_query'` respectively).

### 16.3 Rate limiter

`getProviderRateLimiter('ghl')` acquired in the live executor (§13.5). Per-location keying matches ClientPulse polling's keying, so the two share the same bucket and fair-queue together.

Per brief §11.5, a per-subaccount rate-limit budget is deferred to v2 unless real traffic signals abuse.

### 16.4 RLS / principal context

The real `withPrincipalContext` primitive (`server/db/withPrincipalContext.ts`) is **not** a standalone transaction wrapper — it sets the four `app.current_*` session variables RLS policies consume, and it **throws** if called outside an active `withOrgTx(...)` block. Canonical reads inside the planner therefore follow the existing nested pattern:

```ts
await withOrgTx(context.organisationId, async () => {
  return withPrincipalContext(
    {
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      type: context.principalType,    // 'user' | 'agent' | 'system' — from caller's principal
      id: context.principalId,         // caller's user/agent/system UUID
      teamIds: context.teamIds ?? [],
    },
    async (tx) => {
      // Canonical executor dispatch happens here; `tx` is the org-scoped transaction.
      return dispatchCanonical(plan, { ...context, tx });
    },
  );
});
```

The pipeline wrapping is done once at the top of `crmQueryPlannerService.runQuery` so every canonical read (Stage 2 cache-hit re-validation, Stage 4 validator projection-overlap check, canonical / hybrid executor dispatch) inherits the principal session variables automatically. Any query outside this nesting leaks cross-subaccount data — the throw-on-missing-org-tx guard inside the primitive makes a missed wrapping fail loudly rather than silently.

Live reads do NOT need `withPrincipalContext` — the GHL OAuth token is scoped to the subaccount's connected provider, so cross-subaccount leakage is structurally impossible at the network layer. The live executor still runs inside the same outer `withOrgTx` block (the planner's `runQuery` wraps the whole pipeline) so any canonical side-queries the live path makes (principal lookups, rate-limiter state) stay RLS-correct.

### 16.5 Audit

Each planner invocation emits a normal run event stream consumed by Agent Live Execution Logs (`agent_execution_events` table, shipped P1). The event set in §17 integrates with existing run-trace infrastructure; no new audit tables.

### 16.6 Read-only guarantees (two independent guards)

1. **Validator** (§11.2) rejects any plan with write-shaped operators or mutation affinity.
2. **Executor layer** imports only read helpers from the adapter surface — enforced by `scripts/verify-crm-query-planner-read-only.sh` as a CI-level static gate (§13.3). No write helpers are in scope at module-load time.

These are independent — a regression in one does not open a hole in the other. Both are CI-level checks (one runtime-in-test via the validator's pure tests, one static-grep via the gate script); neither is a compile-time TypeScript check.

---

## 17. Observability

All events emitted via `plannerEvents.emit(event)` which:

1. Writes a structured log line at `info` level (or `warn` for errors). Always fires.
2. Increments in-memory metrics counters (for the derived metrics in §17.2). Always fires.
3. **Conditionally** calls `agentExecutionEventService.appendEvent` (`server/services/agentExecutionEventService.ts`) so the event surfaces in Agent Live Execution Logs (Phase 1). Gated on two conditions:
   - `event.runId` is present (agent-initiated invocations); human-initiated Briefs without a run do not forward (the log requires `runId`).
   - The emitted event kind maps into the closed `AgentExecutionEventType` union declared in `shared/types/agentExecutionLog.ts`. For v1 the planner kinds route through a narrow set of existing event types: stage transitions map to `'skill_start' | 'skill_complete' | 'skill_error'` (or the closest `AgentExecutionEventType` by semantics), keyed by `sourceService: 'crm-query-planner'`. The raw `planner.*` kind is preserved in the event payload. **No changes to `shared/types/agentExecutionLog.ts` or `agentExecutionEventService.ts` ship in this spec** — if the mapping turns out to need a new event type, that is a separate follow-up (tracked in Deferred Items).

Emissions via (1) and (2) are unconditional — structured logging and in-memory metrics work for every caller including humans. Only the agent-log forwarding path (3) is runId-gated.

### 17.1 Event payloads

| Kind | Payload |
|---|---|
| `planner.stage1_matched` | `{ registryKey, intentHash }` |
| `planner.stage1_missed` | `{ intentHash }` |
| `planner.stage2_cache_hit` | `{ intentHash, cachedAt, hitCount }` |
| `planner.stage2_cache_miss` | `{ intentHash, reason?: 'not_present' \| 'expired' \| 'principal_mismatch' }` |
| `planner.stage3_parse_started` | `{ intentHash, modelTier, schemaTokens }` |
| `planner.stage3_parse_completed` | `{ intentHash, modelTier, inputTokens, outputTokens, latencyMs, confidence }` |
| `planner.stage3_escalated` | `{ intentHash, fromTier, toTier, reason: 'low_confidence' \| 'hybrid_detected' \| 'large_schema' }` |
| `planner.validation_failed` | `{ intentHash, rejectedRule, rejectedValue }` |
| `planner.classified` | `{ intentHash, source, intentClass, confidence, stageResolved, canonicalCandidateKey }` |
| `planner.executor_dispatched` | `{ intentHash, executor: 'canonical'\|'live'\|'hybrid', predictedCostCents }` |
| `planner.canonical_promoted` | `{ intentHash, fromSource: 'live', toSource: 'canonical' \| 'hybrid', registryKey }` |
| `planner.result_emitted` | `{ intentHash, artefactKind: 'structured'\|'approval'\|'error', rowCount, truncated, actualCostCents: { total: number, stage3: number, executor: number }, stageResolved }` |
| `planner.error_emitted` | `{ intentHash, errorCode, rejectedRule?, stageResolved: 1 \| 2 \| 3 \| null }` |

Every event carries `{ kind, at, orgId, subaccountId, runId?, intentHash }` as standard envelope.

**Invariant — every request emits exactly one `stageResolved`-bearing event.** On the success path that is `planner.classified` (with `stageResolved: 1 | 2 | 3`). On every error path — validation failure, cost-exceeded pre-dispatch, executor error, unsupported intent, parse failure at Stage 3 — the service emits `planner.error_emitted` with `stageResolved` populated to the last stage the request reached. The only case the value is `null` is an error raised before any stage runs (e.g. a route-level precondition failure that shortcuts to an error without invoking `runQuery`'s pipeline); inside the planner itself this cannot happen — intent normalisation is Stage 0 and raises its own `ambiguous_intent` error with `stageResolved: 1` (the first matching-stage the request would have entered). The `null` slot exists as an explicit escape hatch for future route-layer errors, not as a missing-field signal.

Dashboards filter on `stageResolved` including error events; silent drop-off (an error path missing the field) is a spec violation and should be caught by `crmQueryPlannerService.test.ts`.

**Terminal-emission rule.** The `stageResolved`-bearing event (`planner.classified` or `planner.error_emitted`) is emitted **only at terminal resolution** of the request — the moment the service has decided "this request is done, here is the outcome." Pre-terminal events (`planner.stage3_parse_started`, `planner.stage3_parse_completed`, `planner.stage3_escalated`, `planner.validation_failed`, `planner.canonical_promoted`, `planner.executor_dispatched`) are status transitions and MUST NOT carry `stageResolved`. This prevents a future async/streaming path from double-emitting (early success event followed by a late error) — the terminal event fires exactly once, after the pipeline has committed to an outcome.

The standard envelope `{ kind, at, orgId, subaccountId, runId?, intentHash }` is extended with an optional `briefId?: string` — same pass-through as the request-body field (§18.1). `briefId` is what powers the `planner.brief_refinement_rate` correlation metric in §17.2; without it, per-session re-query detection is not possible.

### 17.2 Derived metrics

Computed from the event stream (batch, not per-event):

- **`planner.llm_skipped_rate`** = `(stage1_matched + stage2_cache_hit) / total_queries`. North-star metric for deterministic-coverage optimisation.
- **`planner.canonical_hit_rate`** = `count(planner.classified where payload.source === 'canonical') / count(planner.classified)`. Derived from the `planner.classified` event's `source` payload field (§17.1).
- **`planner.hybrid_unsupported_rate`** = `count(classified.source === 'hybrid' AND error_emitted.errorCode === 'unsupported_query' for the same intentHash) / count(total classified events)`. Numerator uses the `planner.classified` → `planner.error_emitted` pairing on the shared `intentHash`; denominator is total `planner.classified` events in the batch window. **Only meaningful after P3.** During P2 every hybrid plan is rewritten to `unsupported_query` by `crmQueryPlannerService` before executor dispatch (§19.1 P2 — hybrid executor doesn't ship until P3), so this metric would read 100 % during P2 and signal "executor not shipped" rather than "pattern gap". The metric chart suppresses rendering until the first run sees a non-rewritten hybrid dispatch (`planner.executor_dispatched.executor === 'hybrid'`) — that is the P2 → P3 crossover marker. When the post-P3 rate climbs, add a new hybrid pattern.
- **`planner.avg_query_cost_cents`** — mean `actualCostCents`, segmented by `stageResolved` (1, 2, 3).
- **`planner.avg_stage3_latency_ms`** — mean LLM Stage 3 `latencyMs`.
- **`planner.escalation_rate`** — `stage3_escalated / stage3_parse_completed`.
- **`planner.validation_failure_rate`** — `validation_failed / stage3_parse_completed`.
- **`planner.brief_refinement_rate`** — correctness proxy. **Session boundary:** one `briefId` = one chat session (per §18.1 request body); all queries carrying the same `briefId` are one session. **Per-session classification window:** 10 minutes rolling from the first query in the `briefId`; queries arriving after that count as a new session even if the `briefId` is reused. A `briefId` is classified as "refined" if within its 10-minute window it either (a) emitted `planner.error_emitted` with `errorCode: 'ambiguous_intent' | 'unsupported_query'`, or (b) was followed within the same `briefId` by another `planner.classified` event (re-query). **Aggregation window:** `brief_refinement_rate = refined_briefIds / total_briefIds` is rolled up **daily** (UTC calendar day, matching the system-pnl dashboard convention). No sub-daily aggregation in v1 — noise floor is too high under low traffic. Without this metric, efficiency optimisation (lower cost, higher `llm_skipped_rate`) could bias toward cheap-but-wrong plans users have to refine. The correlation uses the `briefId` envelope field (§17.1). **Dashboard surfacing is P3+**; event data is captured in v1 so the metric is computable without further schema changes, but the system-pnl subsection only adds a visual in P3 once there is enough traffic to distinguish signal from noise. Metric name, session boundary, per-session window, and aggregation window are locked in v1.

Metrics surface through the existing system-pnl admin route (`/system/llm-pnl`) with a new subsection under "Task-class breakdown." No new dashboard.

### 17.3 Query Memory Layer alignment

Per brief §11.12, the event shape above is **deliberately consumable** by the future Query Memory Layer. Specifically:

- `intentHash` is the primary key for grouping queries.
- `stage2_cache_hit.hitCount` identifies hot queries.
- `executor_dispatched.executor = 'live'` + high frequency = canonical promotion candidate.
- `validation_failed` + high frequency = alias-list or registry gap.

No v1 surfacing. No promotion workflow. Data captured for v2 to consume.

---

## 18. API surface

### 18.1 New route

```
POST /api/crm-query-planner/query
```

Request body:

```ts
{
  rawIntent: string;
  subaccountId: string;   // the subaccount the query targets — caller-supplied but always validated against the authenticated principal's accessible subaccounts
  briefId?: string;       // from the Brief surface, when applicable (optional)
}
```

`organisationId`, `userId`, and `runId` are **not** accepted from the request body. They come from the authenticated session: `organisationId` + `userId` from the `authenticate` middleware's principal context. `runId` is resolved by a small new helper `resolveAmbientRunId(principal)` (ships in `server/services/crmQueryPlanner/crmQueryPlannerService.ts` as a file-local utility — not a new cross-service primitive). For v1 the helper returns `principal.runId` if the middleware's principal carries one, otherwise `undefined`. An alternative mechanism — reading an AsyncLocalStorage-propagated run context on the server — is deferred until a concrete need arises (`getOrgTxContext` in `server/instrumentation.ts` is the pattern to mirror if v2 needs to discover `runId` outside the principal). Allowing the client to supply any of these three fields would let an attacker bypass RLS by claiming to be in a different org or impersonating a different user. The route handler reads them from the principal, not the payload.

Response body:

```ts
{
  artefacts: BriefChatArtefact[];   // from shared/types/briefResultContract.ts
  costPreview: BriefCostPreview;
  stageResolved: 1 | 2 | 3;
  intentHash: string;               // for client-side dedup / follow-up Briefs
}
```

Authentication: `authenticate` middleware (existing).
Permission gate at the route level: caller must have the `crm.query` capability on the target subaccount. This matches the skill registered in §18.2 and the rollout model in §21 — one access gate, not two. For v1 this is the only **enforced** gate — per-entry `canonical.*` capability checks (§12.1) fire against whatever slugs the caller's `capabilityMap` actually declares, with missing-slugs treated as absent; see §12.1's taxonomy note. `crm.query` is granted by listing the skill slug in `subaccount_agents.skill_slugs`, which the capability-map service maps into `capabilityMap.skills` on the next recompute (`server/services/capabilityMapService.ts`).

The edge check is scoped to the target subaccount via `resolveSubaccount(subaccountId, organisationId)` (existing convention); `organisationId` comes from the authenticated principal, NOT the request body.

### 18.2 New skill in `actionRegistry.ts`

The entry matches the real `ActionDefinition` shape declared in `server/config/actionRegistry.ts` — not a bespoke skill shape. Every field below is directly named on `ActionDefinition`:

```ts
// keyed on 'crm.query' in ACTION_REGISTRY
{
  actionType: 'crm.query',
  description: 'Answer a free-text CRM question using the CRM Query Planner.',
  actionCategory: 'api',                         // planner is HTTP-like; not worker/browser/devops/mcp
  isExternal: false,                             // planner lives in-app; the handler itself does not directly call external systems (live fallback goes through ghlReadHelpers, already scoped)
  defaultGateLevel: 'auto',                      // read-only — no review gate
  createsBoardTask: false,
  payloadFields: ['rawIntent', 'subaccountId'],  // legacy field, kept for backward compat per actionRegistry.ts doc-comment
  parameterSchema: z.object({
    rawIntent:    z.string().min(3).max(2000),
    subaccountId: z.string().uuid(),
  }),
  retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
  idempotencyStrategy: 'read_only',
  readPath: 'liveFetch',                         // planner can fall through to GHL live reads when canonical doesn't cover the intent; marking 'canonical' would misrepresent the action to `verify-skill-read-paths.sh` and to read-path reporting
  liveFetchRationale: 'CRM Query Planner dispatches Stage 1/2 canonical reads when the intent matches a canonical registry entry (preferred path), and Stage 3 LLM-planned live reads through `ghlReadHelpers` when the intent requires a live-only field or entity. The canonical path is preferred and measured via `planner.llm_skipped_rate` (§17.2); the live path is the fallback. This is a genuinely mixed path, correctly classified as `liveFetch` until every supported intent is canonicalised.',
  scopeRequirements: {
    validateSubaccountFields: ['subaccountId'],  // P1.1 Layer 3 — auth hook verifies the caller owns the subaccount
    requiresUserContext: false,                  // system-initiated invocations allowed (e.g. scheduled Briefs)
  },
  mcp: {
    annotations: {
      readOnlyHint:    true,
      destructiveHint: false,
      idempotentHint:  true,
      openWorldHint:   true,
    },
  },
  onFailure: 'skip',                             // planner errors surface as `BriefErrorResult`; the agent loop should continue
}
```

Handler registration follows the existing `ACTION_HANDLERS` pattern (see `server/config/actionRegistry.ts` for how `actionType` keys map to handlers in the registry module — the handler is NOT inlined on `ActionDefinition`). The handler calls `crmQueryPlannerService.runQuery` with the authenticated principal, not payload-supplied identifiers.

**Semantics note — `crm.query` is a routing action.** Unlike most entries in `actionRegistry.ts`, `crm.query` does not execute a single discrete operation. It dispatches through the planner pipeline, which may in turn call the canonical executor, the live executor, the hybrid executor, or short-circuit to an error — each with its own cost and latency profile. Action-level attributes (`readPath: 'liveFetch'`, `actionCategory: 'api'`, `defaultGateLevel: 'auto'`) describe the **entry-point contract**, not the execution path. Downstream cost attribution, latency attribution, and observability reflect the resolved execution path (`stageResolved`, `executor`, `source`) and must not be collapsed into the action-level attributes. This is the same pattern the Orchestrator uses above the planner — a router whose action-level registration names the entry point, not the branch it takes.

**Cost attribution split (explicit invariant).** `crm.query`'s action-level cost breakdown MUST distinguish two components: **(1) Planner cost** — Stage 3 LLM tokens (initial + optional escalation), plus any planner-internal compute. This is the cost of *deciding how to answer*. **(2) Executor cost** — canonical DB query cost, live provider call cost, hybrid live-filter calls. This is the cost of *running the answer*. The two are reported separately on `planner.result_emitted` (`stage3CostCents` and `executorCostCents` sub-fields of `actualCostCents`, implied by §16.2.1's `computeActualCostCents` decomposition) and MUST NOT be summed into a single action-level "cost of `crm.query`" slot. Dashboards that show action-level cost without this split misattribute executor cost to the planner and make optimisation decisions against a misleading signal.

Agent-facing tool. Exposed to any agent whose `capabilityMap` grants `crm.query`. The MCP server's tool catalogue auto-picks this up via the `mcp.annotations` block (existing pattern from `server/mcp/mcpServer.ts`).

### 18.3 No client-side route

v1 relies on the Brief-surface branch's chat surface rendering `BriefChatArtefact`s. No client changes here.

A stopgap "Ask CRM" panel is optional (brief §11). This spec does not implement it — if sequencing requires a standalone UI before the Brief surface lands, a minimal panel can be built as a follow-on P2 task by consuming the same route and renderers used by the Brief surface.

---

## 19. Phased delivery plan

The spec ships in three phases on this branch. Each phase is its own commit cluster, green tests before the next phase starts.

### Phase P1 — Deterministic core (no LLM)

**What ships:** the deterministic part of the planner. Stages 1, 2, 4; canonical executor; canonical registry with all 8 entries; result normaliser; API route; skill registration. **Stage 3 is stubbed** — on any intent that misses Stage 1 and Stage 2, the stub short-circuits to a `BriefErrorResult { errorCode: 'unsupported_query', suggestions: [...] }` **before** Stage 4 runs. The cache module (§9) is shipped but its write path is never exercised in P1 because only Stage 3 successes are cached and Stage 3 produces none. Stage 2 reads are wired so P2's first successful Stage 3 can populate the cache without further plumbing.

**Why this phase first:** the hardest-to-get-right pieces are the deterministic paths (registry matching, validation, normalisation). Proving them work without LLM noise in the loop is the highest-leverage way to start. Any user-visible failure at this phase is deterministic and fixable.

**Files:**
- `shared/types/crmQueryPlanner.ts`
- `server/services/crmQueryPlanner/normaliseIntentPure.ts` + test
- `server/services/crmQueryPlanner/registryMatcherPure.ts` + test
- `server/services/crmQueryPlanner/planCache.ts` + `planCachePure.ts` + test
- `server/services/crmQueryPlanner/validatePlanPure.ts` + test
- `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` + test
- `server/services/crmQueryPlanner/executors/canonicalExecutor.ts`
- `server/services/canonicalDataService.ts` (extensions for each registry handler)
- `server/services/crmQueryPlanner/resultNormaliser.ts` + `resultNormaliserPure.ts` + test
- `server/services/crmQueryPlanner/approvalCardGeneratorPure.ts` + test
- `server/services/crmQueryPlanner/crmQueryPlannerService.ts` (orchestration, with Stage 3 stub)
- `server/services/crmQueryPlanner/plannerEvents.ts`
- `server/routes/crmQueryPlanner.ts`
- `server/config/actionRegistry.ts` extension (register `crm.query`)
- `server/services/crmQueryPlanner/index.ts`

**Exit criteria:**
- All 8 canonical registry entries resolvable via Stage 1 matcher
- All registry handlers return valid `ExecutorResult`
- Result normaliser emits spec-compliant `BriefStructuredResult`
- One approval card path covered (`crm.send_email` on contact results)
- Pure test coverage: every `*Pure.ts` file has ≥1 test file with the cases listed in the relevant section
- `POST /api/crm-query-planner/query` returns correct artefact for all 8 registry-matched queries

### Phase P2 — LLM fallback + live executor

**What ships:** Stage 3 LLM planner; schema-context service; live executor; updated orchestration so Stage 3 actually runs.

**Hybrid handling in P2:** the hybrid executor (§14) does NOT ship until P3. Until P3, Stage 4's hybrid-pattern rule (§11.2 rule 7) still runs to detect the shape, but any plan with `source: 'hybrid'` is rewritten by `crmQueryPlannerService` into a `BriefErrorResult { errorCode: 'unsupported_query', suggestions: [...'ships in P3...'] }` before executor dispatch. This keeps Stage 4's shape-check logic exercised during P2 without requiring the executor half.

**Why this phase second:** with the deterministic core proven, adding the LLM fallback is scope-contained. Live executor depends on Stage 3 producing valid live plans, so they ship together.

**Files added:**
- `server/services/crmQueryPlanner/llmPlanner.ts`
- `server/services/crmQueryPlanner/llmPlannerPromptPure.ts` + test
- `server/services/crmQueryPlanner/schemaContextService.ts`
- `server/services/crmQueryPlanner/schemaContextPure.ts` + test
- `server/services/crmQueryPlanner/executors/liveExecutor.ts` + test

**Files updated:**
- `crmQueryPlannerService.ts` (wire Stage 3 + live executor)

**Exit criteria:**
- Stage 3 produces valid `DraftQueryPlan` for at least 10 intents outside the registry
- Validator accepts valid plans and rejects invalid ones
- Escalation fires on low confidence and on hybrid detection
- Live executor returns correct `ExecutorResult` for at least 5 long-tail queries
- Rate limiter `acquire(locationId)` awaited on every live dispatch (no release — token-bucket refill is timer-driven per §13.5); the acquire fires on both the happy path and the adapter-error path before the executor propagates the error
- Per-query cent ceiling enforced

**Cache effectiveness is NOT a P2 exit criterion.** Stage 2 cache hit rate (`planner.llm_skipped_rate` contribution from cache) depends on a stable validator AND stable `schemaContext`. During P2, schemaContext is newly introduced and its compression heuristics are still being tuned; cache churn from schemaContext version drift is expected and does not indicate a defect. Cache hit-rate becomes a real signal only after P3 when schemaContext stabilises and hybrid dispatches populate additional cache entries. The metric is still **measured** in P2 (§17.2), just not gated on.

### Phase P3 — Hybrid + observability surfacing

**What ships:** hybrid executor; full observability metrics exposed in system-pnl admin view.

v1 ships exactly one approval-card pattern — `crm.send_email` for a single contact (§15.4, §2 closed decision 11.8). Additional card patterns (opportunities, tasks, appointments, batch-email) are **not** v1 scope and do not ship in P3; they route through the Deferred Items section with their own triggers.

**Files added:**
- `server/services/crmQueryPlanner/executors/hybridExecutor.ts` + test

**Files updated:**
- `server/services/systemPnlService.ts` (add planner metrics subsection)
- `client/src/pages/SystemPnlPage.tsx` or equivalent (render the new subsection)

**Exit criteria:**
- Hybrid pattern `canonical_base_with_live_filter` returns correct results for 3+ real pressure-test queries
- 10-live-call cap fires on pathological hybrid
- Metrics visible in system-pnl admin view
- `planner.llm_skipped_rate` measurable over a 24h window

### 19.1 What does NOT get its own phase

- Schema changes: **none in v1.** If real traffic signals a need (plan-cache persistence, audit escalation), that's a separate spec.
- Query Memory Layer promotion surface: separate feature, separate brief.
- External MCP exposure: deferred (brief §10).
- Non-GHL adapters: each provider is its own follow-on feature reusing the planner layer.

---

## 20. Test plan

### 20.1 Pure tests

Every `*Pure.ts` module ships with a sibling `*Pure.test.ts`. Spec already listed per-module cases in §7–§15. Summary:

| File | Minimum cases |
|---|---|
| `normaliseIntentPure.test.ts` | 15 |
| `registryMatcherPure.test.ts` | ~40 (35 aliases × 1 hit + ~5 edge cases — empty intent, malformed intent, collision detection, non-aliased hash, `QueryPlan` shape) |
| `planCachePure.test.ts` | 5 |
| `llmPlannerPromptPure.test.ts` | 4 |
| `validatePlanPure.test.ts` | 20 |
| `schemaContextPure.test.ts` | 8 |
| `resultNormaliserPure.test.ts` | 12 |
| `approvalCardGeneratorPure.test.ts` | 6 |
| `plannerCostPure.test.ts` | 6 (Stage 3 only / escalation / live-call count / hybrid / actual vs predicted / zero inputs) |
| `canonicalQueryRegistry.test.ts` | 1 per entry (8) + 2 structural tests |

Total: ~120 pure test cases. Each case is a single input → output assertion; nothing involves I/O, HTTP, or DB.

### 20.2 Integration tests

Testing posture for this spec follows the repo's static-gates-primary / pure-tests-secondary convention. The only carved-out integration test is RLS isolation — a genuinely hot-path cross-tenant correctness concern that can't be proven by pure tests alone. Everything else that was previously an integration test here is covered by pure tests against mocked primitives.

`server/services/crmQueryPlanner/__tests__/integration.test.ts` (single integration file, RLS-only):

- RLS: subaccount-A caller cannot see subaccount-B data (explicitly assert cross-subaccount isolation). Uses the existing `rls.context-propagation.test.ts` harness pattern — the repo's accepted integration-harness primitive for RLS.

The previously-listed end-to-end, cost-breaker, and rate-limiter cases move to pure tests elsewhere:

- End-to-end (registry-matched + fall-through) → covered by `crmQueryPlannerService.test.ts` (pure, with mocked registry / cache / llmRouter / executors).
- Cost breaker behaviour → covered by `validatePlanPure.test.ts` + `crmQueryPlannerService.test.ts` with a mocked `runCostBreaker` returning a ledger-exceeded signal; asserts `cost_exceeded` surfaces without executor dispatch.
- Rate limiter `acquire(locationId)` behaviour (no release — token-bucket) → covered by `liveExecutor.test.ts` with a mocked `getProviderRateLimiter('ghl')`; asserts the mock's `acquire` is awaited exactly once before every live dispatch, on both the happy path and the adapter-error path.

### 20.3 Pressure test (manual — brief §13)

**Before P2 ships.** Architect runs the 10–15 real query pressure test from brief §13:

1. Collect 10–15 real queries from ops notes / founder journal / support tickets. Not LLM-generated.
2. For each, assert:
   - Which stage resolves it?
   - If Stage 1: does the alias list cover the phrasing? If not, add aliases to the registry.
   - If Stage 3: does the LLM produce a plan the validator accepts? If not, tune prompt or schema context.
   - If hybrid: does it fit the `canonical_base_with_live_filter` pattern? If not, triage — is this a second pattern worth shipping, or is "unsupported" the right answer?
   - If unsupported: are the `suggestions[]` genuinely constructive?

3. Record results in `tasks/builds/crm-query-planner/pressure-test-results.md` (new file).
4. Any alias additions, synonym additions, or prompt tunings made as a result commit together with the P2 code changes.

### 20.4 Gate coverage

Must pass before merge to main:

- `npm run lint` — no errors
- `npm run typecheck` — no errors
- `npm test -- crm-query-planner` — all pure + integration tests green
- `scripts/verify-no-direct-adapter-calls.sh` — no direct provider imports
- `scripts/run-all-gates.sh` — clean

`pr-reviewer` run required before PR. `spec-reviewer` run on this spec **before** P1 starts (see §22 open questions).

---

## 21. Rollout + feature flags

### 21.1 No feature flag v1

Per `CLAUDE.md` rule: "No feature flags or backwards-compatibility shims when you can just change the code." The planner is a new subsystem; there's no prior shape to toggle off.

Access is gated by the existing skill-permission system: agents need `crm.query` in their `capabilityMap` to invoke. Orgs not yet onboarded to the planner simply don't grant the capability.

**Capability gate applies to both user-initiated and system-initiated invocations.** The `crm.query` check is enforced at the route layer (§18.1) — every HTTP caller passes through it. Any **in-process caller** that invokes `crmQueryPlannerService.runQuery` directly (scheduled Briefs, orchestrator paths, future internal agents) is responsible for performing the equivalent `capabilityMap` check **before** invoking the service — the route layer's check does not fire on direct service calls, and the service itself does not re-check (it trusts its caller on capability, matching the rest of the repo's service-layer convention). To prevent drift, `crmQueryPlannerService.runQuery` takes an explicit `callerCapabilities: Set<string>` on `ExecutorContext` that downstream executor dispatch reads for the per-entry `canonical.*` capability checks (§12.1); a caller that invokes `runQuery` without populating `callerCapabilities` gets a deterministic `MissingPermissionError` on the first canonical dispatch, not silent bypass. No exemption path ships in v1; the "internal system caller" concept is deferred until a concrete internal caller needs it, at which point the exemption is a typed field on `ExecutorContext`, not an implicit bypass.

**Missing-capability failure mode (explicit invariant).** A request lacking `crm.query` at the route layer, or lacking a required per-entry `canonical.*` capability at executor dispatch (via §11.2 rule 10 / §12.1), resolves to `BriefErrorResult { errorCode: 'missing_permission', message, suggestions? }`. **No fallback is attempted** — the planner does not silently rewrite a canonical plan into a live plan, degrade the projection, or drop the filter. The user (or calling agent) must either acquire the capability or accept the refusal. This matches the `MissingPermissionError` internal class (§12.1); the service-level translation is `errorCode: 'missing_permission'`. The error code is deliberately `missing_permission` rather than `unauthorized` to match the existing taxonomy in `shared/types/briefResultContract.ts` and to distinguish from authentication failures (which are handled by the `authenticate` middleware at the route layer and never reach the planner).

### 21.2 System-settings for tier config

Added to `systemSettings` table (existing — no schema change, just new rows):

| Key | Default | Purpose |
|---|---|---|
| `crm_query_planner_default_tier` | `'haiku'` | Stage 3 default model |
| `crm_query_planner_escalation_tier` | `'sonnet'` | Escalation model |
| `crm_query_planner_confidence_threshold` | `0.6` | Below this = escalate |
| `crm_query_planner_per_query_cents` | `100` | Per-query cent ceiling |
| `crm_query_planner_schema_tokens_default` | `2000` | Schema-context token budget |
| `crm_query_planner_schema_tokens_escalated` | `4000` | Budget during escalation |

Per-org override: `organisation_hierarchies.operational_config.crm_query_planner = { ... }` if present overrides system defaults. Already-existing pattern — no new config wiring needed.

### 21.3 Phased rollout per org

This is **capability-grant rollout**, not infrastructure-level staged rollout. Code ships to all instances simultaneously on P3 merge — there is no traffic-shifting, no feature flag, no per-org code path, and no canary deploy. Rollout here means onboarding orgs to the planner one at a time via the existing skill-permission system (granting `crm.query` in an org's `capabilityMap`), which is standard operational practice and not in tension with the codebase's "no staged rollout" posture.

Once P3 ships on main, orgs are onboarded one at a time:

1. Grant `crm.query` capability to the org's Orchestrator agent.
2. Run pressure-test queries against that org's subaccount to verify real-data performance.
3. Expand to other agents in the org as confidence grows.
4. `planner.llm_skipped_rate` per org visible in system-pnl; if it's degrading for a specific org, investigate before broader rollout.

No automatic rollout — each org is a conscious decision based on traffic and data shape.

---

## 22. Open questions for implementation

Tracked as `// TODO(spec-open-N)` in code; surfaced at PR review time.

1. **`canonicalDataService` extensions — drizzle query shape.** Each new handler (e.g. `listInactiveContacts`) needs the exact drizzle query. Handler body shown in §12.3 is directional; the implementer confirms the current schema's column names and indexes during P1. If any column the handler needs is missing, that's an open question, not a blocker — the spec falls through to live for that query class until canonical catches up.
2. **~~Dependency-cruiser rule for read-only enforcement.~~ Closed.** v1 ships `scripts/verify-crm-query-planner-read-only.sh` as a repo-style static gate (see §13.3 / §16.6). Matches the existing `verify-*.sh` convention; no dependency-cruiser adoption required.
3. **Stage 2 cache persistence.** v1 is in-process; process restart loses the cache. Open question: should we persist to Redis for multi-instance deployments? Decision point: once we observe `planner.llm_skipped_rate` drift across instances, not before. The hit-rate metric is the trigger.
4. **Schema-context compression — concrete algorithm.** §11.11 specifies "entity-level summaries + top-N fields per entity + per-query filtering." The exact summarisation algorithm (top-N by what? frequency? alphabetical?) is deferred to implementation — initial cut is static-ranked (most commonly-used fields per entity, hardcoded list); pressure-test results inform whether to replace with frequency-weighted.
5. **LLM intent-parse timeout.** How long before Stage 3 is abandoned? No explicit v1 timeout specified; `llmRouter` has its own default. Open question: does the planner need a stricter override? Recommend no — router defaults are tuned for the cost envelope and we don't want to introduce a second timeout source.
6. **Per-run cost ledger attribution for planner calls.** The planner's Stage 3 call is a normal `llmRouter` call and lands in the ledger automatically. Open question: do we need a `featureTag: 'crm-query-planner'` dimension in the per-run cost panel so users can see "of this run's cost, X cents came from CRM queries"? Recommend yes — small extension, high ops value.

---

## Deferred Items

Consolidated list of every v1 exclusion with an explicit verdict. Authoring-checklist §7 requires a single `## Deferred Items` section; the items below are the canonical source. References in §1.2, §1.3, §2.1, §9.2, §15.4, §17, §22 point here.

Verdict legend:
- **DEFER-V2** — known follow-on scope; will be picked up in a dedicated follow-on when the trigger fires
- **WON'T-DO** — explicit non-goal, not planned to ship regardless of signal
- **BUILD-WHEN-SIGNAL** — ship only when a named metric or real incident justifies it

| Item | Verdict | Trigger / Reason |
|---|---|---|
| Hybrid patterns beyond `canonical_base_with_live_filter` (§1.2) | BUILD-WHEN-SIGNAL | `planner.hybrid_unsupported_rate` climbs **after P3 ships** (the metric is suppressed pre-P3 — see §17.2) AND pressure-test (§20.3) surfaces a second pattern worth codifying |
| Semantic / fuzzy plan-cache match (§1.2) | BUILD-WHEN-SIGNAL | Exact-match `planner.llm_skipped_rate` plateaus below target before alias coverage exhausts — i.e. deterministic coverage is blocked by phrasing drift, not missing aliases |
| Query Memory Layer surfacing (§1.2, §17.3) | DEFER-V2 | Owned by a follow-on spec — Layer's promotion dashboard + workflow. Event shape is v1-locked so v2 can consume without migration |
| Non-GHL live executors (HubSpot, Salesforce, Pipedrive) (§1.2) | DEFER-V2 | Same planner, new adapter — ships when a second CRM integration is in-scope; no v1 work |
| Agent-facing `crm.schema_describe` skill (§1.2, §2.1 brief §11.3) | WON'T-DO (unless signal) | Automatic Stage 3 injection makes a round-trip skill redundant; revisit only if schema injection cost exceeds the per-query ceiling |
| Brief-surface export / saved-segment affordances (§1.2) | DEFER-V2 | Owned by the Brief-surface branch |
| External MCP exposure of the planner (§1.2) | WON'T-DO | Architectural non-goal — planner is an internal primitive; external agents hit the Brief surface |
| Universal Brief chat surface (§1.2) | DEFER-V2 | Owned by a separate branch |
| Free-text writes via the planner (§1.2) | WON'T-DO | Writes remain review-gated `crm.*` skills; planner is read-only by design |
| Plan-cache persistence (Redis / multi-instance) (§22.3) | BUILD-WHEN-SIGNAL | `planner.llm_skipped_rate` drift observed across instances (deployment mode dependent) |
| Schema-change-driven cache invalidation (§9.2) | DEFER-V2 | 60s TTL is sufficient in v1; revisit if TTL-drift causes real staleness incidents |
| Batch-email approval card (one approval, N sends) (§15.4) | DEFER-V2 | Requires a new batch `crm.send_email_batch` action slug in `actionRegistry`; v1 ships single-contact only |
| `topAliasSimilarity` analytics on `planner.stage1_missed` (§17.1) | BUILD-WHEN-SIGNAL | Surfacing near-miss aliases is useful only once Stage 1 coverage plateaus below target |
| Dependency-cruiser rule for read-only enforcement (§22.2) | WON'T-DO (closed) | Replaced by `scripts/verify-crm-query-planner-read-only.sh` static gate; no dependency-cruiser adoption required |
| Stopgap "Ask CRM" standalone panel (§3 context) | WON'T-DO | Brief surface is the CRM question UX; no second entry point |
| Per-subaccount rate-limit budget (§2.1 brief §11.5) | BUILD-WHEN-SIGNAL | Real traffic surfaces cross-subaccount starvation on `getProviderRateLimiter('ghl')` |
| Native planner event types in `AgentExecutionEventType` (§17) | BUILD-WHEN-SIGNAL | Agent Live Execution Log rendering is confusing because planner stages get squashed into generic `skill_start`/`skill_complete`. If that happens, add `planner.*` event types to `shared/types/agentExecutionLog.ts` and teach `agentExecutionEventService` about them |
| Canonical-data capability source of truth (§12.1) | DEFER-V2 | v1 leaves `canonical.contacts.read`, `canonical.opportunities.read`, `canonical.appointments.read`, `canonical.conversations.read`, `canonical.revenue.read`, `canonical.tasks.read`, `clientpulse.health_snapshots.read` as forward-looking per-entry metadata on `CanonicalQueryRegistryEntry.requiredCapabilities`. v2 declares the concrete source of truth (likely an integration-reference addition for a synthetic `canonical` integration, or a dedicated capability-catalogue file) and activates per-entry enforcement; v1 relies on the `crm.query` route gate |

Each entry has a verdict and a trigger or reason. Items with `BUILD-WHEN-SIGNAL` include the specific metric or condition that would unblock them — absence of that signal is the reason not to ship now.

---

## 23. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stage 3 LLM produces plans the validator keeps rejecting, yielding high `ambiguous_intent` rates | M | M | Pressure test (§20.3) exposes this before P2 ships; add few-shot examples to prompt if needed |
| Canonical handler extensions don't match existing drizzle schema shape | M | L | P1 catches this at implementation; blocker is isolated to that one handler |
| Hybrid executor's 10-call cap fires on legitimate queries, frustrating users | L | M | `hybrid_unsupported_rate` metric catches this; raise cap if real queries are consistently below cap but still failing |
| LLM cost exceeds budget before `planner.llm_skipped_rate` improves | M | M | Per-query cent ceiling (§16.2) is the circuit breaker; `runCostBreaker` is the backstop |
| Real operator phrasing doesn't match conservative v1 alias list, Stage 1 hit rate is low | H | M | Pressure test + alias-list tuning; synonym map is the main lever. First 2 weeks of real traffic will reveal the biggest misses |
| Planner-vs-Orchestrator boundary drift (implementer teaches Orchestrator to pre-classify) | L | H | Brief §1 + this spec §3 explicitly state the boundary. `pr-reviewer` catches violations. KNOWLEDGE.md entry pins the rule |
| Schema-context injection bloats context window, Stage 3 latency climbs | M | L | Token budget (§16.1) caps injection; pressure test measures actual sizes |
| Query Memory Layer assumptions in event schema turn out wrong when we actually build it | L | L | v2's problem; v1 captures all the obvious fields, v2 can extend |

---

## 24. Success criteria

A senior reviewer can answer yes to all of:

1. **The planner is the single entry point for CRM reads.** No surface — chat, agent tool call, direct API — reads CRM data without going through the planner.
2. **Deterministic-first is measurable.** `planner.llm_skipped_rate` reports above 0 on day one of P3, and rises over time as aliases and cache accumulate.
3. **All 8 registry entries resolve via Stage 1 for their primary phrasings.** Every alias in the registry hits the registry-backed matcher.
4. **Stage 3 LLM output always passes or cleanly fails.** No in-between states reach the executor. Validator authority is observable via `planner.validation_failed` vs `planner.classified` event counts.
5. **Read-only is statically enforced.** No write helper is in scope for the live executor. Attempted write-helper imports fail `scripts/verify-crm-query-planner-read-only.sh` at CI, before any runtime code executes.
6. **Cost is bounded per query and per run.** Per-query cent ceiling (§16.2) is checked post-Stage-3 — after parse + any escalation — and fires before executor dispatch; per-run ceiling is the backstop via `runCostBreaker` and is checked both before Stage 3 and before live-executor dispatch.
7. **Failure is a first-class state.** Every error result carries `suggestions[]` that are valid follow-up Briefs. No dead ends.
8. **Rate-limit fair-queueing holds.** ClientPulse polling and planner live queries both use `getProviderRateLimiter('ghl')`; neither starves the other.
9. **Observability feeds the future learning loop.** Event payloads include `stageResolved`, `canonicalCandidateKey`, `intentHash`, `hitCount` — the data a Query Memory Layer needs to identify promotion candidates.
10. **Pressure test run and documented.** Results written to `tasks/builds/crm-query-planner/pressure-test-results.md` before P2 ships; any alias / synonym / prompt tunings committed alongside the code.
11. **No DB-level schema changes.** No new tables, no new columns, no migrations — migration count unchanged. The one change to `server/db/schema/llmRequests.ts` is a TypeScript-const extension (`TASK_TYPES` adds `'crm_query_planner'`); the `llmRequests` table and its `task_type` column remain unchanged at the database level.
12. **No new governance primitives.** `llmRouter`, `runCostBreaker`, `getProviderRateLimiter`, `withPrincipalContext` all reused as-is.
13. **Correctness proxy is measurable, not just efficiency.** The `planner.brief_refinement_rate` metric (§17.2) is computable from v1 events — `briefId` correlation across `planner.classified` and `planner.error_emitted`. Efficiency metrics (`llm_skipped_rate`, cost) cannot be the only success signals, because they can both improve while correctness degrades (cheap wrong plans). Rendering the metric in a dashboard is P3+; computability on v1 data is the P1 gate.

If yes to all thirteen, P3 is ready for `pr-reviewer` and PR to main.

---

## Appendix A — Pre-review checklist

Per `docs/spec-authoring-checklist.md`:

- [x] **Existing primitives search** — `llmRouter`, `canonicalDataService`, `ghlAdapter`, `runCostBreaker`, `getProviderRateLimiter`, `withPrincipalContext`, `actionRegistry`, `agentExecutionEventEmitter`, `systemSettings` all identified and reused.
- [x] **File inventory lock** — §5 lists every new/extended file.
- [x] **Contracts section** — §6 defines all types; `shared/types/crmQueryPlanner.ts` is the single source of truth.
- [x] **Permissions / RLS** — §16.4 covers principal context; read-only guarantees in §16.6.
- [x] **Execution model** — §3 + §4 cover sync vs async (sync), inline vs queued (inline), cached vs dynamic (both).
- [x] **Phase sequencing** — §19 shows dependency graph: P1 (deterministic) → P2 (LLM + live) → P3 (hybrid + observability).
- [x] **Deferred items section** — single `## Deferred Items` section between §22 and §23 consolidates all v1 exclusions with explicit DEFER-V2 / WON'T-DO / BUILD-WHEN-SIGNAL verdicts; references in §1.2, §1.3, §2.1, §9.2, §15.4, §17, §22 all point to it.
- [x] **Self-consistency pass** — final edit scheduled before `spec-reviewer`.
- [x] **Testing posture** — §20 covers pure, integration, pressure-test, gate coverage.

---

End of spec.
