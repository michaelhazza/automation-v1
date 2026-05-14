import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { agentRuns } from './agentRuns';
import type { AgentRunCheckpoint } from '../../../shared/types/agentExecutionCheckpoint.js';

// ---------------------------------------------------------------------------
// Agent Run Snapshots — large blob data extracted from agent_runs (H-5)
// Keeps agent_runs lean; snapshots are only fetched when debugging.
//
// Sprint 3 P2.1 Sprint 3A adds two concerns:
//
//   1. `checkpoint` — structured per-iteration checkpoint payload
//      (see AgentRunCheckpoint in server/services/middleware/types.ts).
//      Written by `persistCheckpoint()` inside runAgenticLoop after
//      every iteration. Read by `resumeAgentRun()` in 3A as a library
//      function; wired into an HTTP endpoint + pg-boss resume job in
//      3B.
//
//   2. `toolCallsLog` — DEPRECATED authoritative storage. Becomes a
//      derived projection written at run completion by
//      `toolCallsLogProjectionService.project(runId)` from the
//      `agent_run_messages` table. Sprint 3A keeps the inline writes
//      as a fallback so existing UI reads still work; Sprint 3B
//      removes them once every reader migrates to the new projection.
//      Do NOT add new writers of this column in Sprint 3A code.
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
    /**
     * Array of raw tool call records from the LLM.
     *
     * @deprecated Sprint 3 P2.1 Sprint 3A — this column becomes a
     * derived projection of `agent_run_messages`. Write only via
     * `toolCallsLogProjectionService.project(runId)` at run
     * completion. New readers must go through `agent_run_messages`
     * directly instead of reading this column. See
     * docs/improvements-roadmap-spec.md §P2.1.
     */
    toolCallsLog: jsonb('tool_calls_log'),
    // Sprint 3 P2.1 Sprint 3A — structured per-iteration checkpoint
    // payload. Null until the first iteration completes. See
    // AgentRunCheckpoint in server/services/middleware/types.ts for
    // the shape contract.
    checkpoint: jsonb('checkpoint').$type<AgentRunCheckpoint>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('agent_run_snapshots_run_idx').on(table.runId),
  })
);

export type AgentRunSnapshot = typeof agentRunSnapshots.$inferSelect;
export type NewAgentRunSnapshot = typeof agentRunSnapshots.$inferInsert;
