# MCP Tool Invocations — Cost Attribution & Observability Spec

**Status:** Draft — pending spec-review
**Spec slug:** mcp-tool-invocations
**Migration sequence:** 0154

---

## 1. Problem Statement

`mcpClientManager.callTool()` executes external tool calls with zero durable record. No row is written when a call succeeds or fails. There is no per-workspace call count, no per-run breakdown, no basis for flat-fee billing, and no signal for rate-limiting MCP usage independently from LLM token spend.

The `llm_requests` ledger is append-only and covers LLM provider calls precisely. MCP tool calls are a separate category — no tokens, no provider cost — but they are billable actions that need the same attribution discipline.

Concretely: an agent that calls Gmail `send_email` 50 times in a run generates zero billing signal today. That is a P&L hole before live agencies are onboarded.

The circuit-breaker state (Gap 2) and distributed rate-limiting (Gap 3) are separate issues not covered by this spec. This spec is strictly observability and cost attribution.

---

## 2. Success Criteria

Verifiable assertions — the feature is done when all of these pass:

1. Every `mcpClientManager.callTool()` invocation (success and error paths) writes one row to `mcp_tool_invocations`. Verified by: pure-function test that confirms the insert helper is called in both paths.
2. Test runs (`agentRuns.isTestRun = true`) write to `mcp_tool_invocations` but are excluded from org/subaccount aggregate dimensions. Verified by: pure-function test matching the Feature 2 `isTestRun` pattern in `costAggregateService`.
3. `costAggregates` gains two new `entityType` values — `mcp_org` and `mcp_subaccount` — that accumulate `requestCount` across billing periods. Verified by: pure-function test asserting correct upsert dimensions.
4. The run-detail endpoint response includes a `mcpCallSummary` block (total calls, per-server breakdown, error count) when at least one MCP call occurred in the run. Verified by: `npm run typecheck` passing with no `any` escapes on the new field.
5. `npm run lint`, `npm run typecheck`, and `npm test` all pass with no new failures.

---

## 3. Scope

**In scope:**

- **F1** — `mcp_tool_invocations` Drizzle schema + migration `0154`
- **F2** — Write path: insert from `mcpClientManager.callTool()` on success and error
- **F3** — Aggregate write: extend `costAggregateService` with MCP call dimensions
- **F4** — Run trace API: add `mcpCallSummary` to the run-detail endpoint response

**Out of scope (this spec):**

- Per-subaccount circuit-breaker state (separate issue)
- Distributed rate limiting (deferred until horizontal scale)
- UI for MCP call breakdown in the run trace viewer (API-only this spec)
- Flat-fee pricing per MCP call (infrastructure ships now; pricing wired when billing is live)
- Per-workspace monthly MCP call budget enforcement (follow-on)
- Backfill of historical MCP calls (table starts empty; history is not recoverable)

---

## 4. F1 — `mcp_tool_invocations` Schema

### New Drizzle schema file: `server/db/schema/mcpToolInvocations.ts`

Follow the style of `mcpServerConfigs.ts`. Export `McpToolInvocation` and `NewMcpToolInvocation` types via Drizzle `$inferSelect` / `$inferInsert`.

