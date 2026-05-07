**Status:** draft
**Spec date:** 2026-05-07
**Last updated:** 2026-05-07 (chatgpt-spec-review round 1 — list-endpoint invariants, auto-memory override gate, time-window definitions, "Other" rollup rules, connection-test enum, snapshot consistency, body-hash canonicalisation, cost precision, status enum tightened to three values; all 12 sections complete)
**Author:** michael
**Build slug:** consolidation-govern
**Depends on:** `tasks/builds/consolidation-foundation/spec.md` (Phase 0; primitives must land first)

---

# Consolidation C — Govern

> Phase-2 stream C of the four-spec consolidation programme. Delivers the **governance** surface: **Knowledge** (workspace + org views with auto-memory provenance and Edit-and-override), **Spending** (Ledger + Caps & budgets in workspace and org views, with insight tiles and SVG trend charts capped at top 5 workspaces), and **Connections** (15-row connections list with sort/filter, replacing the legacy 3-row Logins). Builds against Spec 0 primitives.

## Table of contents

0. Programme context
1. Goals
2. Non-goals
3. Existing primitives audit
4. Public API contracts
5. File inventory
6. Permissions / RLS / Execution model
7. Phase / chunk plan
8. Testing posture
9. Coordination with Foundation, A, B
10. Deferred items
11. Self-consistency check
12. Pre-review checklist

## 0. Programme context

The 2026-05-06 prototype consolidates ~25 existing pages into ~12. Spec C owns the **Govern** surface — what does the platform know, what does it cost, what is it connected to. Reference prototypes: `prototypes/consolidation-2026-05-06/{knowledge,org-knowledge,spending,integrations}.html`.

This spec assumes `consolidation-foundation` has shipped or is in flight; foundation §4 contracts are locked. Primary primitives consumed: `<SortableTable>` (knowledge entries, spending Ledger, spending caps, connections), `useViewMode` + `<ViewModeSwitcher>` (workspace vs org views on knowledge and spending), `<Modal>` (Edit-and-override flow, connection-add modal, integration-detail modal), `<PageShell>`, `<WorkspaceBadge>`.

## 1. Goals

1. Consolidate workspace memory + org memory into two pages: `KnowledgePage` (workspace) and `OrgKnowledgePage` (org). Each surfaces auto-memory entries with provenance (which run extracted them), confidence score, status (pending review / in use / ignored), and Edit-and-override action that detaches the entry from future auto-updates.
2. Replace the existing spending UI with a consolidated `SpendingPage` that has two tabs (Caps & budgets, Ledger) and respects view-mode (workspace / org). Org view adds: Top spender / Fastest grower / Most active agent insight tiles on Ledger; split org-monthly-cap section + per-workspace bar chart + two trend line charts on Caps & budgets, all capped at top 5 workspaces by current MTD spend.
3. Replace the existing logins / connections page with `ConnectionsPage` (Connections is the new name; integrations.html is the prototype filename) containing all credential-bearing connections: OAuth integrations, web logins (cookie-based scrapers), MCP servers, etc. Single sortable+filterable table, 15-row reference set in the prototype.
4. Keep existing backend domain APIs in place. Extend only what the consolidated UI demands (knowledge auto-memory pipeline already exists; add Edit-and-override action; spending ledger + caps APIs already exist; add insight aggregator).
5. No new domain logic — this stream is mostly UI consolidation over existing services.

## 2. Non-goals

1. Building any of the Operate-stream pages (home, inbox, activity, run-trace) or Build-stream pages (agents, agent-edit, recurring-tasks, project-edit). Specs A and B own those.
2. Replacing the auto-memory extraction pipeline, the spend ledger, or the OAuth/credential service. This stream consumes those, doesn't redefine them.
3. Introducing a new identity or scope primitive. Workspace / Org view modes use foundation `useViewMode`.
4. Adding a UI test framework. Frontend tests remain `none_for_now`.
5. Building any cross-cutting frontend primitive. SVG charts in spending are inline (vanilla, no chart library) — they're page-scoped, not foundation primitives.

## 3. Existing primitives audit

