import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// Tool Call Security Events — P1.1 Layer 3 audit trail for the universal
// preTool authorisation hook. Every tool call evaluated by the middleware
// writes one row here (allow or deny). Separate from action_events and
// audit_events because:
//   - Higher write volume (every tool call, not just gated ones).
//   - Different retention requirements (compliance log, longer retention).
//   - Querying for security audits should not contend with run-state queries.
//
// Idempotency: a partial unique index on (agent_run_id, tool_call_id) lets
// the middleware use INSERT ... ON CONFLICT DO NOTHING to dedupe replays
// from retry loops, reflection injection, and pg-boss re-delivery.
//
// NOTE: the partial unique index `tool_call_security_events_run_tool_unique`
// (WHERE tool_call_id IS NOT NULL) is created in migration 0082 — drizzle
// does not support partial unique indexes natively in the schema DSL.
//
// See docs/improvements-roadmap-spec.md §P1.1 Layer 3.
// ---------------------------------------------------------------------------

export const toolCallSecurityEvents = pgTable(
  'tool_call_security_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    agentRunId: uuid('agent_run_id')
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    // Tool call id as emitted by the LLM (Anthropic tool_use.id). Nullable
    // so system-initiated checks with no tool_use id can still write an
    // audit row. The dedupe unique index is WHERE tool_call_id IS NOT NULL.
    toolCallId: text('tool_call_id'),
    toolSlug: text('tool_slug').notNull(),
    decision: text('decision').notNull().$type<'allow' | 'deny' | 'review'>(),
    // Populated on deny or review. Free text from the policy / scope layer.
    reason: text('reason'),
    // sha256 of canonicalised args — no PII, used for replay dedupe.
    argsHash: text('args_hash').notNull(),
    // Per-field breakdown from validateScope (when scope checks ran).
    scopeCheckResults: jsonb('scope_check_results'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index('tool_call_security_events_org_idx').on(
      table.organisationId,
      table.createdAt,
    ),
    runIdx: index('tool_call_security_events_run_idx').on(table.agentRunId),
  })
);

export type ToolCallSecurityEvent = typeof toolCallSecurityEvents.$inferSelect;
export type NewToolCallSecurityEvent = typeof toolCallSecurityEvents.$inferInsert;