**Columns:**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `organisationId` | uuid NOT NULL FK | `organisations.id` |
| `subaccountId` | uuid FK | `subaccounts.id`, nullable |
| `runId` | uuid FK | `agentRuns.id`, nullable |
| `agentId` | uuid FK | `agents.id`, nullable |
| `mcpServerConfigId` | uuid FK | `mcpServerConfigs.id`, nullable — denormalised for joins |
| `serverSlug` | text NOT NULL | e.g. `gmail` — denormalised for query speed without join |
| `toolName` | text NOT NULL | e.g. `send_email` |
| `gateLevel` | text NOT NULL | `'auto' \| 'review' \| 'block'` — gate decision at call time |
| `status` | text NOT NULL | `'success' \| 'error' \| 'timeout' \| 'budget_blocked'` |
| `failureReason` | text | `McpFailureReason` value on error, null on success |
| `durationMs` | integer | Wall time for the tool call, null if timing not available |
| `responseSizeBytes` | integer | Serialised response length, null on error |
| `wasTruncated` | boolean NOT NULL DEFAULT false | True if response exceeded `MAX_MCP_RESPONSE_SIZE` |
| `isTestRun` | boolean NOT NULL DEFAULT false | Denormalised from `agentRuns.isTestRun` at insert time |
| `callIndex` | integer | Sequential position within run (`ctx.mcpCallCount` at call time) |
| `billingMonth` | text NOT NULL | `YYYY-MM` derived from `createdAt` |
| `billingDay` | text NOT NULL | `YYYY-MM-DD` derived from `createdAt` |
| `createdAt` | timestamptz NOT NULL DEFAULT now() | |

**Indexes (defined in Drizzle table options and mirrored in migration SQL):**

```
mcp_tool_invocations_org_month_idx   ON (organisation_id, billing_month)
mcp_tool_invocations_sub_month_idx   ON (subaccount_id, billing_month) WHERE subaccount_id IS NOT NULL
mcp_tool_invocations_run_idx         ON (run_id) WHERE run_id IS NOT NULL
mcp_tool_invocations_server_slug_idx ON (organisation_id, server_slug, billing_month)
```

### Migration `0154_mcp_tool_invocations.sql`

Follow the format of `0153_agent_test_fixtures.sql` — header comment referencing this spec, `CREATE TABLE IF NOT EXISTS`, then `CREATE INDEX IF NOT EXISTS` for each index. No `ALTER TABLE` on existing tables in this migration.

---

## 5. F2 — Write Path in `mcpClientManager`

### Extend `McpRunContext` (line 35 of `mcpClientManager.ts`)

Add two fields:

```typescript
interface McpRunContext {
  runId: string;
  organisationId: string;
  agentId: string;
  subaccountId: string | null;
  isTestRun: boolean;        // NEW — propagated from agentExecutionService
}
```

`isTestRun` is already on the `agentRun` row and known at run setup. Propagating it through context avoids a per-call DB lookup (unlike `costAggregateService`, which receives a bare `LlmRequest` and must query).

### Propagation in `agentExecutionService.ts`

At the point where `McpRunContext` is assembled (where `connectForRun()` is called, around line 604), add `isTestRun: agentRun.isTestRun ?? false` to the context object. The value is on the already-loaded `agentRun` row.

### New private helper `writeMcpInvocation()` in `mcpClientManager.ts`

```typescript
async function writeMcpInvocation(params: {
  ctx: McpRunContext;
  serverSlug: string;
  toolName: string;
  mcpServerConfigId: string | undefined;
  gateLevel: 'auto' | 'review' | 'block';
  status: 'success' | 'error' | 'timeout' | 'budget_blocked';
  failureReason?: McpFailureReason;
  durationMs: number;
  responseSizeBytes?: number;
  wasTruncated?: boolean;
  callIndex: number;
}): Promise<void>
```

Inserts one row into `mcp_tool_invocations`. Derives `billingMonth` and `billingDay` from `new Date()` at insert time (same pattern as `llmRequests`). On any insert error: `logger.warn('mcp.invocation_log_failed', { error })` — never throw, never block the agent loop.

After a successful insert, fire-and-forget call to `mcpAggregateService.upsertMcpAggregates(row)` (F3).

### Call sites inside `callTool()`

**Success path** — after `logger.info('mcp.call.success', ...)` (current line 318):

```typescript
void writeMcpInvocation({
  ctx,
  serverSlug,
  toolName,
  mcpServerConfigId: instance.serverConfig.id,
  gateLevel: resolveGateLevel(instance.serverConfig, toolName),
  status: 'success',
  durationMs,
  responseSizeBytes: serialised.length,
  wasTruncated: serialised.length > MAX_MCP_RESPONSE_SIZE,
  callIndex: (ctx.mcpCallCount ?? 1) - 1,
});
```

