# LLM Routing Debug & Reporting — Spec (LOCKED)

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
| `fallback_chain` | `jsonb`, nullable | Structured list of providers attempted. Includes failures and (on success) the final success entry. `null` when no fallback occurred. |

**`fallback_chain` structure:**

On success after fallback:
```json
[
  { "provider": "anthropic", "model": "claude-sonnet-4-6", "error": "rate_limited" },
  { "provider": "openai", "model": "gpt-4o", "error": "timeout after 30000ms" },
  { "provider": "gemini", "model": "gemini-2.5-flash", "success": true }
]
```

On total failure (all providers exhausted):
```json
[
  { "provider": "anthropic", "model": "claude-sonnet-4-6", "error": "rate_limited" },
  { "provider": "openai", "model": "gpt-4o", "error": "timeout after 30000ms" }
]
```
No `success: true` entry. The `status` field on the ledger row will be `error`/`provider_unavailable`/etc. UI renders this as "Failed after N attempts".

Each failed attempt gets `{provider, model, error}`. The final successful provider gets `{provider, model, success: true}`.

Using `jsonb` rather than `text` — queryable, indexable, safer parsing.

No new tables. No new indexes (existing `orgMonthIdx`, `subaccountMonthIdx`, `createdAtIdx` cover the query patterns).

### Migration

File: `migrations/0051_routing_debug_columns.sql`

---

## Backend Changes

### 1. Router data capture (`server/services/llmRouter.ts`)

**Fallback chain tracking:**
- Track `fallbackAttempts: FallbackAttempt[]` during provider fallback loop
- On every provider failure, push `{provider, model, error: message}`
- On success, push `{provider, model, success: true}`
- On total failure, array contains only error entries
- Write `fallbackChain` when `fallbackAttempts.some(a => a.error)`, else `null`
- Always write `requestedProvider` and `requestedModel` on all 3 insert paths

**Escalation context:**
- `wasEscalated` and `escalationReason` added to `LLMCallContextSchema`
- Written to ledger on all insert paths via `ctx.wasEscalated ?? false`

### 2. Escalation tracking (`server/services/agentExecutionService.ts`)

Completed the TODO at line 1003. Escalated `routeCall` now passes:
```typescript
wasEscalated: true,
escalationReason: `economy_invalid_tool_calls: ${validation.failureReason}`,
```

### 3. New service (`server/services/llmUsageService.ts`)

- `getRoutingLog()` — paginated, filtered, composite cursor `(createdAt DESC, id DESC)`
- `getRoutingDistribution()` — SQL aggregations (conditional, GROUP BY), not JS loops
- `getRequestDetail()` — single row by ID, org-scoped

### 4. New API endpoints (`server/routes/llmUsage.ts`)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/subaccounts/:id/usage/routing-log` | `SETTINGS_VIEW` + `resolveSubaccount` | Paginated routing log |
| `GET /api/subaccounts/:id/usage/routing-distribution` | `SETTINGS_VIEW` + `resolveSubaccount` | Distribution stats |
| `GET /api/subaccounts/:id/usage/requests/:requestId` | `SETTINGS_VIEW` + `resolveSubaccount` | Single request detail |
| `GET /api/orgs/:id/usage/routing-log` | `SETTINGS_VIEW` | Org-scoped routing log |
| `GET /api/orgs/:id/usage/routing-distribution` | `SETTINGS_VIEW` | Org-scoped distributions |

---

## Frontend Changes

### Routing tab on UsagePage

#### Anomaly Flags
- Fallback rate, escalation rate, economy usage
- Color-coded: green/amber/red based on structured thresholds

#### Distribution Charts
- Total cost anchor + request count
- 4 horizontal percentage bars: tier, reason, status, phase
- Latency summary by tier and provider

#### Request Log
- 10 filter controls (dropdowns for enums, free text for agent/run)
- Paginated table with composite cursor
- `requested -> actual` display for fallback rows
- "Failed after N attempts" for total failure rows
- Contextual empty state guidance

#### Request Detail Drawer
- Full metadata grid
- Fallback chain vertical timeline
- Token/cost breakdown
- Audit hashes and IDs

---

## What this does NOT include

- No new chart library (CSS bars matching existing BudgetBar)
- No real-time streaming
- No historical data backfill
- No decision input capture (budget/capabilities — can add later)
- No merge of routing + runs tabs
- No org-configurable anomaly thresholds (structured constants, ready for future config)
