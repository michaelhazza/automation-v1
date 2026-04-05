# MCP Client Ecosystem — Development Spec

**Date:** 2026-04-05
**Classification:** Significant (new subsystem, multiple domains, new patterns, UI + backend)

---

## Executive Summary

Build an **MCP Client Manager** that lets Automation OS agents connect to **external MCP servers** — pre-built tool servers for Gmail, Slack, HubSpot, GitHub, Stripe, databases, browser automation, and 200+ others — instead of writing custom adapter code for each integration.

**What it does:** Org admins configure external MCP server connections (e.g. "Gmail MCP Server", "Slack MCP Server"). When an agent runs, the system connects to the configured MCP servers, discovers their tools via `tools/list`, and makes those tools available to the agent alongside existing skills. Tool calls are routed through the existing gate/approval pipeline and logged in the action audit trail.

**What it doesn't do:** This does not replace your existing skill system. Internal skills (create_task, read_workspace, etc.) remain as-is. MCP servers are an additional tool source — a way to rapidly expand the external integration surface without writing adapters. It also does not change the MCP server you already expose at `/mcp`.

**Why it matters:**
- **Unblocks Phase 1B** — Your `apiAdapter.ts` is stubbed ("not yet implemented"). Instead of writing N custom adapters (Gmail, Slack, HubSpot...), you write one MCP client manager and get them all.
- **40+ integrations without adapter code** — Each community MCP server handles its own API complexity (auth, pagination, rate limiting, error mapping). You just manage connections and permissions.
- **Tool discovery is automatic** — MCP's `tools/list` returns typed schemas. No manual skill .md files or action registry entries needed for external tools.
- **Ecosystem leverage** — 200+ pre-built MCP servers exist (official registry at `registry.modelcontextprotocol.io`). New ones appear weekly. Each one you connect to expands agent capabilities with zero code.

**What already exists vs what we build:**

| Component | Status | Notes |
|-----------|--------|-------|
| MCP SDK (`@modelcontextprotocol/sdk` v1.29.0) | **Installed** | Includes both `McpServer` (used) and `Client` (unused) |
| MCP Server (outbound) | **Built** | `server/mcp/mcpServer.ts` — exposes tools to external clients |
| OAuth token management | **Built** | `integrationConnectionService` — encrypted tokens, auto-refresh, advisory locks |
| Gate/approval pipeline | **Built** | `actionService` → `policyEngineService` — auto/review/block gates |
| Action audit trail | **Built** | `actions` + `actionEvents` tables — full lifecycle logging |
| Tenant-scoped tool filtering | **Built** | `allowedSkillSlugs` on `subaccountAgents` — middleware enforcement |
| ProcessorHooks pipeline | **Built** | 3-phase pre/post processing around every tool dispatch |
| Execution layer with adapters | **Built** | `executionLayerService` with api/worker/devops adapter categories |
| `apiAdapter` (external API calls) | **Stubbed** | Returns "not yet implemented for Phase 1B" |
| **MCP Client Manager** | **Needs creation** | Service to connect to external MCP servers |
| **MCP Server Registry table** | **Needs creation** | DB schema for org-configured MCP server definitions |
| **MCP tool aggregation** | **Needs creation** | Merge external MCP tools into agent's available tool set |
| **Admin UI for MCP servers** | **Needs creation** | Pages for configuring, testing, and managing MCP server connections |

**Estimated effort:** 5-8 days for core implementation + UI. New pattern (MCP client lifecycle management) but builds heavily on existing infra.

---

## Current State Assessment

### Your MCP Server (what exists — not changing)

`server/mcp/mcpServer.ts` exposes your action registry + system skills as MCP tools via Streamable HTTP at `/mcp`. External MCP clients can call your tools. This is the **outbound** direction — unchanged by this spec.

### Your Integration Layer (the gap this fills)

Current adapter architecture:

```
Agent tool_use → skillExecutor → actionService (gate) → executionLayerService → adapter
                                                                                   ├── apiAdapter    → STUBBED ("Phase 1B")
                                                                                   ├── workerAdapter → working (tasks, pages)
                                                                                   └── devopsAdapter → working (code, shell, PRs)
```

The `apiAdapter` is the blocker. It handles external API actions (send_email, read_inbox, update_record, fetch_url) but returns a stub error. The current path to unblock it:

- **Without MCP:** Write `gmailAdapter.ts`, `slackAdapter.ts`, `hubspotAdapter.ts`, etc. — each handling auth, pagination, API specifics, error mapping, rate limiting. Estimated 2-4 days per adapter.
- **With MCP:** Write one `mcpClientManager` service. Configure pre-built MCP servers. Each handles its own API complexity. Estimated 5-8 days total for unlimited adapters.

### OAuth Providers Configured (ready for MCP servers)

| Provider | OAuth Config | Adapter | MCP Server Available |
|----------|-------------|---------|---------------------|
| Gmail | Yes (`oauthProviders.ts`) | No (stubbed) | Yes (Google MCP) |
| Slack | Yes | Partial (`slackAdapter.ts`) | Yes (Slack MCP) |
| HubSpot | Yes | No | Yes (HubSpot MCP) |
| GHL | Yes | Yes (`ghlAdapter.ts`) | No (custom only) |
| GitHub | Yes (App flow) | No (webhooks only) | Yes (GitHub MCP) |
| Stripe | API key | Yes (`stripeAdapter.ts`) | Yes (community) |

---

## Architecture

### End-to-End Flow

```
                                    ┌─────────────────────────────┐
                                    │   Org Admin UI              │
                                    │   "Add MCP Server"          │
                                    │   - name, transport, URL    │
                                    │   - credential link         │
                                    │   - allowed tools filter    │
                                    └──────────┬──────────────────┘
                                               │ POST /api/mcp-servers
                                               ▼
                                    ┌─────────────────────────────┐
                                    │   mcp_server_configs table  │
                                    │   (org-scoped registry)     │
                                    └──────────┬──────────────────┘
                                               │
            ┌──────────────────────────────────┐│┌──────────────────────────────┐
            │ Agent Run Startup                │││ Agent Run Startup            │
            │                                  │││                              │
            │ 1. Load agent skills (existing)  │││ 2. Load MCP server configs   │
            │    → skillService.resolve()      │││    → mcpClientManager.       │
            │    → Anthropic tool defs         │││      getToolsForRun()        │
            │                                  │││    → Connect to each server  │
            │                                  │││    → tools/list per server   │
            │                                  │││    → Anthropic tool defs     │
            └──────────┬───────────────────────┘│└──────────┬───────────────────┘
                       │                        │           │
                       └────────┬───────────────┘───────────┘
                                │ Merged tool array
                                ▼
                     ┌──────────────────────────┐
                     │ LLM call (Anthropic API) │
                     │ tools = internal + MCP   │
                     └──────────┬───────────────┘
                                │ tool_use response
                                ▼
                     ┌──────────────────────────┐
                     │ skillExecutor.execute()   │
                     │                          │
                     │ Is tool from MCP server? │
                     │   YES → mcpClientManager │
                     │         .callTool()      │
                     │   NO  → existing handler │
                     └──────────┬───────────────┘
                                │ (MCP path)
                                ▼
                     ┌──────────────────────────┐
                     │ mcpClientManager          │
                     │                          │
                     │ 1. Resolve server for    │
                     │    this tool slug        │
                     │ 2. Create action record  │
                     │    (audit + gate)        │
                     │ 3. Call tools/call on    │
                     │    the MCP server        │
                     │ 4. Return result to      │
                     │    agent                 │
                     └──────────────────────────┘
```

### Key Design Decisions

