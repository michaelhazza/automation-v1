import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { mcpServerConfigs } from './mcpServerConfigs';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// MCP Server Agent Links — controls which MCP servers are available to which
// agents. If no links exist for an agent, it gets all active org MCP servers
// (opt-out model).
// ---------------------------------------------------------------------------

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
    gateOverride: text('gate_override')
      .$type<'auto' | 'review' | 'block' | null>(),
    allowedToolsOverride: jsonb('allowed_tools_override')
      .$type<string[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serverAgentUnique: uniqueIndex('mcp_server_agent_links_unique')
      .on(table.mcpServerConfigId, table.agentId),
  })
);

export type McpServerAgentLink = typeof mcpServerAgentLinks.$inferSelect;
export type NewMcpServerAgentLink = typeof mcpServerAgentLinks.$inferInsert;
