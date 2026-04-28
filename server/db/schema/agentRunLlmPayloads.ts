import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agentRuns } from './agentRuns';
import { llmRequests } from './llmRequests';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Agent Run LLM Payloads — full request + response body per ledger row.
// Migration 0192. Spec: tasks/live-agent-execution-log-spec.md §5.7.
//
// Keyed by llm_request_id (1:1 with llm_requests). Written in the same
// transaction as the terminal ledger row (spec §4.5). Hard size cap at
// write time via server/services/agentRunPayloadWriter.ts; TOAST handles
// compression of what's left.
//
// `redacted_fields` captures pattern-based redaction (§7.4).
// `modifications` captures everything else (truncation, tool-policy
// substitution — §4.5). Split kept so "did we scrub secrets?" and "did we
// truncate / suppress?" have separate, unambiguous columns.
// ---------------------------------------------------------------------------

export const agentRunLlmPayloads = pgTable(
  'agent_run_llm_payloads',
  {
    llmRequestId: uuid('llm_request_id')
      .primaryKey()
      .references(() => llmRequests.id, { onDelete: 'cascade' }),
    // Denormalised agent-run FK. Nullable — non-agent LLM callers
    // (skill-analyzer, configuration assistant) produce payloads without
    // a run. When present, lets us scan payloads per-run in a single
    // index seek instead of joining through llm_requests.
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    systemPrompt: text('system_prompt').notNull(),
    messages: jsonb('messages').notNull().$type<unknown[]>(),
    toolDefinitions: jsonb('tool_definitions').notNull().$type<unknown[]>(),
    // Nullable as of migration 0241 — a failure-path payload row carrying
    // `response IS NULL` records the failure without faking a provider
    // result. Spec `2026-04-28-pre-test-integration-harness-spec.md` §1.5
    // Option A. Partial responses (streaming interrupted, usage-without-
    // content) are persisted with a non-null value; null is reserved for
    // "no usable provider output exists".
    response: jsonb('response').$type<Record<string, unknown> | null>(),

    redactedFields: jsonb('redacted_fields').notNull().default([]).$type<unknown[]>(),
    modifications: jsonb('modifications').notNull().default([]).$type<unknown[]>(),

    totalSizeBytes: integer('total_size_bytes').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index('agent_run_llm_payloads_org_created_idx').on(
      table.organisationId,
      table.createdAt,
    ),
    runIdIdx: index('agent_run_llm_payloads_run_id_idx')
      .on(table.runId)
      .where(sql`${table.runId} IS NOT NULL`),
  }),
);

export type AgentRunLlmPayloadRow = typeof agentRunLlmPayloads.$inferSelect;
export type NewAgentRunLlmPayloadRow = typeof agentRunLlmPayloads.$inferInsert;