**1. MCP servers are org-scoped, not subaccount-scoped**
An org admin configures MCP servers once. They're available to all agents in the org. Per-subaccount tool filtering uses the existing `allowedSkillSlugs` mechanism — MCP tool slugs are namespaced (e.g. `mcp.gmail.send_email`) and can be added to allowlists.

**2. Stdio transport for Phase 1, HTTP transport for Phase 2**
Most MCP servers ship as npm packages that run as subprocesses via stdio. This is the simplest, most reliable transport — no network config, no CORS, no TLS. HTTP transport (for remote/cloud MCP servers) is Phase 2.

**3. Client instances are per-run, not long-lived**
Each agent run creates fresh MCP client connections, uses them for the run duration, and tears them down. No shared mutable state across runs. This matches your existing pattern of creating fresh `McpServer` instances per request in `server/routes/mcp.ts`.

**Explicit rules:**
- No cross-run caching of client instances
- No shared state across concurrent runs
- All client instances must be fully disposable
- **On run resume:** `_mcpClients` from the previous execution context is invalid. The resumed run must call `connectForRun()` again to establish fresh connections. Never reuse stale client references.

**4. MCP tools go through the action audit pipeline**
Every MCP tool call creates an `actions` record with `actionCategory: 'mcp'`. This gives you the same audit trail, gate evaluation, and policy engine coverage as internal skills. The default gate level for MCP tools is configurable per-server (auto/review/block).

**5. Tool slugs are namespaced to prevent collisions**
Internal skills use bare slugs (`send_email`, `create_task`). MCP tools are prefixed: `mcp.<server_slug>.<tool_name>`. This prevents collisions if an MCP server exposes a tool with the same name as an internal skill.

---

## Data Model

### New Table: `mcp_server_configs`

Stores org-level MCP server definitions. One row per configured MCP server per org.

```typescript
// server/db/schema/mcpServerConfigs.ts

export const mcpServerConfigs = pgTable(
  'mcp_server_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),

    // Display
    name: text('name').notNull(),              // "Gmail", "Slack", "HubSpot"
    slug: text('slug').notNull(),              // "gmail", "slack", "hubspot" — used in tool namespacing
    description: text('description'),
    iconUrl: text('icon_url'),                 // optional icon for UI display

    // Transport config
    transport: text('transport').notNull()
      .$type<'stdio' | 'http'>(),
    // stdio: command + args to spawn the server process
    command: text('command'),                  // e.g. "npx", "node", "docker"
    args: jsonb('args').$type<string[]>(),     // e.g. ["-y", "@anthropic/gmail-mcp-server"]
    // http: endpoint URL for Streamable HTTP transport
    endpointUrl: text('endpoint_url'),

    // Environment variables passed to stdio server (encrypted JSON)
    // Contains API keys, tokens, config that the MCP server needs
    envEncrypted: text('env_encrypted'),

    // Link to integration_connections for OAuth-backed servers
    connectionId: uuid('connection_id')
      .references(() => integrationConnections.id),

    // Tool filtering
    // If set, only these tools from this server are exposed to agents.
    // If null, all tools from this server are exposed.
    allowedTools: jsonb('allowed_tools').$type<string[] | null>(),
    // If set, these tools are blocked even if allowedTools is null.
    blockedTools: jsonb('blocked_tools').$type<string[] | null>(),

    // Gate configuration
    defaultGateLevel: text('default_gate_level')
      .notNull()
      .default('auto')
      .$type<'auto' | 'review' | 'block'>(),

    // Per-tool gate overrides: { "tool_name": "review" }
    toolGateOverrides: jsonb('tool_gate_overrides')
      .$type<Record<string, 'auto' | 'review' | 'block'> | null>(),

    // Priority — higher values = tools from this server are preferred when tool limit is hit
    priority: integer('priority').notNull().default(0),
    // Max concurrent tool calls to this server (default 1 for single-threaded servers)
    maxConcurrency: integer('max_concurrency').notNull().default(1),

    // Status
    status: text('status').notNull().default('active')
      .$type<'active' | 'disabled' | 'error'>(),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
    lastError: text('last_error'),

    // Discovered tools cache — populated by tools/list, refreshed on connect
    discoveredToolsJson: jsonb('discovered_tools_json')
      .$type<Array<{
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
        annotations?: {
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        };
      }> | null>(),

    // Hash of discovered tools JSON — used to detect changes without deep comparison
    discoveredToolsHash: text('discovered_tools_hash'),
    lastToolsRefreshAt: timestamp('last_tools_refresh_at', { withTimezone: true }),
    // Count of tools that failed schema validation (for admin visibility)
    rejectedToolCount: integer('rejected_tool_count').default(0),

    // Circuit breaker state
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    circuitOpenUntil: timestamp('circuit_open_until', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('mcp_server_configs_org_slug_unique')
      .on(table.organisationId, table.slug),
    orgIdx: index('mcp_server_configs_org_idx')
      .on(table.organisationId),
    statusIdx: index('mcp_server_configs_status_idx')
      .on(table.status),
  })
);

export type McpServerConfig = typeof mcpServerConfigs.$inferSelect;
export type NewMcpServerConfig = typeof mcpServerConfigs.$inferInsert;
```

### New Table: `mcp_server_agent_links`

Controls which MCP servers are available to which agents. If no links exist for an agent, it gets all active org MCP servers (opt-out model).

```typescript
// server/db/schema/mcpServerAgentLinks.ts

export const mcpServerAgentLinks = pgTable(
  'mcp_server_agent_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mcpServerConfigId: uuid('mcp_server_config_id')
      .notNull()
      .references(() => mcpServerConfigs.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    // Override gate level for this specific agent-server pair
    gateOverride: text('gate_override')
      .$type<'auto' | 'review' | 'block' | null>(),
    // Override allowed tools for this specific agent
    allowedToolsOverride: jsonb('allowed_tools_override')
      .$type<string[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serverAgentUnique: uniqueIndex('mcp_server_agent_links_unique')
      .on(table.mcpServerConfigId, table.agentId),
  })
);
```

### Migration

```sql
-- migrations/0053_mcp_server_configs.sql

CREATE TABLE mcp_server_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  transport TEXT NOT NULL,
  command TEXT,
  args JSONB,
  endpoint_url TEXT,
  env_encrypted TEXT,
  connection_id UUID REFERENCES integration_connections(id),
  allowed_tools JSONB,
  blocked_tools JSONB,
  default_gate_level TEXT NOT NULL DEFAULT 'auto',
  tool_gate_overrides JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  discovered_tools_json JSONB,
  discovered_tools_hash TEXT,
  last_tools_refresh_at TIMESTAMPTZ,
  rejected_tool_count INTEGER DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mcp_server_configs_org_slug_unique ON mcp_server_configs(organisation_id, slug);
CREATE INDEX mcp_server_configs_org_idx ON mcp_server_configs(organisation_id);
CREATE INDEX mcp_server_configs_status_idx ON mcp_server_configs(status);

CREATE TABLE mcp_server_agent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_server_config_id UUID NOT NULL REFERENCES mcp_server_configs(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  gate_override TEXT,
  allowed_tools_override JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mcp_server_agent_links_unique ON mcp_server_agent_links(mcp_server_config_id, agent_id);
```

### Action Registry Extension

New action category `mcp` registered dynamically. MCP tool calls create actions with:

```typescript
{
  actionType: 'mcp.<server_slug>.<tool_name>',   // e.g. "mcp.gmail.send_email"
  actionCategory: 'mcp',
  isExternal: true,
  defaultGateLevel: <from server config or tool override>,
}
```

No static `ACTION_REGISTRY` entries needed — MCP tools are registered dynamically at runtime from `discoveredToolsJson`.

---

## Backend Implementation