**Error path** — after the retry guard, before the final `return { error: ... }` (current line 342):

```typescript
void writeMcpInvocation({
  ctx,
  serverSlug,
  toolName,
  mcpServerConfigId: instance.serverConfig.id,
  gateLevel: resolveGateLevel(instance.serverConfig, toolName),
  status: classified.reason === 'timeout' ? 'timeout' : 'error',
  failureReason: classified.reason,
  durationMs,
  callIndex: (ctx.mcpCallCount ?? 1) - 1,
});
```

**Budget-blocked path** — when `callCount >= MAX_MCP_CALLS_PER_RUN` (current line 265), the call returns early without a `serverSlug` or `instance`. Write a row with `status: 'budget_blocked'`, `serverSlug` parsed from `toolSlug` (best-effort), `durationMs: 0`.

---

## 6. F3 — Aggregate Dimensions

### New service: `server/services/mcpAggregateService.ts`

Mirrors the structure of `costAggregateService.ts`. Exports a single function:

```typescript
export async function upsertMcpAggregates(row: McpToolInvocation): Promise<void>
```

Writes to the existing `cost_aggregates` table using new `entityType` values. Reusing `cost_aggregates` avoids a new table and all existing query/index paths apply.

**Dimensions written per call:**

| entityType | entityId | periodType | condition |
|---|---|---|---|
| `mcp_org` | `organisationId` | `monthly` | always (unless test run) |
| `mcp_org` | `organisationId` | `daily` | always (unless test run) |
| `mcp_subaccount` | `subaccountId` | `monthly` | when `subaccountId` present and not test run |
| `mcp_subaccount` | `subaccountId` | `daily` | when `subaccountId` present and not test run |
| `mcp_run` | `runId` | `run` | always when `runId` present (test runs included) |
| `mcp_server` | `organisationId:serverSlug` | `monthly` | always (unless test run) |

**Test-run exclusion**: if `row.isTestRun === true`, skip all dimensions except `mcp_run`. This matches the `costAggregateService` pattern from Feature 2 — test runs don't inflate P&L aggregates but still get per-run visibility.

**Column mapping into `cost_aggregates`:**

- `totalCostRaw`, `totalCostWithMargin`: `'0'` (string, numeric column) — no provider cost yet
- `totalCostCents`: `0`
- `totalTokensIn`, `totalTokensOut`: `0` — not applicable to MCP calls
- `requestCount`: increment by `1`
- `errorCount`: increment by `1` when `row.status !== 'success'`

The `onConflictDoUpdate` pattern is identical to `costAggregateService` — increment counts using `sql\`col + value\`` to avoid read-modify-write races.

---

## 7. F4 — Run Trace API: `mcpCallSummary`

### Locate the run-detail endpoint

Find the route handler that returns the run detail object (search for `agentRuns.id` in `server/routes/agentRuns.ts` or the equivalent route file). The endpoint already returns a run object with trace fields.

### Add `mcpCallSummary` to the response

After loading the run row, issue one grouped query:

```sql
SELECT
  server_slug,
  COUNT(*)::int           AS call_count,
  SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END)::int AS error_count,
  AVG(duration_ms)::int   AS avg_duration_ms
FROM mcp_tool_invocations
WHERE run_id = :runId
GROUP BY server_slug
```

Shape the response field as:

```typescript
mcpCallSummary: {
  totalCalls: number;
  errorCount: number;
  byServer: Array<{
    serverSlug: string;
    callCount: number;
    errorCount: number;
    avgDurationMs: number | null;
  }>;
} | null  // null when no MCP calls occurred in this run
```

Return `null` if the query returns zero rows. No new route — this is an additive field on the existing endpoint.

