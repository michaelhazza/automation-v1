import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { integrationConnections } from './integrationConnections';

// ---------------------------------------------------------------------------
// MCP Server Configs — org-level definitions of external MCP tool servers.
// Each row represents a configured MCP server (from the preset catalogue)
// that agents can connect to for external tool access.
// ---------------------------------------------------------------------------

export const mcpServerConfigs = pgTable(
  'mcp_server_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    // Preset reference — links to MCP_PRESETS config for upgrade path
    presetSlug: text('preset_slug'),

    // Display
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),

    // Transport config
    transport: text('transport').notNull().$type<'stdio' | 'http'>(),
    command: text('command'),
    args: jsonb('args').$type<string[]>(),
    endpointUrl: text('endpoint_url'),

    // Environment variables passed to stdio server (encrypted JSON)
    envEncrypted: text('env_encrypted'),

    // Credential resolution
    credentialProvider: text('credential_provider')
      .$type<'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'stripe' | 'teamwork' | 'custom' | null>(),
    fixedConnectionId: uuid('fixed_connection_id')
      .references(() => integrationConnections.id),

    // Tool filtering
    allowedTools: jsonb('allowed_tools').$type<string[] | null>(),
    blockedTools: jsonb('blocked_tools').$type<string[] | null>(),

    // Gate configuration
    defaultGateLevel: text('default_gate_level')
      .notNull()
      .default('auto')
      .$type<'auto' | 'review' | 'block'>(),
    toolGateOverrides: jsonb('tool_gate_overrides')
      .$type<Record<string, 'auto' | 'review' | 'block'> | null>(),

    // Operational config
    priority: integer('priority').notNull().default(0),
    maxConcurrency: integer('max_concurrency').notNull().default(1),
    connectionMode: text('connection_mode').notNull().default('eager')
      .$type<'eager' | 'lazy'>(),

    // Status
    status: text('status').notNull().default('active')
      .$type<'active' | 'disabled' | 'error'>(),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
    lastError: text('last_error'),

    // Discovered tools cache
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
    discoveredToolsHash: text('discovered_tools_hash'),
    lastToolsRefreshAt: timestamp('last_tools_refresh_at', { withTimezone: true }),
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
    subaccountIdx: index('mcp_server_configs_subaccount_idx')
      .on(table.subaccountId),
    statusIdx: index('mcp_server_configs_status_idx')
      .on(table.status),
  })
);

export type McpServerConfig = typeof mcpServerConfigs.$inferSelect;
export type NewMcpServerConfig = typeof mcpServerConfigs.$inferInsert;