### New Files

| File | Purpose |
|------|---------|
| `server/db/schema/mcpServerConfigs.ts` | Drizzle schema (see Data Model above) |
| `server/db/schema/mcpServerAgentLinks.ts` | Drizzle schema (see Data Model above) |
| `server/services/mcpClientManager.ts` | Core service — lifecycle, tool discovery, tool calling |
| `server/services/mcpServerConfigService.ts` | CRUD service for mcp_server_configs |
| `server/routes/mcpServers.ts` | REST API for org-level MCP server management |
| `server/routes/mcpServerAgentLinks.ts` | REST API for agent-server linking |
| `migrations/0053_mcp_server_configs.sql` | DB migration |

### Modified Files

| File | Change |
|------|--------|
| `server/services/skillExecutor.ts` | Add MCP tool dispatch branch in `execute()` |
| `server/services/agentExecutionService.ts` | Merge MCP tools into agent's tool array at run startup |
| `server/services/executionLayerService.ts` | Register `mcp` adapter category |
| `server/config/actionRegistry.ts` | Add `mcp` to `actionCategory` type union |
| `server/config/limits.ts` | Add `MAX_MCP_TOOLS_PER_RUN` and `MAX_MCP_CALLS_PER_RUN` |
| `server/lib/permissions.ts` | Add `org.mcp_servers.view` and `org.mcp_servers.manage` permission keys |
| `server/db/schema/index.ts` | Export new tables |
| `server/index.ts` | Mount new routes |

### Service: `mcpClientManager.ts`

The core service. Manages MCP client lifecycle per agent run.

```typescript
// server/services/mcpClientManager.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AnthropicTool } from './llmService.js';

interface McpClientInstance {
  client: Client;
  transport: StdioClientTransport;
  serverSlug: string;
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
}

interface McpRunContext {
  runId: string;
  organisationId: string;
  agentId: string;
  subaccountId: string | null;
}

export const mcpClientManager = {

  /**
   * Connect to all MCP servers configured for this agent run.
   * Returns Anthropic-formatted tool definitions + a handle for calling tools.
   *
   * Called once at agent run startup (in agentExecutionService).
   */
  async connectForRun(ctx: McpRunContext): Promise<{
    tools: AnthropicTool[];
    clients: Map<string, McpClientInstance>;
  }>;

  /**
   * Call a tool on an external MCP server.
   * Routes through the action audit pipeline before executing.
   *
   * Called from skillExecutor when tool slug starts with "mcp.".
   */
  async callTool(
    clients: Map<string, McpClientInstance>,
    toolSlug: string,          // e.g. "mcp.gmail.send_email"
    args: Record<string, unknown>,
    ctx: McpRunContext & { taskId?: string },
  ): Promise<unknown>;

  /**
   * Gracefully disconnect all MCP clients for a run.
   * Called at agent run teardown.
   */
  async disconnectAll(clients: Map<string, McpClientInstance>): Promise<void>;

  /**
   * Test connectivity to a single MCP server config.
   * Connects, calls tools/list, disconnects. Used by admin UI "Test Connection" button.
   */
  async testConnection(configId: string, organisationId: string): Promise<{
    success: boolean;
    toolCount: number;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
  }>;

  /**
   * Refresh discovered tools for a server config.
   * Connects, calls tools/list, updates discoveredToolsJson in DB, disconnects.
   */
  async refreshTools(configId: string, organisationId: string): Promise<void>;
};
```

#### `connectForRun` — Implementation Notes

1. Load active `mcp_server_configs` for the org
2. Filter by agent links (if any exist for this agent; otherwise all active servers)
3. **Connect to servers in parallel** (bounded concurrency = 3):
   ```typescript
   const results = await pMap(serverConfigs, async (config) => {
     // a. Resolve environment variables — decrypt envEncrypted, inject OAuth tokens
     // b. Create StdioClientTransport with command + args + resolved env
     // c. Create Client, call client.connect(transport)
     // d. Call client.listTools() (or use warm cache — see below)
     // e. Apply allowedTools / blockedTools filters
     // f. Validate tool schemas (see Schema Validation section)
     // g. Namespace tool names: mcp.<server_slug>.<tool_name>
     // h. Convert to Anthropic tool format
   }, { concurrency: 3 });
   ```
   Bounded at 3 to prevent CPU spikes from too many subprocess spawns. With 5-10 servers at ~300-800ms each, parallel connect reduces startup from 3-8s to ~1-2s.
4. Merge all MCP tools into a single array
5. Return tools + client map (keyed by server slug)

**Timeout:** 10s per server connection. If a server fails to connect, log the error, mark server status as `error`, and continue with remaining servers. One flaky server should not block the entire run.

**Tool limit:** Max 30 MCP tools per run (configurable in `server/config/limits.ts` as `MAX_MCP_TOOLS_PER_RUN`).

**Tool prioritisation strategy** (when total exceeds limit):

```
Priority order:
  1. Tools in agent's allowedToolsOverride (explicit selection = highest)
  2. Tools from servers with higher priority value (server.priority field)
  3. Read-only tools preferred over destructive (from MCP annotations)
  4. Alphabetical fallback (deterministic ordering)
```

This avoids random exclusion. Admins control priority via the `priority` field on server configs; agents get further control via `allowedToolsOverride` on their links.

#### `callTool` — Implementation Notes

1. Parse tool slug: `mcp.gmail.send_email` → server slug `gmail`, tool name `send_email`
2. Look up client instance from the map
3. Create an action record via `actionService.proposeAction()`:
   ```typescript
   {
     actionType: toolSlug,           // "mcp.gmail.send_email"
     actionCategory: 'mcp',
     isExternal: true,
     defaultGateLevel: resolveGateLevel(serverConfig, toolName, toolAnnotations),
     payload: args,
   }
   ```
4. If gate result is `blocked` → return denial message
5. If gate result is `pending_approval` → await review (same pattern as existing review-gated skills)
6. If gate result is `approved` → call `client.callTool({ name: toolName, arguments: args })`
7. Mark action as `completed` or `failed` based on MCP response
8. Return tool result to agent

#### Failure Classification & Retry

MCP tool calls can fail in fundamentally different ways. Classify failures structurally to inform retry decisions and surface actionable diagnostics.

```typescript
type McpFailureReason =
  | 'timeout'          // call exceeded 30s deadline
  | 'process_crash'    // stdio child process exited unexpectedly
  | 'invalid_response' // response failed schema validation
  | 'auth_error'       // 401/403 or MCP auth failure
  | 'rate_limited'     // server indicated rate limit
  | 'unknown';         // unclassified

interface McpCallResult {
  success: boolean;
  data?: unknown;
  failureReason?: McpFailureReason;
  retryable: boolean;
  durationMs: number;
}
```

Inside `callTool()`:

```typescript
try {
  const result = await withTimeout(client.callTool({ name, arguments: args }), 30_000);
  return { success: true, data: result, durationMs };
} catch (err) {
  const classified = classifyMcpError(err);

  if (classified.retryable && retryCount < 1) {
    // One retry max — same philosophy as LLM router
    return callTool(clients, toolSlug, args, ctx, retryCount + 1);
  }

  // Record structured failure on action
  await actionService.markFailed(actionId, organisationId, classified.message, classified.reason);
  return { success: false, failureReason: classified.reason, retryable: false, durationMs };
}
```

Classification rules:
- `timeout`: AbortError or deadline exceeded → retryable once
- `process_crash`: child process exit code !== 0 or SIGTERM → not retryable
- `auth_error`: error message contains "auth", "401", "403", or "token" → not retryable (stale creds)
- `rate_limited`: error message contains "rate" or "429" → retryable once
- `invalid_response`: JSON parse failure or schema mismatch → not retryable
- `unknown`: everything else → not retryable

