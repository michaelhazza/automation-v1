# LLM Routing Debug & Reporting — Spec

## Problem

The LLM router captures rich per-request routing metadata in the `llm_requests` ledger table — `routingReason`, `capabilityTier`, `wasDowngraded`, `executionPhase`, `status` — but none of this is exposed in the UI. Admins have no way to inspect individual routing decisions, filter by routing characteristics, or see distribution patterns.

The existing UsagePage shows aggregate-only data: cost per provider/model, per agent, per run. There is zero visibility into **why** a particular provider/model was chosen.

## Goal

Give org admins and subaccount admins a debugging surface to:
1. See a paginated log of individual LLM requests with full routing metadata
2. Filter by any routing dimension (provider, model, tier, reason, phase, status, etc.)
3. See routing decision distribution charts (economy vs frontier, reason breakdown, etc.)
4. Drill into a single request for full detail including fallback chain and escalation info
5. Surface anomaly signals (high fallback %, high escalation %) without manual scanning

## Who sees what

| User | Permission | Scope |
|------|-----------|-------|
| Org admin | `SETTINGS_VIEW` (existing) | All requests across all subaccounts |
| Subaccount admin | `SETTINGS_VIEW` (existing) | Requests scoped to their subaccount |

No new permission keys needed.

## Where it lives

New **"Routing"** tab on the existing UsagePage — 5th tab alongside Overview / Agents / Models / Runs.

Both org-level and subaccount-level UsagePage get this tab. No new pages, no new nav items.

---

## Schema Changes

### New columns on `llm_requests`

| Column | Type | Purpose |
|--------|------|---------|
| `requested_provider` | `text`, nullable | What the resolver originally picked (before fallback changed it) |
| `requested_model` | `text`, nullable | What the resolver originally picked |
| `fallback_chain` | `text`, nullable | JSON: `[{provider, model, error}]` — structured list of providers attempted before success. `null` when no fallback occurred. |

No new tables. No new indexes (existing `orgMonthIdx`, `subaccountMonthIdx`, `createdAtIdx` cover the query patterns).

### Migration

File: `migrations/0051_routing_debug_columns.sql`

```sql
ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS requested_provider text,
  ADD COLUMN IF NOT EXISTS requested_model text,
  ADD COLUMN IF NOT EXISTS fallback_chain text;
```

---

## Backend Changes

### 1. Router data capture (`server/services/llmRouter.ts`)

**Fallback chain tracking:**
- Track `attemptedProviders: {provider, model, error}[]` during the provider fallback loop (lines 357-437)
- On every provider failure in the loop, push `{provider, model, error: message}` to the array
- On all three ledger insert paths (budget-blocked, all-providers-failed, success), write:
  - `requestedProvider = effectiveProvider` (what resolver picked)
  - `requestedModel = effectiveModel` (what resolver picked)
  - `fallbackChain = JSON.stringify(attemptedProviders)` when the array is non-empty, else `null`

**Escalation context:**
- Add `wasEscalated` and `escalationReason` to `LLMCallContextSchema` as optional fields
- On the success ledger write path (line 552-610), read these from context and write them
- This allows the escalated call in agentExecutionService to pass escalation metadata through

### 2. Escalation tracking (`server/services/agentExecutionService.ts`)

Complete the TODO at line 1003. On the escalated `routeCall` (line 986-997), add to the context:

```typescript
context: {
  ...routerCtx,
  taskType: 'development',
  executionPhase: phase,
  provider: agent.modelProvider,
  model: agent.modelId,
  routingMode: 'forced' as const,
  wasEscalated: true,
  escalationReason: `economy_invalid_tool_calls: ${validation.failureReason}`,
},
```

Remove the TODO comment.

### 3. New service (`server/services/llmUsageService.ts`)

New service following architecture rules (routes call services, never db directly).

**Functions:**

```typescript
// Paginated, filtered routing log
getRoutingLog(filters: RoutingLogFilters, pagination: { cursor?: string; limit?: number })
  => { items: LlmRequest[], nextCursor: string | null }

// Aggregated routing distributions for charts
getRoutingDistribution(filters: { organisationId: string; subaccountId?: string; billingMonth: string })
  => {
    byTier:     { frontier: number; economy: number },
    byReason:   Record<string, number>,     // forced/ceiling/economy/fallback
    byPhase:    Record<string, number>,     // planning/execution/synthesis
    byStatus:   Record<string, number>,     // success/error/timeout/etc
    byProvider:  Record<string, number>,     // anthropic/openai/gemini/openrouter
    costByTier:  { frontier: number; economy: number },  // cents
    costByReason: Record<string, number>,                 // cents
    totalRequests: number,
    fallbackPct:   number,  // anomaly signal
    escalationPct: number,  // anomaly signal
    downgradePct:  number,  // anomaly signal
  }

// Single request detail
getRequestDetail(id: string, organisationId: string)
  => LlmRequest | null
```

**RoutingLogFilters type:**

```typescript
interface RoutingLogFilters {
  organisationId: string;
  subaccountId?: string;
  billingMonth?: string;         // defaults to current month
  provider?: string;
  model?: string;
  routingReason?: string;
  capabilityTier?: string;
  executionPhase?: string;
  status?: string;
  agentName?: string;
  wasDowngraded?: boolean;
  wasEscalated?: boolean;
  runId?: string;
}
```

Queries hit existing indexes. Cursor pagination keyed on `createdAt` descending. Default limit 50, max 100.