| Primitive | Existing | Verdict | Reason |
|---|---|---|---|
| Knowledge / memory entries API | `server/routes/knowledge.ts`, `server/db/schema/memoryBlocks.ts` + `memoryBlockVersions.ts`, `server/services/agentBeliefService.ts` | **Extend** | Reads + provenance already exist. Add an `Edit and override` action that detaches an entry from auto-extraction (sets `auto_update_disabled = true` and creates a manual revision). |
| Memory review queue | `server/routes/memoryReviewQueue.ts` | Reuse | Powers the "Pending review" status filter on knowledge. |
| Memory inspector | `server/routes/memoryInspector.ts` | Reuse | Read-only diagnostic; no consumer change. |
| Spend ledger | `server/services/agentSpendAggregateService.ts` (+ `*Pure.ts`) | **Extend** | Add a paged ledger-list endpoint with multi-select filters (workspace / agent / type) + sort. Existing aggregator powers KPI rollups; ledger-row read is additive. |
| Compute budget | `server/services/computeBudgetService.ts` (+ `*Pure.ts`) | Reuse | Per-workspace caps + warn thresholds. Read for the Caps & budgets tab. |
| Spend insights | None | **New** (`spendInsightsService.ts`) | Top spender / fastest grower / most active agent — pure aggregator over existing ledger data. No persistence. |
| Spend trends (top 5 chart data) | None | **New** (`spendTrendsService.ts`) | Per-workspace MTD spend over last 6 months + cap utilisation %, ranked + capped to top 5. Pure aggregator. |
| Integration connections | `server/routes/integrationConnections.ts`, `server/db/schema/integrations/*` | **Extend** | List endpoint expanded to surface all credential-bearing connections (OAuth + web login + MCP + cookie-based) under a unified shape. Existing per-kind endpoints preserved. |
| OAuth integrations | `server/routes/oauthIntegrations.ts` | Reuse | Detail endpoint + connect/disconnect flows preserved. |
| Org connections | `server/routes/orgConnections.ts` | Reuse | Org-scoped subset already supported. |
| Connection token service | `server/services/connectionTokenService.ts` | Reuse | Used by the existing detail flows. |
| Frontend SortableTable | Foundation §4.3 | Consume | Knowledge entries (filter by status + agent + tag), Ledger (workspace/agent/type filterable), per-workspace caps (workspace filterable), Connections (provider/auth-method/status filterable). |
| Frontend Modal | Foundation §4.1 | Consume | Edit-and-override flow, connection-add modal, integration-detail modal, knowledge-entry detail modal. |
| Frontend ViewModeSwitcher / useViewMode | Foundation §4.4–4.6 | Consume | Knowledge and Spending honour `viewMode` (workspace vs org). System view not used in this stream. |
| Frontend WorkspaceBadge | Foundation §4.5 | Consume | Spend Ledger workspace column, knowledge org-view subaccount column, connections workspace column where relevant. |
| Frontend PageShell | Foundation §4.8 | Consume | Wrapper for all pages. |
| Existing WorkspaceMemoryPage | `client/src/pages/WorkspaceMemoryPage.tsx` | **Replace** | Folded into KnowledgePage. |
| Existing org-memory page (if separate) | `client/src/pages/...` | **Replace** | Folded into OrgKnowledgePage (or KnowledgePage with viewMode='org'; final shape decided in plan). |
| Existing SpendingBudgetDetailPage | `client/src/pages/SpendingBudgetDetailPage.tsx` | **Replace** | Folded into SpendingPage caps tab. |
| Existing spending list / ledger pages | `client/src/pages/...` | **Replace** | Folded into SpendingPage Ledger tab. |
| Existing integrations / logins page | `client/src/pages/...` | **Replace** | Replaced by ConnectionsPage. |
| `<SearchBox>` (foundation Phase 0 patch) | Foundation §4.9 | Consume | Knowledge search (full-text), Spending ledger search, Connections search. |
| `<EmptyState>` / `<ErrorState>` (foundation Phase 0 patch) | Foundation §4.10/4.11 | Consume | Empty knowledge results, empty ledger after filter, empty connections, network failure on any list. |
| `<ConfirmDialog>` | `client/src/components/ConfirmDialog.tsx` | Reuse | Knowledge reject, knowledge override (when overwriting an in-use entry), connection disconnect (with impact warning), org-level memory bulk push (deferred). |
| Audit events | `server/db/schema/auditEvents.ts` | Reuse | Override actions on knowledge entries write to existing audit log; no new table. |

**Verdict summary:** three pages (or four — knowledge/org-knowledge may merge into one with view-mode toggle, decided in plan), two new pure-aggregator services (`spendInsightsService`, `spendTrendsService`), backend extensions on knowledge (Edit-and-override action) and integration-connections (unified list). Possibly one additive column (`memory_blocks.auto_update_disabled boolean`). One migration if so. Zero new shared frontend primitives.

**Out-of-scope items (deferred per §10):** bulk operations (mass-approve knowledge entries, mass-disconnect connections), keyboard shortcuts, audit-log UI surface, CSV/JSON export, knowledge-block diff view + version-history modal, org-to-workspace bulk-push of memory, advanced spend forecasting, conflict resolution UI for memory.

## 4. Public API contracts

### 4.0 List endpoint invariants

These invariants apply to every list endpoint in §4 (Knowledge §4.1, Spend Ledger §4.2, Connections §4.6) unless that endpoint says otherwise.

- **Default ordering and cursor:** Each list endpoint declares an explicit default sort that ALWAYS ends with `id DESC` as the final tiebreaker:
  - Knowledge: `ORDER BY created_at DESC, id DESC`
  - Spend Ledger: `ORDER BY timestamp DESC, id DESC`
  - Connections: `ORDER BY created_at DESC, id DESC`
  The `cursor` value encodes both the primary sort field and `id`, so pagination is stable across rows with identical sort values and across concurrent updates. Sort overrides via `sortKey` / `sortDir` always include `id DESC` as the final tiebreaker.
- **Max page size:** `limit` MUST be ≤ 50; requests with `limit > 50` are silently clamped to 50.
- **`q` semantics:** Case-insensitive partial substring match against the fields named per endpoint. No stemming, no fuzzy match. Empty `q` is a no-op (not an empty-result filter). `q` composes with structured filters via AND.
- **`filterOptions`:** Returned per `<SortableTable>` contract (foundation §4.3). Counts are computed AFTER RLS scoping but BEFORE applying the caller's filter selection so users see how many rows each filter value would yield. Options sort by descending count, then ascending value. Zero-count options are included so previously-selected filters remain visible after they no longer match any row.

### 4.1 Knowledge entries — list + Edit-and-override

`GET /api/knowledge` (extends existing route):

```ts
interface KnowledgeListQuery {
  scope?: 'workspace' | 'org';
  status?: ('pending_review' | 'in_use' | 'ignored')[];
  autoUpdateDisabled?: boolean;               // separate filter (replaces the legacy 'overridden' status chip)
  kind?: ('belief' | 'fact' | 'observation' | 'preference' | 'issue')[];
  agent?: string[];
  q?: string;
  cursor?: string; limit?: number;
  sortKey?: 'createdAt' | 'updatedAt' | 'confidence' | 'sourceAgent' | 'kind' | 'status';
  sortDir?: 'asc' | 'desc';
}

interface KnowledgeEntry {
  id: string;
  kind: 'belief' | 'fact' | 'observation' | 'preference' | 'issue';
  body: string;
  confidence: number;                         // 0-1
  status: 'pending_review' | 'in_use' | 'ignored';
  source: { runId: string; agentName: string; extractedAt: string };
  subaccount: { id: string; name: string } | null;
  autoUpdateDisabled: boolean;                // true after Edit-and-override
  lastEditedBy: { kind: 'auto' | 'manual'; userId: string | null; at: string } | null;
}
```

