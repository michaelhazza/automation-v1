import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// Agent Run Snapshots — large blob data extracted from agent_runs (H-5)
// Keeps agent_runs lean; snapshots are only fetched when debugging.
// ---------------------------------------------------------------------------

export const agentRunSnapshots = pgTable(
  'agent_run_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .unique()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    // Full system prompt rendered for this run
    systemPromptSnapshot: text('system_prompt_snapshot'),
    // Array of raw tool call records from the LLM
    toolCallsLog: jsonb('tool_calls_log'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('agent_run_snapshots_run_idx').on(table.runId),
  })
);

export type AgentRunSnapshot = typeof agentRunSnapshots.$inferSelect;
export type NewAgentRunSnapshot = typeof agentRunSnapshots.$inferInsert;