If `runId` is null or the route pre-dates `mcp_tool_invocations`, return `null` gracefully.

---

## 8. Implementation Order

1. **F1** — schema file + migration `0154`. No other code changes. Reviewable in isolation. Run `npm run typecheck`.
2. **F2** — `McpRunContext` extension, `agentExecutionService.ts` propagation, `writeMcpInvocation()` helper, call sites in `callTool()`. Run `npm run lint && npm run typecheck`.
3. **F3** — `mcpAggregateService.ts` (new file). Wire into F2's `writeMcpInvocation()`. Run `npm run lint && npm run typecheck && npm test`.
4. **F4** — run-detail endpoint addition. Read-only, independent of F1-F3 being live (returns `null` if table is empty). Run `npm run typecheck`.

Each feature is its own commit. Do not batch them.

---

## 9. Pure-Function Tests Required

File naming: `*Pure.test.ts` under `server/services/__tests__/`. No DB connection — mock the `db` insert and Drizzle calls.

| Test | Assertion |
|---|---|
| `callTool()` success path | `writeMcpInvocation` called once with `status: 'success'`, correct `serverSlug`, `toolName`, `durationMs` present |
| `callTool()` error path (non-retryable) | `writeMcpInvocation` called once with `status: 'error'`, `failureReason` set |
| `callTool()` timeout path | `writeMcpInvocation` called with `status: 'timeout'` |
| `callTool()` budget-blocked path | `writeMcpInvocation` called with `status: 'budget_blocked'` before early return |
| `upsertMcpAggregates()` with `isTestRun: false`, `subaccountId` set | 6 dimension upserts: `mcp_org` monthly+daily, `mcp_subaccount` monthly+daily, `mcp_run`, `mcp_server` |
| `upsertMcpAggregates()` with `isTestRun: true` | 1 dimension upsert: `mcp_run` only |
| `upsertMcpAggregates()` with `subaccountId: null`, `isTestRun: false` | 4 upserts: `mcp_org` monthly+daily, `mcp_run`, `mcp_server` (no `mcp_subaccount`) |
| `writeMcpInvocation()` insert error | Logs `mcp.invocation_log_failed`, does not throw |

---

## 10. Non-Goals

- No UI changes to the run trace viewer (API-only in this spec; UI wires up in a follow-on)
- No billing policy (flat fee per MCP call is a follow-on decision once pricing is set)
- No per-workspace MCP call budget enforcement (follow-on to this spec)
- No backfill of historical MCP calls
- No changes to `MAX_MCP_CALLS_PER_RUN` enforcement (already correct; this spec adds observability only)
- No new `workspaceLimits` columns for MCP-specific limits (follow-on)

---

## 11. Open Questions

These need resolution before or during implementation — not blocking spec-review:

1. **`mcp_server_config_id` capture**: `callTool()` has `instance.serverConfig.id` available directly. The spec captures it from `instance` rather than threading it through `McpRunContext`. Confirm this is acceptable (it is — `McpRunContext` stays clean).

2. **`cost_aggregates` `requestCount` semantics**: Using the existing table with new `entityType` values means `requestCount` counts MCP calls, not LLM requests, for `mcp_*` entity types. This is slightly inconsistent with existing rows. Accept this tradeoff, or rename the column to `eventCount` across the board? Recommendation: accept for now; a column rename is a separate migration concern.

3. **`mcp_server` aggregate granularity**: The `mcp_server` dimension uses `organisationId:serverSlug` (org-level). If per-subaccount server analytics are later needed, a second dimension `subaccountId:serverSlug` would be added. Accept org-level only for this spec.

4. **Budget-blocked path `serverSlug`**: When the call is blocked before connecting, `serverSlug` is parsed from `toolSlug` (which may be malformed). Should the row be written at all for budget-blocked calls, or only for calls that reached a server? Recommendation: write it — the budget-blocked event is still auditable and useful for analytics.