### 4. New API endpoints (`server/routes/llmUsage.ts`)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/subaccounts/:subaccountId/usage/routing-log` | GET | `SETTINGS_VIEW` | Paginated routing log |
| `/api/subaccounts/:subaccountId/usage/routing-distribution` | GET | `SETTINGS_VIEW` | Distribution stats |
| `/api/subaccounts/:subaccountId/usage/requests/:requestId` | GET | `SETTINGS_VIEW` | Single request detail |
| `/api/orgs/:orgId/usage/routing-log` | GET | `SETTINGS_VIEW` | Org-scoped routing log |
| `/api/orgs/:orgId/usage/routing-distribution` | GET | `SETTINGS_VIEW` | Org-scoped distributions |

All new routes call `llmUsageService` — no direct db access.

**Query parameters for routing-log:**

```
?month=2026-04
&provider=anthropic
&model=claude-sonnet-4-6
&routingReason=fallback
&capabilityTier=economy
&executionPhase=execution
&status=error
&agentName=research-agent
&wasDowngraded=true
&wasEscalated=true
&runId=uuid
&cursor=2026-04-03T12:00:00.000Z
&limit=50
```

All filters are optional. Multiple filters are AND-combined.

---

## Frontend Changes

### Routing tab on UsagePage (`client/src/pages/UsagePage.tsx`)

Add `'routing'` to the `Tab` union type. Add tab button to `TabBar`.

The routing tab has three sections:

#### Section 1: Anomaly Flags (top)

Simple callout boxes computed from distribution data:

- Fallback rate: `X% of requests required provider fallback` (warn if >5%)
- Escalation rate: `X% of requests were escalated from economy to frontier` (warn if >10%)
- Downgrade rate: `X% of requests used economy tier` (informational)

Colored: green (normal), amber (elevated), red (high). Thresholds are display-only, not configurable.

#### Section 2: Distribution Charts (middle)

Four horizontal percentage bars (same pattern as existing `BudgetBar`):

1. **Tier split** — frontier vs economy (% of requests + cost for each)
2. **Routing reason** — forced / ceiling / economy / fallback
3. **Status** — success / error / timeout / budget_blocked / etc
4. **Phase** — planning / execution / synthesis

Each bar shows both request count and cost side by side.

#### Section 3: Request Log (bottom)

**Filter bar** — row of dropdown selects + text inputs:
- Provider (dropdown: all providers from distribution data)
- Model (dropdown)
- Routing Reason (dropdown: forced/ceiling/economy/fallback)
- Tier (dropdown: frontier/economy)
- Phase (dropdown: planning/execution/synthesis)
- Status (dropdown)
- Downgraded (dropdown: yes/no/any)
- Escalated (dropdown: yes/no/any)
- Agent name (text input)
- Run ID (text input)

**Table columns:**

| Column | Content |
|--------|---------|
| Time | `createdAt` formatted as `Apr 3, 2:15 PM` |
| Agent | `agentName` |
| Provider / Model | `provider` + `model` (with `requestedProvider/Model` shown if different) |
| Phase | `executionPhase` badge |
| Tier | `capabilityTier` badge (colored: indigo=frontier, emerald=economy) |
| Reason | `routingReason` badge |
| Status | `status` badge (green=success, red=error, amber=timeout, etc) |
| Latency | `providerLatencyMs` formatted as seconds |
| Overhead | `routerOverheadMs` formatted as ms |
| Cost | `costWithMarginCents` formatted |

Rows are clickable.

**"Load more" button** at bottom for cursor pagination.

#### Section 4: Request Detail (click a row)

Slide-out panel or modal showing full request metadata:

- All table columns (expanded)
- Requested vs actual provider/model (if fallback occurred)
- Fallback chain: ordered list of `{provider, model, error}` attempts
- Escalation info: `wasEscalated`, `escalationReason`
- Token breakdown: `tokensIn`, `tokensOut`, `cachedPromptTokens`
- Cost breakdown: `costRaw`, `costWithMargin`, `marginMultiplier`
- Hashes: `requestPayloadHash`, `responsePayloadHash`
- IDs: `id`, `idempotencyKey`, `runId`, `executionId`
- Timestamps: `createdAt`

---

## Implementation Order

| # | Chunk | Files | Dependencies |
|---|-------|-------|-------------|
| 1 | Schema + migration | `server/db/schema/llmRequests.ts`, `migrations/0051_routing_debug_columns.sql` | None |
| 2 | Router fallback + escalation data capture | `server/services/llmRouter.ts`, `server/services/agentExecutionService.ts` | Chunk 1 |
| 3 | llmUsageService | `server/services/llmUsageService.ts` (new) | None |
| 4 | API endpoints | `server/routes/llmUsage.ts` | Chunk 3 |
| 5 | Routing tab UI — filters + log + detail | `client/src/pages/UsagePage.tsx` | Chunk 4 |
| 6 | Distribution charts + anomaly flags | `client/src/pages/UsagePage.tsx` | Chunk 4 |

Chunks 1-2 and 3-4 can run in parallel.

---

## What this does NOT include

- No new chart library (CSS percentage bars matching existing `BudgetBar` pattern)
- No real-time streaming (data loads on tab visit + month change)
- No historical data backfill (new columns will be null for old rows)
- No external dashboard integration (Langfuse already serves deep tracing)
- No decision input capture (budget snapshots, candidate model lists) — the routing reason + tier + fallback chain already explain "why" sufficiently. Can add later if needed.
- No merge of routing + runs tabs (good future idea, out of scope)

---

## Verification Plan

1. **Schema**: `npm run db:generate` — verify migration file generates cleanly
2. **Router**: Manual inspection that all 3 ledger insert paths write new columns
3. **Service**: Unit-level verification — org scoping, cursor pagination, filter combinations
4. **API**: Auth + permission guards present, resolveSubaccount called on subaccount routes
5. **UI**: Tab renders, filters trigger API calls, pagination works, detail drawer shows data
6. **Full stack**: `npm run typecheck && npm run lint && npm run build`
