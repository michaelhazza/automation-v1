**Status:** draft
**Spec date:** 2026-05-07
**Last updated:** 2026-05-07
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

**Verdict summary:** three pages (or four — knowledge/org-knowledge may merge into one with view-mode toggle, decided in plan), two new pure-aggregator services (`spendInsightsService`, `spendTrendsService`), backend extensions on knowledge (Edit-and-override action) and integration-connections (unified list). Possibly one additive column (`memory_blocks.auto_update_disabled boolean`). One migration if so. Zero new shared frontend primitives.

## 4. Public API contracts

### 4.1 Knowledge entries — list + Edit-and-override

`GET /api/knowledge` (extends existing route):

```ts
interface KnowledgeListQuery {
  scope?: 'workspace' | 'org';
  status?: ('pending_review' | 'in_use' | 'ignored' | 'overridden')[];
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
  status: 'pending_review' | 'in_use' | 'ignored' | 'overridden';
  source: { runId: string; agentName: string; extractedAt: string };
  subaccount: { id: string; name: string } | null;
  autoUpdateDisabled: boolean;                // true after Edit-and-override
  lastEditedBy: { kind: 'auto' | 'manual'; userId: string | null; at: string } | null;
}
```

**`POST /api/knowledge/:id/approve`** — moves `pending_review` → `in_use`. State-based idempotency.

**`POST /api/knowledge/:id/reject`** — moves to `ignored`. State-based.

**`POST /api/knowledge/:id/override`** — body: `{ body: string }`. Sets `auto_update_disabled = true`, writes a manual revision, status stays `in_use` (or moves to `overridden`). UI label: "Edit and override" (per round 13 prototype rename). Idempotent: re-submitting the same body is a no-op (no new revision); a different body creates a new revision.

**Source-of-truth precedence** for memory blocks: `memory_blocks.body` is the live value; `memory_block_versions` is the audit log. When `auto_update_disabled = true`, the auto-extraction pipeline MUST skip writes to this row (existing pipeline gate to be confirmed in plan).

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
  // Workspace count is min(actual_workspace_count, 5). If org has >5 workspaces,
  // index 4 is the synthetic 'Other' rollup containing the rest of the spend.
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