#### Tool Schema Validation

MCP tool definitions come from external servers. Validate before converting to Anthropic tools to prevent malformed schemas, excessive payloads, or prompt injection via descriptions.

```typescript
function validateMcpToolSchema(tool: McpToolDefinition): { valid: boolean; reason?: string } {
  // Name constraints
  if (!tool.name || tool.name.length > 100) return { valid: false, reason: 'name too long or empty' };
  if (!/^[a-zA-Z0-9_.-]+$/.test(tool.name)) return { valid: false, reason: 'invalid name characters' };

  // Description constraints — prevent prompt injection via excessively long descriptions
  if (tool.description && tool.description.length > 1000) return { valid: false, reason: 'description exceeds 1000 chars' };

  // Input schema constraints
  if (tool.inputSchema) {
    const schema = tool.inputSchema;
    const propCount = Object.keys(schema.properties ?? {}).length;
    if (propCount > 50) return { valid: false, reason: 'too many properties (>50)' };
    if (jsonDepth(schema) > 5) return { valid: false, reason: 'schema too deeply nested (>5)' };
    if (JSON.stringify(schema).length > 10_000) return { valid: false, reason: 'schema too large (>10KB)' };
  }

  return { valid: true };
}
```

In `connectForRun`, after `tools/list`:

```typescript
const validTools = discoveredTools.filter(tool => {
  const check = validateMcpToolSchema(tool);
  if (!check.valid) {
    logger.warn('mcp.tool_schema_rejected', { serverSlug, tool: tool.name, reason: check.reason });
  }
  return check.valid;
});
```