**`POST /api/knowledge/:id/approve`** — moves `pending_review` → `in_use`. State-based idempotency.

**`POST /api/knowledge/:id/reject`** — moves to `ignored`. State-based.

**`POST /api/knowledge/:id/override`** — body: `{ body: string }`. Sets `auto_update_disabled = true`, writes a manual revision, status stays `in_use`. UI label: "Edit and override" (per round 13 prototype rename). Idempotent: re-submitting the same body is a no-op (no new revision); a different body creates a new revision.

**Status vs override:** `status` is closed at three values — `pending_review | in_use | ignored`. `auto_update_disabled` is the source of truth for "this block is detached from auto-extraction" and is exposed as a separate `autoUpdateDisabled` filter (and a row-level visual indicator), not as a fourth status. This avoids dual meaning where a row would simultaneously be "in use" and "overridden".

**Source-of-truth precedence** for memory blocks: `memory_blocks.body` is the live value; `memory_block_versions` is the audit log. When `auto_update_disabled = true`, the auto-extraction pipeline MUST skip BOTH the `memory_blocks` UPDATE AND the `memory_block_versions` INSERT for that row, even when the freshly-extracted content differs from the live body. This prevents silent reversion via new version rows and divergence between `memory_blocks.body` and `memory_block_versions`. Pipeline gate is implemented in chunk C1 (§7).

### 4.2 Spending — Ledger list

`GET /api/spend/ledger`:

```ts
interface LedgerQuery {
  scope?: 'workspace' | 'org';
  workspace?: string[];      // org scope only
  agent?: string[];
  type?: ('llm' | 'embedding' | 'tool_call' | 'storage' | 'other')[];
  from?: string;             // ISO date inclusive
  to?: string;               // ISO date inclusive
  cursor?: string; limit?: number;
  sortKey?: 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
  sortDir?: 'asc' | 'desc';
}

interface LedgerRow {
  id: string;
  timestamp: string;
  workspace: { id: string; name: string };
  agent: { id: string; name: string };
  type: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other';
  provider: string;          // 'openai' | 'anthropic' | 'gohighlevel' | ...
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
}
```

`filterOptions` returned per `<SortableTable>` contract.

### 4.3 Spending — Caps & budgets read

`GET /api/spend/caps`:

```ts
interface CapsResponse {
  scope: 'workspace' | 'org';
  orgCap: { monthlyUsd: number; usedMtdUsd: number; daysRemaining: number; pace: 'on_track' | 'warning' | 'over' };
  workspaces: Array<{
    id: string; name: string;
    dailyCapUsd: number | null;
    monthlyCapUsd: number | null;
    usedMtdUsd: number;
    pacePct: number;          // 0-200 (>100 = over cap)
    status: 'on_track' | 'warning' | 'over';
  }>;
}
```

Existing budget service already computes most of this; endpoint may be additive or extension.

### 4.4 Spending — insights (org scope only)

`GET /api/spend/insights?scope=org`:

```ts
interface SpendInsights {
  topSpender: { workspace: { id: string; name: string }; mtdUsd: number; pctOfOrgTotal: number; deltaPct: number };
  fastestGrower: { workspace: { id: string; name: string }; deltaPct: number };
  mostActiveAgent: { agent: { id: string; name: string }; runs30d: number; workspace: { id: string; name: string } };
}
```

Pure aggregator over existing ledger data; no persistence. Synchronous read.

**Time windows (UTC throughout):**
- `mtdUsd`, `pctOfOrgTotal`: current MTD = first day of the current calendar month through "now".
- `topSpender.deltaPct` and `fastestGrower.deltaPct`: `(current MTD spend - previous full calendar month spend) / previous full calendar month spend × 100`. Negative values allowed. Previous-month-zero → `null` (frontend renders "—"). "Previous month" = most recently completed calendar month.
- `runs30d`: rolling 30 calendar days ending at "now".

`fastestGrower` and `topSpender.deltaPct` MUST share the same window definition and inputs; divergence is a bug.

### 4.5 Spending — trends (top 5 by current MTD spend, last 6 months)

`GET /api/spend/trends?scope=org`:

```ts
interface SpendTrends {
  workspaces: Array<{
    id: string; name: string;
    spend6mo: number[];        // length 6, oldest -> current month
    capUsage6mo: number[];     // length 6, % values; >100 means over cap
    capBlownAt: number | null; // index 0-5 of first month over cap, or null
  }>;
  // Workspace ranking: top 4 by current MTD spend, then synthetic "Other" at index 4
  // when the org has more than 5 workspaces.
  //   actual_workspace_count <= 5: array length is the actual count; no "Other" entry.
  //   actual_workspace_count >  5: array length is 5; positions 0-3 are the top 4
  //     workspaces ranked by current MTD spend; position 4 is the synthetic rollup with
  //     id = '__other__', name = 'Other', spend6mo = sum of all non-top-4 workspaces'
  //     spend6mo per index, capUsage6mo = (sum of those workspaces' spend per month) /
  //     (sum of those workspaces' caps per month); months where the summed cap is zero
  //     or null yield capUsage6mo = null at that index. capBlownAt = first index where
  //     the aggregate capUsage > 100, else null.
  monthLabels: string[];       // length 6, ['Apr', 'May', ..., 'Sep']
}
```

Pure aggregator. Top-5 ranking by current MTD spend; ties broken by descending alphabetical workspace name. Synchronous read.

### 4.6 Connections — unified list

`GET /api/connections`:

```ts
interface ConnectionsQuery {
  scope?: 'workspace' | 'org';
  provider?: string[];
  authMethod?: ('oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie')[];
  status?: ('connected' | 'expired' | 'failed' | 'pending')[];
  cursor?: string; limit?: number;
  sortKey?: 'name' | 'provider' | 'authMethod' | 'status' | 'lastSync' | 'owner';
  sortDir?: 'asc' | 'desc';
}

interface Connection {
  id: string;
  name: string;
  provider: string;             // 'gmail', 'slack', 'hubspot', 'gohighlevel', 'stripe', 'drive', 'salesforce', 'linear', 'notion', 'github', 'zoom', 'mixpanel', or web-login provider
  authMethod: 'oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie';
  status: 'connected' | 'expired' | 'failed' | 'pending';
  lastSyncAt: string | null;
  owner: { kind: 'workspace' | 'org'; id: string; name: string };
  createdAt: string;
  // kind-specific metadata returned via a separate detail endpoint
}
```

**`GET /api/connections/:id`** — returns full detail (kind-specific). **`POST /api/connections/:id/refresh`**, **`POST /api/connections/:id/disconnect`**, **`POST /api/connections`** (add new) — delegate to existing per-kind routes.

### 4.7 View-mode awareness (frontend contract)

Per foundation §4.6, KnowledgePage and SpendingPage both read `viewMode` and switch their data sources accordingly:
- `workspace`: scope is the active client; org/system filters hidden; insights tiles hidden on Ledger; trend charts hidden on Caps & budgets.
- `org`: scope is the active org; insights tiles visible; trend charts visible; per-workspace caps table visible. Workspace column visible on Ledger.

ConnectionsPage is org-scoped by default (connections live at the org level today); a workspace-scoped view shows only connections owned by the active workspace.

### 4.8 Page-level full-text search

Each list page renders `<SearchBox>` (foundation §4.9, debounced 200ms) wired to a `q` query parameter:

- **Knowledge** `q` searches `body + source.agentName + source.runId`. Status / kind / agent filters compose via `<SortableTable>`.
- **Spend Ledger** `q` searches `agent.name + workspace.name`.
- **Connections** `q` searches `name + provider`.

Empty results render `<EmptyState>` with a "Clear filters" action.

### 4.9 Connection test/verify

`POST /api/connections/:id/test` (new):

```ts
interface ConnectionTestResponse {
  status: 'ok' | 'failed';
  latencyMs: number;
  testedAt: string;             // ISO
  error?: { code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'; message: string };
  capabilities?: string[];      // e.g. ['read:contacts', 'write:emails'] for OAuth — verified scopes
}
```

Behaviour:
- For OAuth connections: calls a lightweight ping endpoint on the provider (e.g. `GET /me` for Gmail) and reports latency + scope verification.
- For web-login connections: validates the cookie/session is still alive by hitting a known auth-required endpoint.
- For MCP connections: calls the MCP server's `initialize` and reports the returned capabilities.
- For api-key connections: provider-specific ping (HubSpot, Stripe, etc).

Producer: extends `connectionTokenService.ts` with a per-kind `testConnection()` dispatcher. **Idempotency:** unconditionally retryable; no state mutation. **Rate limit:** existing connection-test rate limiter (or add a new one if missing) — max 6 tests per connection per minute.

**Response contract:**
- HTTP status is ALWAYS 200, even on test failure. Network / timeout / auth failure surface as `status: 'failed'` with a structured `error` object; never as a 5xx.
- `error.code` enum:
  - `TIMEOUT` — provider did not respond within the 10s timeout.
  - `AUTH_FAILED` — token / cookie / api-key rejected (provider 401 / 403).
  - `NETWORK_ERROR` — DNS / connection / TLS failure before reaching the provider.
  - `PROVIDER_ERROR` — provider responded with 4xx (non-auth) or 5xx, or returned a malformed response.
- `error.message` is a short human-readable string suitable for an in-app notification; never includes secrets, tokens, or full URLs.

### 4.10 Connection disconnect — impact warning

`GET /api/connections/:id/usage` (new):

```ts
interface ConnectionUsage {
  agents: Array<{ id: string; name: string; lastUsedAt: string | null }>;
  recurringTasks: Array<{ id: string; name: string; nextFireAt: string | null }>;
  workflows: Array<{ id: string; name: string }>;
}
```

Producer: pure read aggregator over `agent_data_sources` + `agent_triggers` + workflow definitions. Used by the disconnect confirmation dialog so the user sees what will break.

`POST /api/connections/:id/disconnect`: existing endpoint. Frontend pre-fetches `/usage` on the click to populate the `<ConfirmDialog>` body. Dialog copy: `"Disconnect <providerName>? <N> agents, <M> recurring tasks, and <K> workflows use this connection. They will fail until reconnected."` Type-to-confirm if `agents.length + recurringTasks.length + workflows.length > 0`.

**Snapshot consistency:** The aggregator reads `agent_data_sources`, `agent_triggers`, and workflow definitions in a single read transaction (PostgreSQL `READ COMMITTED` is fine; the snapshot is taken at transaction start) so the three counts are mutually consistent — no cross-table mismatches if rows change mid-aggregation.

### 4.11 Spending — pace + period semantics

The Caps & budgets tab pace bar and warning thresholds need explicit semantics for the user. Surface these in the UI:

- **Pace line**: explanatory tooltip on the org-cap bar: `"Pace based on the last 7 days of spend extrapolated to the period end."` Render the tooltip via `<HelpHint>`.
- **Period end / reset date**: render `"Resets <date>"` next to the bar (e.g. "Resets May 31 23:59 UTC").
- **Days remaining**: explicit `<N> days remaining in this period` line below the bar.
- **Pace status** (`on_track | warning | over`): inline coloured chip next to the org-cap value.

Add to `CapsResponse` (§4.3):

