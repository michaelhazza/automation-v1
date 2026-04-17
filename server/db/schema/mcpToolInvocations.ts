import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { agents } from './agents';
import { mcpServerConfigs } from './mcpServerConfigs';

// ---------------------------------------------------------------------------
// mcp_tool_invocations — append-only ledger for every MCP tool call attempt.
// One row per attempt (including retries). See docs/mcp-tool-invocations-spec.md.
// ---------------------------------------------------------------------------

export const mcpToolInvocations = pgTable(
  'mcp_tool_invocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    runId: uuid('run_id').references(() => agentRuns.id),
    agentId: uuid('agent_id').references(() => agents.id),
    mcpServerConfigId: uuid('mcp_server_config_id').references(() => mcpServerConfigs.id),

    serverSlug: text('server_slug').notNull(),
    toolName: text('tool_name').notNull(),

    // Gate decision at call time; null for pre-execution exits where no instance is resolved
    gateLevel: text('gate_level').$type<'auto' | 'review' | 'block'>(),

    // Low-level call-execution status — distinct from run-level or action-level status enums
    status: text('status').notNull().$type<'success' | 'error' | 'timeout' | 'budget_blocked'>(),

    // DB CHECK enforces: null iff status='success', non-null otherwise (mcp_tool_invocations_failure_reason_chk)
    failureReason: text('failure_reason')
      .$type<'timeout' | 'process_crash' | 'invalid_response' | 'auth_error' | 'rate_limited' | 'unknown'>(),

    // 0 for pre-execution exits (budget-blocked, connect failure, etc.)
    durationMs: integer('duration_ms').notNull().default(0),

    // UTF-8 byte length of JSON.stringify(result) before truncation; null on error
    responseSizeBytes: integer('response_size_bytes'),
    wasTruncated: boolean('was_truncated').notNull().default(false),

    // Denormalised from agentRuns.isTestRun at insert time
    isTestRun: boolean('is_test_run').notNull().default(false),

    // Canonical ordering key within a run; null for pre-execution exits (budget-blocked etc.)
    callIndex: integer('call_index'),

    billingMonth: text('billing_month').notNull(),
    billingDay: text('billing_day').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Prevents double-writes for the same attempt (e.g. finally + retry edge cases)
    runCallUnique: uniqueIndex('mcp_tool_invocations_run_call_unique')
      .on(table.runId, table.callIndex)
      .where(sql`${table.runId} IS NOT NULL AND ${table.callIndex} IS NOT NULL`),
    orgMonthIdx: index('mcp_tool_invocations_org_month_idx')
      .on(table.organisationId, table.billingMonth),
    subMonthIdx: index('mcp_tool_invocations_sub_month_idx')
      .on(table.subaccountId, table.billingMonth)
      .where(sql`${table.subaccountId} IS NOT NULL`),
    // Covering index for F4 GROUP BY server_slug WHERE run_id = :id query
    runServerIdx: index('mcp_tool_invocations_run_server_idx')
      .on(table.runId, table.serverSlug)
      .where(sql`${table.runId} IS NOT NULL`),
    serverSlugIdx: index('mcp_tool_invocations_server_slug_idx')
      .on(table.organisationId, table.serverSlug, table.billingMonth),
  })
);

export type McpToolInvocation = typeof mcpToolInvocations.$inferSelect;
export type NewMcpToolInvocation = typeof mcpToolInvocations.$inferInsert;