Invalid tools are dropped silently (from the agent's perspective) but logged for admin visibility. The rejected tool count is stored on the server config for display in the UI.

#### Observability Hooks

All MCP operations emit structured trace spans, integrated with the existing Langfuse instrumentation in `server/lib/tracing.ts`.

**Spans emitted:**

| Span | Attributes | When |
|------|-----------|------|
| `mcp.connect` | `serverSlug`, `transport`, `durationMs`, `success`, `error` | Each server connect in `connectForRun` |
| `mcp.tools.list` | `serverSlug`, `toolCount`, `rejectedCount`, `durationMs` | After `tools/list` + validation |
| `mcp.tool.call` | `serverSlug`, `toolName`, `durationMs`, `success`, `failureReason`, `gateLevel` | Each `callTool` invocation |
| `mcp.disconnect` | `serverSlug`, `durationMs` | Each server disconnect |

Implementation — wrap operations with `getActiveTrace()`:

```typescript
const span = getActiveTrace()?.span({ name: 'mcp.tool.call', input: { serverSlug, toolName, args } });
try {
  const result = await client.callTool({ name, arguments: args });
  span?.end({ output: { success: true, durationMs } });
  return result;
} catch (err) {
  span?.end({ output: { success: false, failureReason: classified.reason, durationMs } });
  throw err;
}
```

This gives you:
- Per-server connection reliability metrics
- Per-tool latency and error rates
- Full trace chains: agent run → MCP connect → tool call → result
- Direct visibility in Langfuse dashboards

#### Gate Resolution with MCP Annotations

Gate level is resolved in priority order:

```typescript
function resolveGateLevel(
  serverConfig: McpServerConfig,
  toolName: string,
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean },
): 'auto' | 'review' | 'block' {
  // 1. Explicit per-tool override (highest priority — admin intent)
  if (serverConfig.toolGateOverrides?.[toolName]) {
    return serverConfig.toolGateOverrides[toolName];
  }

  // 2. MCP annotation-driven default — destructive tools escalate to review
  if (annotations?.destructiveHint && serverConfig.defaultGateLevel === 'auto') {
    return 'review';
  }

  // 3. Server-level default
  return serverConfig.defaultGateLevel;
}
```

This means destructive tools (e.g. `delete_email`, `drop_table`) automatically require human approval unless the admin has explicitly set them to `auto` via a per-tool override. Read-only tools respect the server default.

#### Config Validation at Create/Update Time

Validate MCP server configs before persisting to catch misconfigurations early (not at runtime):

```typescript
function validateMcpServerConfig(input: NewMcpServerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!input.name || input.name.length > 100) errors.push('Name required, max 100 chars');
  if (!input.slug || !/^[a-z0-9_]+$/.test(input.slug)) errors.push('Slug must match [a-z0-9_]+');
  if (input.slug && input.slug.length > 50) errors.push('Slug max 50 chars');

  if (input.transport === 'stdio') {
    if (!input.command) errors.push('Command required for stdio transport');
    if (input.command && input.command.includes('..')) errors.push('Command must not contain path traversal');
    if (input.endpointUrl) errors.push('Endpoint URL not applicable for stdio transport');
  }

  if (input.transport === 'http') {
    if (!input.endpointUrl) errors.push('Endpoint URL required for http transport');
    if (input.endpointUrl) {
      try { new URL(input.endpointUrl); } catch { errors.push('Invalid endpoint URL'); }
    }
    if (input.command) errors.push('Command not applicable for http transport');
  }

  if (input.args && !Array.isArray(input.args)) errors.push('Args must be an array');

  return { valid: errors.length === 0, errors };
}
```

Validation runs in `mcpServerConfigService.create()` and `.update()`. Returns 400 with the error array if invalid.

#### MCP Call Budget Protection

MCP tool calls count against the agent run's existing budget system to prevent runaway costs:

```typescript
// In limits.ts:
export const MAX_MCP_CALLS_PER_RUN = 10;  // separate from MAX_TOOL_CALLS to prevent MCP domination
```

Tracked in `mcpClientManager.callTool()` via a counter on the run context. When exceeded, return a structured error to the agent: `"MCP tool call limit reached (10/10). Use internal skills or request a budget increase."`

This works alongside the existing `maxToolCallsPerRun` limit — MCP calls count toward both the MCP-specific limit and the total tool call limit.

#### Per-Server Concurrency Control

Some MCP servers are single-threaded or rely on shared state. Concurrent calls can cause corruption or race conditions.

Add a per-server semaphore (default concurrency: 1):

```typescript
interface McpClientInstance {
  client: Client;
  transport: StdioClientTransport;
  serverSlug: string;
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
  semaphore: Semaphore;  // NEW — controls max concurrent calls to this server
}
```

In `connectForRun`, initialise with the default:

```typescript
const semaphore = new Semaphore(serverConfig.maxConcurrency ?? 1);
```

In `callTool`, wrap the MCP call:

```typescript
const result = await instance.semaphore.acquire(async () => {
  return client.callTool({ name: toolName, arguments: args });
});
```

Add `maxConcurrency` field to `mcp_server_configs` (integer, default 1, nullable). Admins can increase for servers known to handle parallelism (e.g. stateless HTTP servers).

#### Output Size Guard

MCP servers can return arbitrarily large responses. Guard against massive payloads before passing results to the LLM or tracing system.

```typescript
const MAX_MCP_RESPONSE_SIZE = 100_000; // 100KB

function guardMcpOutput(result: unknown): { data: unknown; truncated: boolean } {
  const serialised = JSON.stringify(result);
  if (serialised.length <= MAX_MCP_RESPONSE_SIZE) {
    return { data: result, truncated: false };
  }

  // Truncate to limit + append notice
  const truncated = serialised.slice(0, MAX_MCP_RESPONSE_SIZE);
  logger.warn('mcp.output_truncated', { size: serialised.length, limit: MAX_MCP_RESPONSE_SIZE });

  return {
    data: truncated + '\n[... response truncated at 100KB]',
    truncated: true,
  };
}
```

Applied in `callTool()` after receiving the MCP response, before returning to the agent. The `truncated` flag is recorded on the action for observability.

#### Idempotency Key Passthrough

MCP tool calls that mutate external state (send_email, create_contact, etc.) risk duplicate execution on retry. Pass the action ID as an idempotency hint.

```typescript
const mcpArgs = {
  ...args,
  _meta: {
    idempotencyKey: actionId,  // unique per action record
  },
};

const result = await client.callTool({ name: toolName, arguments: mcpArgs });
```

The `_meta.idempotencyKey` field is a convention — MCP servers that support idempotency can use it; others will ignore it. This is forward-compatible with emerging MCP server patterns.

The action record itself already enforces idempotency on the Automation OS side (via `actionService.proposeAction` with idempotency keys). This extends that guarantee to the external system where possible.

#### Circuit Breaker

Prevent wasting agent run time on servers that are consistently failing.

Track on `mcp_server_configs`:

```typescript
consecutiveFailures: integer('consecutive_failures').notNull().default(0),
circuitOpenUntil: timestamp('circuit_open_until', { withTimezone: true }),
```

Logic in `connectForRun`:

```typescript
// Skip server if circuit is open
if (config.circuitOpenUntil && config.circuitOpenUntil > new Date()) {
  logger.info('mcp.circuit_open', { serverSlug: config.slug, until: config.circuitOpenUntil });
  continue; // skip this server, proceed with others
}

try {
  await connect(config);
  // Reset on success
  await resetCircuit(config.id);
} catch (err) {
  await incrementFailure(config.id);
  // Open circuit after 3 consecutive failures — back off for 5 minutes
  if (config.consecutiveFailures + 1 >= 3) {
    await openCircuit(config.id, new Date(Date.now() + 5 * 60 * 1000));
  }
}
```

Circuit states:
- **Closed** (normal): `consecutiveFailures < 3` — connect normally
- **Open** (backing off): `circuitOpenUntil > now` — skip server entirely
- **Half-open** (probe): `circuitOpenUntil <= now` — try once, reset or re-open

The UI shows circuit state on server cards: "Circuit open — retrying in 3m" with the option to manually reset.

#### Warm Tool Cache

Avoid redundant `tools/list` calls when discovered tools haven't changed.

In `connectForRun`, after connecting to the server:

```typescript
const cacheAge = config.lastToolsRefreshAt
  ? Date.now() - config.lastToolsRefreshAt.getTime()
  : Infinity;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let tools: McpToolDefinition[];

if (cacheAge < CACHE_TTL && config.discoveredToolsJson?.length) {
  // Use cached tools — skip tools/list call
  tools = config.discoveredToolsJson;
} else {
  // Discover fresh tools
  tools = await client.listTools();
  const newHash = createHash('sha256').update(JSON.stringify(tools)).digest('hex');

  // Only write to DB if tools actually changed
  if (newHash !== config.discoveredToolsHash) {
    await updateDiscoveredTools(config.id, tools, newHash);
  }
}
```

This reduces per-run latency by ~200-500ms per cached server and eliminates redundant DB writes when tools haven't changed. The 5-minute TTL is conservative — tune based on observed server stability.

#### Credential Injection

When a server config has a `connectionId`, the manager resolves the OAuth token at connect time:

```typescript
// In connectForRun, when building env for stdio transport:
if (config.connectionId) {
  const conn = await integrationConnectionService.getDecryptedConnection(
    null, // org-level
    config.slug, // provider
    ctx.organisationId,
    config.connectionId,
  );
  env.ACCESS_TOKEN = conn.accessToken;
  if (conn.refreshToken) env.REFRESH_TOKEN = conn.refreshToken;
}
```

This means OAuth tokens flow from your existing `integration_connections` table into MCP server processes — no new auth system needed.

### Service: `mcpServerConfigService.ts`

Standard CRUD service for the config table. Follows the pattern of `connectorConfigService.ts`.

```typescript
export const mcpServerConfigService = {
  async list(organisationId: string): Promise<McpServerConfig[]>;
  async getById(id: string, organisationId: string): Promise<McpServerConfig>;
  async create(input: NewMcpServerConfig): Promise<McpServerConfig>;
  async update(id: string, organisationId: string, updates: Partial<McpServerConfig>): Promise<McpServerConfig>;
  async delete(id: string, organisationId: string): Promise<void>;
  async listForAgent(agentId: string, organisationId: string): Promise<McpServerConfig[]>;
};
```

### Routes: `mcpServers.ts`

```
GET    /api/mcp-servers                          — list org MCP servers
POST   /api/mcp-servers                          — create MCP server config
GET    /api/mcp-servers/:id                      — get single config
PATCH  /api/mcp-servers/:id                      — update config
DELETE /api/mcp-servers/:id                      — delete config
POST   /api/mcp-servers/:id/test                 — test connection (returns tool list)
POST   /api/mcp-servers/:id/refresh-tools        — refresh discovered tools cache

GET    /api/mcp-servers/:id/agent-links          — list agent links for this server
POST   /api/mcp-servers/:id/agent-links          — link agent to server
DELETE /api/mcp-servers/:id/agent-links/:linkId  — unlink agent from server
```

All routes: `authenticate` → `requireOrgPermission('org.mcp_servers.manage')` (write) or `requireOrgPermission('org.mcp_servers.view')` (read).

### Integration into Agent Execution

#### `agentExecutionService.ts` — Changes

In `executeRun()`, after resolving skills and before the main loop:

```typescript
// --- Existing: resolve internal skills ---
const { tools: skillTools, instructions } = await skillService.resolveSkillsForAgent(skillSlugs, organisationId);

// --- NEW: resolve MCP tools ---
let mcpClients: Map<string, McpClientInstance> | null = null;
let mcpTools: AnthropicTool[] = [];

try {
  const mcp = await mcpClientManager.connectForRun({
    runId, organisationId, agentId,
    subaccountId: subaccountId ?? null,
  });
  mcpClients = mcp.clients;
  mcpTools = mcp.tools;
} catch (err) {
  logger.warn('mcp.connect_failed', { runId, error: err instanceof Error ? err.message : String(err) });
  // Non-fatal — agent runs without MCP tools
}

const allTools = [...skillTools, ...mcpTools];

// --- Main loop wrapped with guaranteed cleanup ---
try {
  // ... main loop uses allTools ...
} finally {
  // --- NEW: teardown MCP clients after run (guaranteed) ---
  if (mcpClients) {
    await mcpClientManager.disconnectAll(mcpClients).catch((err) => {
      logger.error('mcp.disconnect_failed', { runId, error: err instanceof Error ? err.message : String(err) });
    });
  }
}
```

**Lifecycle cleanup guarantee:** The `finally` block ensures MCP clients are torn down even if the agent run throws, times out, or is cancelled. This prevents child process leaks.

Inside `disconnectAll()`, cleanup is defensive:

```typescript
async disconnectAll(clients: Map<string, McpClientInstance>): Promise<void> {
  const results = await Promise.allSettled(
    Array.from(clients.values()).map(async ({ client, transport, serverSlug }) => {
      try {
        await withTimeout(client.close(), 5_000);
      } catch {
        // SDK close failed — force-kill the transport
      }
      // Forcibly terminate stdio child process if still alive
      if (transport.process?.pid && !transport.process.killed) {
        transport.process.kill('SIGTERM');
        // If SIGTERM doesn't work within 2s, escalate to SIGKILL
        setTimeout(() => {
          if (!transport.process?.killed) {
            transport.process?.kill('SIGKILL');
          }
        }, 2_000);
      }
    })
  );
  // Log any failures but never throw — cleanup is best-effort
  for (const r of results) {
    if (r.status === 'rejected') {
      logger.warn('mcp.client_cleanup_failed', { error: String(r.reason) });
    }
  }
}
```

**PID tracking:** `StdioClientTransport` exposes the child `ChildProcess` via `transport.process`. Track PIDs explicitly in `McpClientInstance` as a fallback if the SDK property is unavailable.

#### `skillExecutor.ts` — Changes

Add a branch at the top of `execute()` to detect MCP tool slugs:

```typescript
async execute({ skillName, input, context }: SkillExecutionParams): Promise<unknown> {
  // NEW: MCP tool dispatch
  if (skillName.startsWith('mcp.')) {
    return mcpClientManager.callTool(
      context._mcpClients,  // passed through from agentExecutionService
      skillName,
      input,
      context,
    );
  }

  // ... existing skill dispatch (unchanged) ...
}
```

The `_mcpClients` map is added to `SkillExecutionContext`:

```typescript
export interface SkillExecutionContext {
  // ... existing fields ...
  /** MCP client instances for this run. Set by agentExecutionService. */
  _mcpClients?: Map<string, McpClientInstance>;
}
```

#### `executionLayerService.ts` — Changes

Register `mcp` adapter category:

```typescript
import { mcpAdapter } from './adapters/mcpAdapter.js';

const adapterRegistry: Record<string, ExecutionAdapter> = {
  api: apiAdapter,
  devops: devopsAdapter,
  mcp: mcpAdapter,  // NEW
};
```

The `mcpAdapter` is a thin wrapper that delegates to `mcpClientManager.callTool()` — used when MCP actions are executed through the execution layer (e.g. after review approval).

#### `actionRegistry.ts` — Changes

Extend the `actionCategory` type:

```typescript
actionCategory: 'api' | 'worker' | 'browser' | 'devops' | 'mcp';
```

No new static entries needed — MCP actions are created dynamically.

---

## UI Specification

### New Files

| File | Purpose |
|------|---------|
| `client/src/pages/McpServersPage.tsx` | Main MCP server management page (list + create/edit) |
| `client/src/components/McpToolBrowser.tsx` | Tool discovery browser component (used in server detail + agent edit) |

### Modified Files

| File | Change |
|------|--------|
| `client/src/App.tsx` | Add route for `/admin/mcp-servers` |
| `client/src/components/Layout.tsx` | Add nav item under "Organisation" section |
| `client/src/pages/AdminAgentEditPage.tsx` | Add MCP server assignment section to agent config |

### Navigation

Add nav item in `Layout.tsx` under the "Organisation" section, after "Agents":

```tsx
{hasOrgPerm('org.mcp_servers.view') && (
  <NavItem to="/admin/mcp-servers" icon={<Icons.mcpServers />} label="MCP Servers" />
)}
```

Icon (new entry in `Icons` object — plug/connector metaphor):
```tsx
mcpServers: () => (
  <Ico>
    <path d="M12 2v4" /><path d="M12 18v4" />
    <path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" />
    <path d="M2 12h4" /><path d="M18 12h4" />
    <circle cx="12" cy="12" r="4" />
  </Ico>
),
```

### Route

In `App.tsx`, inside the org admin guard:

```tsx
<Route path="/admin/mcp-servers" element={
  <Suspense fallback={<PageLoader />}>
    <McpServersPage user={user!} />
  </Suspense>
} />
```

### Page: `McpServersPage.tsx`

Full-page admin view for managing MCP server connections. Follows the card-grid pattern from `ConnectionsPage.tsx` and `AdminSkillsPage.tsx`.

#### Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Servers                                    [+ Add Server] │
│  Connect external tool servers to expand agent capabilities   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ ● Gmail              │  │ ● Slack              │         │
│  │ stdio · 5 tools      │  │ stdio · 8 tools      │         │
│  │ Gate: auto            │  │ Gate: review          │         │
│  │ Last connected: 2m ago│  │ Last connected: 5m ago│         │
│  │                       │  │                       │         │
│  │ [Test] [Edit] [Delete]│  │ [Test] [Edit] [Delete]│         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                               │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ ○ HubSpot    ERROR   │  │ ● GitHub             │         │
│  │ stdio · 0 tools      │  │ stdio · 12 tools     │         │
│  │ Error: ENOENT npx    │  │ Gate: auto            │         │
│  │                       │  │ Last connected: 1h ago│         │
│  │ [Test] [Edit] [Delete]│  │ [Test] [Edit] [Delete]│         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                               │
│  No servers? Show empty state:                                │
│  "No MCP servers configured yet. Add your first server to    │
│   give agents access to external tools."                      │
└─────────────────────────────────────────────────────────────┘
```

#### Server Card Component

Each card displays:
- **Status indicator**: green dot (active), red dot (error), grey dot (disabled)
- **Name**: bold, 16px (e.g. "Gmail")
- **Transport + tool count**: `stdio · 5 tools` or `http · 12 tools`
- **Default gate level**: `Gate: auto` / `Gate: review` / `Gate: block`
- **Last connected**: relative time or "Never"
- **Error message**: if status is `error`, show `lastError` truncated to 1 line
- **Actions**: Test, Edit, Delete buttons

Status badge styles (matching existing pattern):
```typescript
const MCP_STATUS_STYLES: Record<string, string> = {
  active:   'bg-green-100 text-green-800',
  disabled: 'bg-slate-100 text-slate-600',
  error:    'bg-red-100 text-red-800',
};
```

#### Create/Edit Modal

Triggered by "+ Add Server" button or card "Edit" button. Uses the existing `Modal` component.

```
┌─────────────────────────────────────────────────┐
│  Add MCP Server                              [×] │
├─────────────────────────────────────────────────┤
│                                                   │
│  Name *                                           │
│  ┌─────────────────────────────────────────────┐ │
│  │ Gmail                                       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Slug * (used in tool namespacing: mcp.<slug>.)   │
│  ┌─────────────────────────────────────────────┐ │
│  │ gmail                                       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Description                                      │
│  ┌─────────────────────────────────────────────┐ │
│  │ Google Gmail integration for email          │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Transport *                                      │
│  ┌─────────────────────────────────────────────┐ │
│  │ stdio                              ▼        │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ── stdio config ──────────────────────────────── │
│                                                   │
│  Command *                                        │
│  ┌─────────────────────────────────────────────┐ │
│  │ npx                                         │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Arguments (one per line)                         │
│  ┌─────────────────────────────────────────────┐ │
│  │ -y                                          │ │
│  │ @anthropic/gmail-mcp-server                 │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Environment Variables (KEY=VALUE, one per line)  │
│  ┌─────────────────────────────────────────────┐ │
│  │ GMAIL_CLIENT_ID=xxx                         │ │
│  │ GMAIL_CLIENT_SECRET=yyy                     │ │
│  └─────────────────────────────────────────────┘ │
│  ⓘ Values are encrypted at rest                   │
│                                                   │
│  ── OR link to existing connection ────────────── │
│                                                   │
│  Integration Connection (optional)                │
│  ┌─────────────────────────────────────────────┐ │
│  │ Gmail - Support Account             ▼       │ │
│  └─────────────────────────────────────────────┘ │
│  ⓘ OAuth tokens auto-injected as ACCESS_TOKEN     │
│                                                   │
│  ── Gate & filtering ──────────────────────────── │
│                                                   │
│  Default Gate Level *                             │
│  ┌─────────────────────────────────────────────┐ │
│  │ auto                               ▼        │ │
│  └─────────────────────────────────────────────┘ │
│  ⓘ auto = execute immediately                     │
│  ⓘ review = require human approval                │
│  ⓘ block = deny all tool calls                    │
│                                                   │
│  Status                                           │
│  ┌─────────────────────────────────────────────┐ │
│  │ active                             ▼        │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│          [Cancel]              [Save Server]       │
└─────────────────────────────────────────────────┘
```

**Conditional fields:**
- When `transport === 'stdio'`: show Command, Arguments fields
- When `transport === 'http'`: show Endpoint URL field instead
- Integration Connection dropdown: populated from `GET /api/org-connections` (org-level connections)

**Form state:**
```typescript
interface McpServerForm {
  name: string;
  slug: string;
  description: string;
  transport: 'stdio' | 'http';
  command: string;           // stdio only
  args: string;              // textarea, split by newline
  endpointUrl: string;       // http only
  envVars: string;           // textarea, KEY=VALUE per line
  connectionId: string;      // optional, from dropdown
  defaultGateLevel: 'auto' | 'review' | 'block';
  status: 'active' | 'disabled';
}
```

**Slug auto-generation:** When creating, auto-generate slug from name (lowercase, hyphens replaced with underscores, special chars stripped). Allow manual override.

**Validation:**
- Name required, max 100 chars
- Slug required, must match `^[a-z0-9_]+$`, max 50 chars
- Command required when transport is stdio
- Endpoint URL required when transport is http

#### Test Connection Flow

When user clicks "Test" on a card:
1. Button shows spinner + "Testing..."
2. `POST /api/mcp-servers/:id/test`
3. On success: show green toast "Connected — discovered N tools" + open tool browser modal
4. On failure: show red toast with error message, update card to show error status

#### Tool Browser Modal

Displayed after successful test, or via "View Tools" action on a card. Shows discovered tools from the MCP server.

```
┌─────────────────────────────────────────────────────┐
│  Gmail — Discovered Tools (5)                    [×] │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ send_email                                       │ │
│  │ Send an email via Gmail                          │ │
│  │ Params: to, subject, body, cc, bcc               │ │
│  │ Tags: [external] [destructive]                   │ │
│  │ Gate override: [auto ▼]                          │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ read_inbox                                       │ │
│  │ Read recent emails from inbox                    │ │
│  │ Params: maxResults, query, labelIds              │ │
│  │ Tags: [external] [read-only]                     │ │
│  │ Gate override: [auto ▼]                          │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ... more tools ...                                   │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Blocked Tools (click to expand)                  │ │
│  │ □ delete_email  □ modify_labels                  │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│                              [Save Gate Overrides]    │
└─────────────────────────────────────────────────────┘
```

Each tool row shows:
- **Tool name** (bold)
- **Description** from MCP server
- **Parameters** — summary of required params from inputSchema
- **Annotation tags** — derived from MCP annotations (readOnlyHint, destructiveHint, etc.)
- **Gate override dropdown** — per-tool gate level (auto/review/block), saved to `toolGateOverrides` on the server config
- **Blocked checkbox** — toggle to add/remove from `blockedTools` array

This component (`McpToolBrowser`) is reusable — also embedded in the agent edit page to show which MCP tools an agent will have access to.

#### Delete Confirmation

Standard `ConfirmDialog` pattern:
```
Delete "Gmail" MCP server? This will remove the server
configuration and all agent links. Agents will lose access
to tools from this server on their next run.

[Cancel]  [Delete]
```

### Agent Edit Page Integration

In `AdminAgentEditPage.tsx`, add a new section after the existing "Skills" section:

```
┌─────────────────────────────────────────────────┐
│  MCP Servers                                      │
│  External tool servers available to this agent    │
├─────────────────────────────────────────────────┤
│                                                   │
│  ☑ Gmail (5 tools) — Gate: auto                  │
│  ☑ Slack (8 tools) — Gate: review                │
│  ☐ HubSpot (12 tools) — Gate: auto              │
│  ☑ GitHub (12 tools) — Gate: auto                │
│                                                   │
│  ⓘ By default, agents have access to all active   │
│    MCP servers. Uncheck to restrict.              │
│                                                   │
│  [View MCP Tools]                                │
└─────────────────────────────────────────────────┘
```

**Behaviour:**
- Fetch org MCP servers: `GET /api/mcp-servers`
- Fetch existing agent links: `GET /api/mcp-servers/:id/agent-links` for each server (or a bulk endpoint)
- Default: all servers checked (opt-out model). Unchecking removes the link.
- "View MCP Tools" opens the `McpToolBrowser` component showing all MCP tools this agent will have access to
- On save: create/delete `mcp_server_agent_links` as needed

### Real-Time Updates

Use existing `useSocketRoom` pattern for live status updates:

```typescript
useSocketRoom('org', organisationId, {
  'mcp:server_status_changed': (data: { serverId: string; status: string; error?: string }) => {
    setServers(prev => prev.map(s =>
      s.id === data.serverId ? { ...s, status: data.status, lastError: data.error ?? s.lastError } : s
    ));
  },
  'mcp:tools_refreshed': (data: { serverId: string; toolCount: number }) => {
    load(); // Reload server list to get updated tool counts
  },
});
```

Server-side: emit these events from `mcpClientManager` when connection status changes or tools are refreshed.

### Breadcrumb

Add to `Layout.tsx` breadcrumb mapping:
```typescript
const SEG: Record<string, string | null> = {
  // ... existing ...
  'mcp-servers': 'MCP Servers',
};
```

---

## Permissions

### New Permission Keys

Add to `server/lib/permissions.ts`:

```typescript
// In ORG_PERMISSIONS:
MCP_SERVERS_VIEW: 'org.mcp_servers.view',
MCP_SERVERS_MANAGE: 'org.mcp_servers.manage',

// In ALL_PERMISSIONS array:
{ key: ORG_PERMISSIONS.MCP_SERVERS_VIEW, description: 'View MCP server configurations', groupName: 'org.mcp_servers' },
{ key: ORG_PERMISSIONS.MCP_SERVERS_MANAGE, description: 'Create/edit/delete MCP server configurations', groupName: 'org.mcp_servers' },
```

### Route Guards

| Route | Permission |
|-------|-----------|
| `GET /api/mcp-servers` | `org.mcp_servers.view` |
| `POST /api/mcp-servers` | `org.mcp_servers.manage` |
| `GET /api/mcp-servers/:id` | `org.mcp_servers.view` |
| `PATCH /api/mcp-servers/:id` | `org.mcp_servers.manage` |
| `DELETE /api/mcp-servers/:id` | `org.mcp_servers.manage` |
| `POST /api/mcp-servers/:id/test` | `org.mcp_servers.manage` |
| `POST /api/mcp-servers/:id/refresh-tools` | `org.mcp_servers.manage` |
| Agent link CRUD | `org.mcp_servers.manage` |

### UI Permission Checks

- Nav item: `hasOrgPerm('org.mcp_servers.view')`
- Create/Edit/Delete buttons: `hasOrgPerm('org.mcp_servers.manage')`
- Agent edit MCP section: `hasOrgPerm('org.mcp_servers.view')` (view), `hasOrgPerm('org.mcp_servers.manage')` (toggle links)

---

## Security Considerations

### Process Isolation

Stdio MCP servers run as child processes. Security measures:

1. **No shell execution** — use `spawn()` not `exec()`. The `StdioClientTransport` from the SDK already does this.
2. **Command allowlist** — restrict executable commands to a known-safe set:
   ```typescript
   const ALLOWED_COMMANDS = new Set(['npx', 'node', 'docker', 'uvx', 'python3']);

   if (!ALLOWED_COMMANDS.has(config.command)) {
     throw new Error(`Command "${config.command}" not in allowed list. Contact system admin.`);
   }
   ```
   Enforced in `connectForRun` before spawning. System admins can extend the allowlist via `server/config/limits.ts`. This prevents arbitrary binary execution from misconfigured or malicious server configs.
3. **Environment scoping** — only pass explicitly configured env vars to the child process, not `process.env`. Prevent leaking server secrets.
4. **Timeout enforcement** — kill child process if it exceeds connection timeout (10s) or per-call timeout (30s).
5. **Resource limits** — consider `ulimit` or cgroup constraints for stdio processes in production. Phase 2 concern.

### Credential Security

1. `envEncrypted` field uses the same AES-256-GCM encryption as `connectionTokenService` — reuse existing encryption infrastructure.
2. OAuth tokens from `connectionId` are decrypted in-memory, passed as env vars, never written to disk.
3. Env vars displayed in UI are masked (show `***` after creation, only editable not readable).

### Tool Execution Safety

1. All MCP tool calls go through `actionService.proposeAction()` — gate evaluation applies.
2. MCP annotations (`destructiveHint`, `readOnlyHint`) inform default gate levels — destructive tools default to `review`.
3. `blockedTools` on server config provides a hard deny list per server.
4. `allowedSkillSlugs` on `subaccountAgents` still applies — MCP tool slugs can be added to subaccount allowlists/blocklists.

---

## Verification Plan

### Unit Tests

| Test | What it verifies |
|------|-----------------|
| `mcpClientManager.connectForRun` | Spawns stdio client, calls tools/list, returns namespaced tools |
| `mcpClientManager.callTool` | Routes through action audit, calls MCP server, returns result |
| `mcpClientManager.disconnectAll` | Gracefully closes all client connections |
| `mcpServerConfigService` CRUD | Standard create/read/update/delete with org scoping |
| Tool slug namespacing | `mcp.gmail.send_email` correctly parsed into server slug + tool name |
| Gate resolution | Per-tool overrides take precedence over server default |
| Tool filtering | `allowedTools` / `blockedTools` correctly applied |
| Credential injection | OAuth token from connectionId injected into env |

### Integration Tests

| Test | What it verifies |
|------|-----------------|
| Full run with MCP tools | Agent run discovers MCP tools, calls one, result appears in run output |
| MCP server failure | One server fails to connect; agent still runs with remaining servers + internal skills |
| Review-gated MCP tool | Tool call creates review item; approval triggers MCP execution |
| Tool count limit | Exceeding MAX_MCP_TOOLS_PER_RUN truncates tool list gracefully |

### Manual Verification

1. Create Gmail MCP server config via UI
2. Click "Test Connection" — should show discovered tools
3. Set `send_email` tool to `review` gate
4. Run an agent that has Gmail MCP server linked
5. Agent should see `mcp.gmail.send_email` in its tool list
6. When agent calls the tool, it should create a review item
7. Approving the review item should execute the MCP tool call
8. Result should appear in the agent run output and action audit trail

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP server process hangs | Agent run blocks | 10s connect timeout, 30s call timeout, `SIGKILL` on timeout |
| Tool name collisions across servers | Wrong server called | Namespacing (`mcp.<slug>.<tool>`) prevents collisions |
| Too many tools overwhelm LLM | Poor tool selection | MAX_MCP_TOOLS_PER_RUN limit (30), per-server tool filtering |
| OAuth token expires mid-run | Tool call fails | Use existing auto-refresh (15min buffer) before injecting token |
| Community MCP server breaks | Tool calls fail | Action retry policy applies; server marked as `error` in UI |
| Env vars contain secrets | Leak risk | AES-256-GCM encryption at rest, masked in UI, scoped env for child process |
| SDK v1→v2 migration | Breaking changes | SDK v2 stable expected Q1 2026; v1.29 is production-ready; migration is incremental |

---

## Implementation Phases

### Phase 1 (this spec) — Stdio Transport + Core UI (5-8 days)

- DB schema + migration
- `mcpClientManager` service (stdio only)
- `mcpServerConfigService` CRUD
- Routes with permission guards
- Integration into `agentExecutionService` and `skillExecutor`
- `McpServersPage` (list, create/edit modal, test connection, tool browser)
- Agent edit page MCP section
- Nav + routing + permissions

### Phase 2 — HTTP Transport + Presets (3-5 days)

- `StreamableHTTPClientTransport` support in `mcpClientManager`
- MCP server presets (pre-configured templates for popular servers: Gmail, Slack, GitHub, etc.)
- "Add from preset" UI flow — one-click setup with just OAuth connection selection
- Server health monitoring (periodic ping, auto-disable on repeated failures)

### Phase 3 — Advanced Features (3-5 days)

- Per-tool gate overrides in agent edit page (not just server-level)
- MCP server usage analytics (tool call counts, latency, error rates per server)
- Subaccount-level MCP server visibility controls
- MCP server marketplace / discovery UI (browse available servers from registry)

---

## Open Questions for Review

1. **Opt-in vs opt-out model for agents?** Current spec uses opt-out (agents get all MCP servers by default, uncheck to restrict). Alternative: opt-in (agents get no MCP servers unless explicitly linked). Opt-out is simpler for small orgs; opt-in is safer for large orgs.

2. **Should destructive MCP tools default to `review` gate?** If an MCP tool has `destructiveHint: true` in its annotations, should we automatically override the server's `defaultGateLevel` to `review`? This adds safety but reduces admin control.

3. **npm package installation model for stdio servers?** Many MCP servers are npm packages run via `npx -y @package/name`. Should we provide a UI for searching/installing npm packages, or keep it as raw command+args? Raw is simpler and more flexible; npm search is friendlier.

4. **MAX_MCP_TOOLS_PER_RUN default?** Proposed: 30 tools. This is on top of internal skills (which can be 20-40). Total tool count of 50-70 is within Anthropic's recommended range. Too low limits capability; too high degrades tool selection quality.

5. **Should MCP server configs be clonable across orgs?** System admins could create "template" MCP server configs that orgs can clone (similar to system agents → org agents). Useful for managed deployments but adds complexity. Defer to Phase 2/3?

---

## File Summary

### New Files (9)

| File | Lines (est.) |
|------|-------------|
| `server/db/schema/mcpServerConfigs.ts` | ~60 |
| `server/db/schema/mcpServerAgentLinks.ts` | ~30 |
| `server/services/mcpClientManager.ts` | ~350 |
| `server/services/mcpServerConfigService.ts` | ~120 |
| `server/routes/mcpServers.ts` | ~150 |
| `server/routes/mcpServerAgentLinks.ts` | ~80 |
| `migrations/0053_mcp_server_configs.sql` | ~25 |
| `client/src/pages/McpServersPage.tsx` | ~450 |
| `client/src/components/McpToolBrowser.tsx` | ~200 |

### Modified Files (9)

| File | Change |
|------|--------|
| `server/services/skillExecutor.ts` | +15 lines (MCP dispatch branch) |
| `server/services/agentExecutionService.ts` | +30 lines (MCP tool merging + guaranteed cleanup) |
| `server/services/executionLayerService.ts` | +5 lines (register mcp adapter) |
| `server/config/actionRegistry.ts` | +1 line (add 'mcp' to category union) |
| `server/config/limits.ts` | +3 lines (MAX_MCP_TOOLS_PER_RUN, MAX_MCP_CALLS_PER_RUN) |
| `server/lib/permissions.ts` | +5 lines (new permission keys) |
| `server/db/schema/index.ts` | +2 lines (export new tables) |
| `server/index.ts` | +3 lines (mount new routes) |
| `client/src/App.tsx` | +5 lines (new route) |
| `client/src/components/Layout.tsx` | +8 lines (nav item + breadcrumb) |
| `client/src/pages/AdminAgentEditPage.tsx` | +60 lines (MCP server section) |
