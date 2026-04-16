import { pgTable, uuid, real, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { agentRuns } from './agentRuns';
import { workspaceMemoryEntries } from './workspaceMemories';

/**
 * memory_citation_scores — per-entry citation scores from the S12 detector.
 *
 * One row per injected memory entry per agent run. `cited` is set when the
 * entry's final_score >= CITATION_THRESHOLD. Feeds the S4 weekly quality
 * adjustment job via rolling-window utility rate computation.
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S12)
 */
export const memoryCitationScores = pgTable(
  'memory_citation_scores',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => workspaceMemoryEntries.id, { onDelete: 'cascade' }),

    /** Tool-call exact-match score ∈ [0, 1]. */
    toolCallScore: real('tool_call_score').notNull(),
    /** Jaccard n-gram overlap score ∈ [0, 1]. */
    textScore: real('text_score').notNull(),
    /** max(toolCallScore, textScore). */
    finalScore: real('final_score').notNull(),
    /** True when finalScore ≥ CITATION_THRESHOLD. */
    cited: boolean('cited').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.entryId] }),
    /** S4 rolling-window walks entry_id → recent scores. */
    entryCreatedIdx: index('memory_citation_scores_entry_created_idx').on(
      table.entryId,
      table.createdAt,
    ),
  }),
);

export type MemoryCitationScore = typeof memoryCitationScores.$inferSelect;
export type NewMemoryCitationScore = typeof memoryCitationScores.$inferInsert;