```ts
interface CapsResponse {
  // existing fields...
  periodResetAt: string;         // ISO
  paceWindow: '7d' | '14d' | '30d';  // which window pace is computed over (default 7d)
  paceProjectedEndOfPeriodUsd: number;
}
```

### 4.12 Knowledge — UX clarifiers

- **Confidence score scale**: tooltip on the confidence bar header (`<HelpHint>`) reads `"Auto-extracted entries get a 0-1 confidence score from the extracting agent. Below 0.5: weak signal. 0.5-0.8: moderate. Above 0.8: strong."`.
- **Category chips** (kind filter — belief / fact / observation / preference / issue): each chip has a tooltip via `<HelpHint>` clarifying the kind ("Beliefs are claims about a contact's intent. Facts are verifiable. Observations are events. Preferences are stated preferences. Issues are blockers.").
- **Org-knowledge "Used by N of M workspaces" drill-in**: clicking the count opens a `<Modal>` listing the workspaces consuming the entry (read from `memory_block_workspace_links` if present, or computed from references).
- **Pending-review priority indicator**: rows with `status='pending_review'` and `confidence > 0.8` show a small "high confidence" badge so reviewers prioritise. No new field; derived in the renderer.
- **Provenance**: each row already shows `source.agentName + source.runId`. Make `source.runId` a clickable link to `/run-trace/<runId>?embedded=1` opening in a foundation `<Modal size="iframe">` (consistent with Spec A's run-trace popup pattern).
- **Override confirmation**: when the user clicks "Edit and override" on an `in_use` entry, show `<ConfirmDialog>` with `"Override <body excerpt>? Future automatic memory updates will skip this entry. The current value stays unchanged until you save."`.

### 4.13 Confirmation dialogs on destructive actions

- Knowledge **reject**: `<ConfirmDialog>` with `"Reject this knowledge entry? It will be moved to ignored."` (one-click, reversible).
- Knowledge **override** (on `in_use` entries): see §4.12.
- Connection **disconnect**: see §4.10.
- Spending: no destructive actions in this spec.

### 4.14 Frontend permission gating (action visibility)

- **Knowledge approve / reject / override** buttons hidden when user lacks the knowledge-write permission. Backend enforces.
- **Connection disconnect / refresh / add** hidden for non-org-admin users on org-owned connections.
- **Org-spend insights tiles + per-workspace caps + trend charts** hidden in workspace view (already covered by view-mode); also hidden for non-org-admin users in org view.
- **Edit-and-override** hidden on entries where `auto_update_disabled = true` is locked at the org level (rare; controlled by an org-setting).

## 5. File inventory

Files **created** by this spec:

| File | Purpose |
|---|---|
| `client/src/pages/govern/KnowledgePage.tsx` | Workspace knowledge view (uses `useViewMode='workspace'`) |
| `client/src/pages/govern/OrgKnowledgePage.tsx` | Org knowledge view (or merged into KnowledgePage with view-mode toggle — decided in plan) |
| `client/src/pages/govern/SpendingPage.tsx` | Two-tab page (Caps & budgets, Ledger), view-mode aware |
| `client/src/pages/govern/ConnectionsPage.tsx` | Unified connections list |
| `client/src/pages/govern/components/KnowledgeRow.tsx` | Row renderer with provenance, confidence, status, action menu |
| `client/src/pages/govern/components/KnowledgeOverrideDialog.tsx` | Edit-and-override flow (reuses `<ConfirmDialog>` + a body editor) |
| `client/src/pages/govern/components/SpendInsightsRow.tsx` | Three insight tiles (Top spender, Fastest grower, Most active agent) |
| `client/src/pages/govern/components/SpendBarChart.tsx` | Inline SVG bar chart for top-5 workspaces this month |
| `client/src/pages/govern/components/SpendTrendChart.tsx` | Inline SVG line chart for 6-month spend trend |
| `client/src/pages/govern/components/CapUtilisationChart.tsx` | Inline SVG line chart for cap-utilisation trend (over-cap dashed segments) |
| `client/src/pages/govern/components/ConnectionRow.tsx` | Row renderer with status pill, last-sync timestamp, owner, action menu |
| `client/src/pages/govern/components/ConnectionTestButton.tsx` | Per-row test/verify button using `POST /api/connections/:id/test` |
| `client/src/pages/govern/components/DisconnectConfirmDialog.tsx` | Pre-fetches `/usage`, renders impact warning |
| `server/services/spendInsightsService.ts` (+ `*Pure.ts`) | New aggregator: top spender / fastest grower / most active agent |
| `server/services/spendTrendsService.ts` (+ `*Pure.ts`) | New aggregator: top-5 workspaces, 6-month spend + cap-util series |
| `shared/types/govern.ts` | TypeScript types: `KnowledgeEntry`, `LedgerRow`, `CapsResponse` (extended), `SpendInsights`, `SpendTrends`, `Connection`, `ConnectionUsage`, `ConnectionTestResponse` |
| `tasks/builds/consolidation-govern/plan.md` | Implementation plan (architect output) |

Files **modified** by this spec:

| File | Change |
|---|---|
| `server/routes/knowledge.ts` | Add `?status=`, `?kind=`, `?agent=`, `?q=`, sort/cursor params; add `/approve`, `/reject`, `/override` endpoints (some may already exist) |
| `server/services/agentBeliefService.ts` (or memory service) | Add `auto_update_disabled` filter logic to the auto-extraction pipeline (skip writes when true) |
| `server/db/schema/memoryBlocks.ts` | Add `auto_update_disabled boolean default false not null` (additive) — single migration |
| `server/config/rlsProtectedTables.ts` | Confirm `memory_blocks` entry (already present); no policy change |
| `server/routes/agentCharges.ts` | Add `?from=`, `?to=`, `?agent=`, `?type=`, `?workspace=`, sort/cursor params for `GET /api/spend/ledger` |
| `server/services/computeBudgetService.ts` (+ `*Pure.ts`) | Extend `CapsResponse` with `periodResetAt`, `paceWindow`, `paceProjectedEndOfPeriodUsd` |
| `server/routes/integrationConnections.ts` | Add unified `GET /api/connections` listing across kinds; `POST /:id/test`; `GET /:id/usage` |
| `server/services/connectionTokenService.ts` | Add per-kind `testConnection()` dispatcher |
| `client/src/App.tsx` (router) | Re-route `/knowledge`, `/org-knowledge`, `/spending`, `/connections` |
| `client/src/config/sidebar.ts` (foundation file) | Add/relabel rows: Knowledge under Build group; Spending under Setup; Connections under External. Per foundation §9 single-row-per-stream policy. |

Files **NOT modified** by this spec:
- Operate-stream pages, Build-stream pages, foundation primitives.
- Schemas for `agents`, `agent_runs`, `agent_triggers`, `projects`, `inbox_items`, `activity_events`. No cross-stream schema change.

**One new migration**: `memory_blocks.auto_update_disabled boolean default false not null`. RLS policy unchanged (column-level, not row-level). **No new tables.**

## 6. Permissions / RLS / Execution model

**Permissions:**
- Knowledge list / read: existing `requirePermission('knowledge:read')` chain on `knowledge.ts`. No new permission keys.
- Knowledge approve / reject / override: existing `requirePermission('knowledge:write')` chain. Override action additionally requires `org_admin` if the entry is org-tier (existing helper).
- Spend ledger / caps / insights / trends: existing `requirePermission('spend:read')` (or equivalent). Org-scope reads require `org_admin`.
- Connections list: existing `requirePermission('connections:read')`. Connect / disconnect: `org_admin`. Test: read permission sufficient (it's a read-side operation).
- `auto_update_disabled` toggle: bound to the override action; no separate gate.

No new permission keys.

**Frontend permission gating (action visibility):** see §4.14.

**RLS:** `memory_blocks`, `agent_charges` (or spend tables), `integration_connections` are all already covered by RLS per `architecture.md §1155`. Adding `auto_update_disabled` is column-level, no policy change. Spend insights and trends aggregators read from already-policy-covered base tables; no extra coverage needed.

**Execution model:**
- Knowledge list / spend ledger / caps / insights / trends / connections list: synchronous, cached at the route layer where the existing pattern applies.
- Knowledge approve / reject: synchronous, state-based idempotency (`UPDATE ... WHERE status = 'pending_review'`). Second caller of same action returns `200 alreadyApplied: true`.
- Knowledge override: synchronous, key-based idempotency. `memory_block_versions` carries `UNIQUE (memory_block_id, body_hash)`. **Body hash canonicalisation** before hashing: (a) strip leading and trailing whitespace, (b) collapse internal whitespace runs to single spaces, (c) preserve case (override text is human-authored and case-sensitive). Hash function: SHA-256, hex-encoded, lower-case. Submitting the same canonicalised body twice returns the existing revision (no new row); submitting a different canonicalised body creates a new revision. Sets `auto_update_disabled = true` atomically with the version insert. **Concurrency:** `UPDATE ... WHERE etag = $expected`. ETag mismatch → 409 with current ETag.
- Connection disconnect: synchronous, calls existing per-kind disconnect flow. Idempotent (already-disconnected → 200).
- Connection test: synchronous-with-network-call. Wraps the provider call with a 10s timeout; failure returns `status: 'failed'`, never bubbles 5xx. Rate-limited per §4.9.

**Idempotency / retry / concurrency:**
- Knowledge approve / reject: state-based predicate.
- Knowledge override: key-based + ETag.
- Connection test: unconditionally retryable; safe under retry.
- Connection disconnect: state-based.
- HTTP mapping: never bubble `23505` as 500. ETag mismatch → 409. Rate-limit hit on connection test → 429 with `Retry-After`.

**Cost precision:** Spend amounts are stored at micro-USD precision (integer microcents = 10^-6 USD) to avoid floating-point drift in aggregators. Aggregators sum the integer column and divide by 1_000_000 at the API serialisation boundary; the public contract stays `costUsd: number` (decimal dollars). Frontend renders with `Intl.NumberFormat` — 2 decimals on Ledger rows, 4 decimals on Caps & budgets pace projections. If the existing `agent_charges` schema does not yet use integer microcents, the plan calls out the alignment migration before the C3 chunk ships. **Floats are NOT used in storage or aggregation.**

**State machine:** `memory_block.status` is closed: `pending_review | in_use | ignored`. `auto_update_disabled` is a boolean side-channel, not a status. Existing transitions preserved; the override action keeps status as `in_use` (no state change) and sets `auto_update_disabled := true`. No new states. No new transitions for connections (existing lifecycle preserved).

## 7. Phase / chunk plan (preview)

| Chunk | Scope | Depends on |
|---|---|---|
| C1 | Backend: migration `memory_blocks.auto_update_disabled` + extend `agentBeliefService` to skip when true; tests for the gate | — |
| C2 | Backend: extend `knowledge.ts` with list query params + `/approve`, `/reject`, `/override` endpoints + ETag concurrency on override | C1 |
| C3 | Backend: extend `agentCharges.ts` (or new `spendLedger.ts` route) with paged ledger list + filterOptions response | — |
| C4 | Backend: `spendInsightsService.ts` + `spendTrendsService.ts` (pure aggregators) + endpoints; pure-function tests | C3 |
| C5 | Backend: extend `computeBudgetService.ts` with `periodResetAt` / `paceWindow` / `paceProjectedEndOfPeriodUsd` | — |
| C6 | Backend: unified `GET /api/connections` + `GET /:id/usage` aggregator + `POST /:id/test` dispatcher | — |
| C7 | Frontend: `shared/types/govern.ts` + API client wrappers | C1–C6 |
| C8 | Frontend: `KnowledgePage.tsx` + `KnowledgeRow.tsx` + `KnowledgeOverrideDialog.tsx` (workspace + org views; or merged page) | Foundation SortableTable, Modal, ConfirmDialog, useViewMode; C7 |
| C9 | Frontend: `SpendingPage.tsx` Ledger tab with `<SortableTable>` | Foundation SortableTable, useViewMode; C7 |
| C10 | Frontend: `SpendingPage.tsx` Caps & budgets tab with `<SpendInsightsRow>` + 3 SVG charts (`SpendBarChart`, `SpendTrendChart`, `CapUtilisationChart`) | C9 |
| C11 | Frontend: `ConnectionsPage.tsx` + `ConnectionTestButton.tsx` + `DisconnectConfirmDialog.tsx` | Foundation SortableTable, ConfirmDialog; C7 |
| C12 | Sidebar config + router wiring + delete legacy memory / spending / integrations pages | C8, C9, C10, C11 |
| C13 | Doc-sync: `architecture.md` "Key files per domain" + auto-memory pipeline reference (note `auto_update_disabled` gate); KNOWLEDGE.md only if non-obvious gotcha hit | All |

**Dependency graph:** C1–C6 are mostly independent backend chunks (C2 depends on C1, C4 on C3); C7 depends on C1–C6; C8/C9/C11 each depend on C7; C10 depends on C9; C12 depends on C8+C9+C10+C11. No backward references.

Estimated total: 6–8 days of one builder. Likely two PRs (backend C1–C6, frontend C7–C13).

## 8. Testing posture

Per `docs/spec-context.md`:

```
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
```

- **Pure-function tests** for: spend insights ranking + delta computation, spend trends top-5 + Other-rollup logic, cap utilisation segment classification (normal vs over-cap), pace projector (last-N-days extrapolation), `auto_update_disabled` gate predicate, connection-usage aggregator. Each colocated `*Pure.test.ts`.
- **No frontend tests, no E2E, no API-contract tests, no visual regression** per framing.
- **Static gates** (lint, typecheck, build:server, build:client) are the verification surface.

**Manual verification at G2:**
- Knowledge: filter by status / kind / agent. Approve / reject / override all work. Override sets `auto_update_disabled = true`; re-running the auto-extraction pipeline does NOT touch the entry. Confidence tooltip + category-chip tooltips visible. Provenance run-id link opens run-trace iframe modal. Pending-review high-confidence badge shows correctly.
- Spending Ledger: workspace view drops Workspace column + filters to active workspace. Org view shows three insight tiles. Filters / sort behave per `<SortableTable>` contract.
- Spending Caps & budgets: org view shows split top row (org cap left, top-5 bar chart right) + second row (spend trend left, cap-util trend right). Globex over-cap segment renders as dashed red. Pace tooltip + period-reset date visible.
- Connections: 15-row list filters/sorts correctly. Test button works (mock all kinds). Disconnect dialog shows impact (`<N> agents, <M> tasks, <K> workflows`); type-to-confirm fires when impact > 0.
- Action visibility by role: workspace user does not see org-spend insights; non-org-admin does not see disconnect / connect actions.
- Search box on each list page debounces correctly.
- Empty / error states render when expected.

## 9. Coordination with Foundation, A, B

**Foundation primitives consumed:**

- `<SortableTable>` (foundation §4.3 + Phase 0 patch additions: `clearAllFilters`, AND/OR indicator) — Knowledge entries, Spending Ledger, Spending caps table, Connections.
- `<Modal>` (foundation §4.1) — Override editor, drill-in modal for "used by N workspaces", knowledge-detail modal.
- `<ViewModeSwitcher>` / `useViewMode` (foundation §4.4–4.6) — Knowledge and Spending workspace/org views.
- `<WorkspaceBadge>` (foundation §4.5) — Spend Ledger workspace column, knowledge org-view subaccount column, Connections owner column.
- `<PageShell>` (foundation §4.8) — Wrapper for all pages.
- `<SearchBox>`, `<EmptyState>`, `<ErrorState>` (foundation Phase 0 patch §4.9-4.11).
- `<ConfirmDialog>` — Existing primitive (`client/src/components/ConfirmDialog.tsx`).
- `<HelpHint>` — Existing primitive (`client/src/components/ui/HelpHint.tsx`).

**Shared-file edit policy** (per foundation §9):

- `client/src/config/sidebar.ts`: Govern stream owns rows for Knowledge (under Build), Spending (under Setup), Connections (under External). Coordinate row order at merge time with Specs A and B.
- Production shared stylesheet: page-scoped classes only (`.knowledge-row`, `.spend-insight-card`, `.connection-status-pill`, etc). No edits to `.form-footer`, `.page-shell`, etc.
- `shared/types/govern.ts`: scoped to this stream.
- DB migrations: one migration (additive `memory_blocks.auto_update_disabled`).

**Cross-stream integration points:**
- Knowledge `source.runId` links to `/run-trace/<id>?embedded=1` opened in a foundation `<Modal size="iframe">` — same pattern as Spec A's run-trace popup. No coupling; the route already exists.
- Spec B's agent-edit Data sources tab reads connection status from this stream's `GET /api/connections/:id`. Read-only coupling; no Spec B dependency at write time.
- Spec B's agent-edit Budget tab reads spend roll-ups from this stream's `GET /api/spend/caps?scope=agent&agentId=<id>` (or equivalent extension). Existing aggregator already supports per-agent reads.
- Connection `usage` aggregator reads from `agent_data_sources` (Spec B territory) and `agent_triggers` — read-only.

## 10. Deferred items

- **Bulk operations** on knowledge (mass-approve, mass-reject) and connections (mass-disconnect). Defer to Phase 1.5 follow-up.
- **Knowledge version history modal with diff view.** Data exists in `memoryBlockVersions`; UI is a follow-up. Phase 1 ships only "current value + last-edited-by".
- **Conflict resolution UI** for memory (auto-extracted value vs human-authored value). Today's pipeline writes the latest extraction; manual override stops auto-updates. Visual conflict-resolution UX deferred.
- **Org-to-workspace bulk push** of memory blocks. The "used by N of M workspaces" drill-in lists consumers; pushing to all is a follow-up.
- **CSV / JSON export** of knowledge, ledger, connections. Defer to a unified export-menu primitive.
- **Audit log UI** for override actions, disconnect actions, knowledge approvals. Data exists; UI is its own spec.
- **Spend cost forecasting** beyond linear pace ("you'll exceed cap on day 23 at current rate" with confidence interval). Phase 1 ships only linear pace.
- **Spend per-agent / per-skill cost allocation drill-down** beyond the Most-active-agent insight tile. Defer.
- **Connection scope verification UI** — the test endpoint returns capabilities, but a "what scopes does this need vs has?" diff UI is deferred.
- **Web-login session-expiry preview** (countdown to cookie expiration). Status pill shows `expired`; preview is a follow-up.
- **Connection cloning / templating.** Defer.
- **Memory-block category management** (rename categories, custom kinds). Phase 1 uses the existing fixed set.
- **Knowledge full-text search ranking tuning** (e.g. boost recent, boost high-confidence). Phase 1 uses default postgres ts_rank or LIKE.
- **Spend currency selector / multi-currency support.** Phase 1 hardcodes USD with `$` glyph.
- **Keyboard shortcuts** (e.g. A to approve a selected knowledge entry). Defer.
- **Empty-state copy guidelines** per list page (Knowledge / Ledger / Connections). Spec names the `<EmptyState>` primitive and the "Clear filters" action; final copy iterated during build via mockup-designer.

## 11. Self-consistency check

- Goals (§1) match Implementation (§4–7)? Yes — every page in §1 has contracts in §4, inventory in §5, chunks in §7. Reuse-vs-extend-vs-new verdicts in §3 match §5.
- Every "must" / "guarantees" claim has a backing mechanism?
  - Knowledge override sets `auto_update_disabled = true` atomically with the version insert: stated in §6 (key-based + ETag, body-hash canonicalisation).
  - Auto-extraction pipeline skips BOTH the `memory_blocks` UPDATE and the `memory_block_versions` INSERT when `auto_update_disabled = true`: stated in §4.1; backed by C1 chunk in §7.
  - List endpoints are deterministically paginated (default order ends with `id DESC`; cursor encodes both fields): §4.0.
  - Connection test never bubbles 5xx; `error.code` belongs to a closed enum: §4.9 + §6 (10s timeout + structured error response).
  - Top-5 ranking with explicit "Other" rollup rules (≤5 → no Other; >5 → top 4 + synthetic `__other__`): §4.5; pure-function test in §8.
  - Insights time windows (`mtdUsd`, `deltaPct`, `runs30d`) are unambiguous (UTC, calendar-month deltaPct, rolling-30d runs): §4.4.
  - Connection-usage aggregator reads three tables in a single transaction for snapshot consistency: §4.10.
  - Status enum is closed at three values; `auto_update_disabled` is the single source of truth for "detached from auto-extraction": §4.1 + §6.
  - Spend amounts use integer microcents in storage and aggregation; no floats: §6 (Cost precision).
- File inventory complete? Every page/component/service named in §4 appears in §5.
- Phase dependency graph clean? §7 lists C2 → C1, C4 → C3, C7 → all C1–C6, C8/C9/C11 → C7, C10 → C9, C12 → C8+C9+C10+C11. No cycles.
- Deferred items section exists? §10.
- Testing posture matches framing? §8 aligns with `frontend_tests: none_for_now`. Pure-function tests on the new aggregators.
- Permissions/RLS/execution-model statements explicit? §6.

## 12. Pre-review checklist

- [x] §0 No deferred-item references; greenfield consolidation.
- [x] §1 Every reused/extended primitive has an audit row in §3.
- [x] §2 Every new file is in §5.
- [x] §3 Public APIs in §4 include shape + types + producer/consumer.
- [x] §4 New column (`memory_blocks.auto_update_disabled`) declared additive in §5; existing RLS coverage retained per §6.
- [x] §5 Execution model declared (sync + state-based knowledge approve/reject; key-based + ETag override; sync connection test with timeout) in §6.
- [x] §6 Phase graph in §7 acyclic.
- [x] §7 `## Deferred Items` (§10) present.
- [x] §8 Self-consistency pass complete (§11).
- [x] §9 Testing posture matches framing (§8).
- [x] §10 ETag-mismatch HTTP mapping (409) declared; rate-limit (429) on connection test declared.
- [x] §11 Frontmatter present (top of file).
- [x] §12 List endpoint invariants (default sort + cursor + max page size + q semantics + filterOptions counts) consolidated in §4.0.
- [x] §13 Auto-memory override invariant (skip UPDATE + skip version INSERT when disabled) explicit in §4.1.
- [x] §14 Spend insights time windows (MTD / deltaPct / runs30d) explicitly UTC-anchored in §4.4.
- [x] §15 Spend trends "Other" rollup behaviour spelled out for ≤5 and >5 workspace cases in §4.5.
- [x] §16 Connection test failure contract (always 200, closed `error.code` enum) in §4.9.
- [x] §17 Connection-usage snapshot consistency (single read transaction across three tables) in §4.10.
- [x] §18 Status enum closed at three values; `auto_update_disabled` exposed as a separate filter in §4.1.
- [x] §19 Cost precision invariant (integer microcents; no floats) in §6.

Spec ready for `spec-reviewer`.
