import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// Agent Run Messages — Sprint 3 P2.1 Sprint 3A append-only message log
//
// The authoritative per-run conversation transcript. Mirrors every
// assistant response and every tool-results batch from
// `runAgenticLoop`'s in-memory `messages[]` array the moment it is
// pushed. Sprint 3A only writes to this table; the Sprint 3B resume
// path is the first consumer.
//
// Invariants enforced in SQL (see migration 0084):
//   * `(run_id, sequence_number)` unique — monotonic ordering per run.
//   * `sequence_number >= 0` — never negative.
//   * RLS: isolated per organisation via `app.organisation_id` GUC.
//
// See `server/services/agentRunMessageService.ts` for the write-side
// helper (appendMessage) and the allocator for `sequence_number`.
// ---------------------------------------------------------------------------

export const agentRunMessages = pgTable(
  'agent_run_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),

    // Monotonic per-run sequence number. Combined with runId this is
    // the logical primary key for ordering; the surrogate id is kept
    // for foreign-key hygiene. Uniqueness is enforced via the unique
    // index below.
    sequenceNumber: integer('sequence_number').notNull(),

    // Conversation role mirrored from the in-memory array:
    //   'assistant' — LLM response (may contain tool_use blocks)
    //   'user'      — tool results batch OR human input
    //   'system'    — system prompt (rarely mirrored; kept for future)
    role: text('role').notNull().$type<'assistant' | 'user' | 'system'>(),

    // Provider-neutral content blocks. Structure matches
    // `{ type, text | tool_use | tool_result }` used by the llmService
    // adapters. Stored as jsonb so a single assistant message can
    // carry multiple tool_use blocks and a single user message can
    // carry multiple tool_result blocks.
    content: jsonb('content').notNull(),

    // Top-level tool_call_id for single-block messages. NULL for plain
    // text messages or messages with multiple tool blocks. Lets the
    // Sprint 3B projection service index tool calls without scanning
    // content jsonb.
    toolCallId: text('tool_call_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runSeqUnique: uniqueIndex('agent_run_messages_run_seq_unique').on(
      table.runId,
      table.sequenceNumber,
    ),
    orgIdx: index('agent_run_messages_org_idx').on(table.organisationId),
    // Partial index mirroring the SQL migration: only indexes rows
    // with a non-null toolCallId so the projection service can look
    // up tool-call messages without a sequential scan.
    toolCallIdx: index('agent_run_messages_tool_call_idx')
      .on(table.runId, table.toolCallId)
      .where(sql`${table.toolCallId} IS NOT NULL`),
  }),
);

export type AgentRunMessage = typeof agentRunMessages.$inferSelect;
export type NewAgentRunMessage = typeof agentRunMessages.$inferInsert;
