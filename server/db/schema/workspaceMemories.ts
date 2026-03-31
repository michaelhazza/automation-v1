import { pgTable, uuid, text, real, integer, boolean, timestamp, index, uniqueIndex, customType } from 'drizzle-orm/pg-core';

// pgvector custom type — stores embedding as vector(1536) in Postgres
const vector = customType<{ data: number[] | null }>({
  dataType() { return 'vector(1536)'; },
  toDriver(val: number[] | null): string | null {
    if (val === null) return null;
    return `[${val.join(',')}]`;
  },
  fromDriver(val: unknown): number[] | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      return val.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return null;
  },
});
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// Workspace Memories — compiled shared memory per workspace (subaccount)
// ---------------------------------------------------------------------------

export const workspaceMemories = pgTable(
  'workspace_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    // Current compiled memory summary
    summary: text('summary'),

    // Compressed board state for context offloading
    boardSummary: text('board_summary'),

    // Quality threshold — entries below this score are excluded from summaries
    qualityThreshold: real('quality_threshold').notNull().default(0.5),

    // Summarisation trigger
    runsSinceSummary: integer('runs_since_summary').notNull().default(0),
    summaryThreshold: integer('summary_threshold').notNull().default(5),

    // Version tracking
    version: integer('version').notNull().default(0),
    summaryGeneratedAt: timestamp('summary_generated_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('workspace_memories_org_idx').on(table.organisationId),
    uniqueSubaccount: uniqueIndex('workspace_memories_subaccount_unique').on(
      table.organisationId,
      table.subaccountId
    ),
  })
);

export type WorkspaceMemory = typeof workspaceMemories.$inferSelect;
export type NewWorkspaceMemory = typeof workspaceMemories.$inferInsert;

// ---------------------------------------------------------------------------
// Workspace Memory Entries — individual insights extracted from agent runs
// ---------------------------------------------------------------------------

export const workspaceMemoryEntries = pgTable(
  'workspace_memory_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),

    content: text('content').notNull(),
    entryType: text('entry_type')
      .notNull()
      .$type<'observation' | 'decision' | 'preference' | 'issue' | 'pattern'>(),

    // Whether this entry has been rolled into the compiled summary
    includedInSummary: boolean('included_in_summary').notNull().default(false),

    // Quality score (0.0–1.0), computed at insertion time
    qualityScore: real('quality_score'),

    // Semantic embedding for vector search (populated asynchronously)
    embedding: vector('embedding'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    subaccountIdx: index('workspace_memory_entries_subaccount_idx').on(
      table.subaccountId,
      table.includedInSummary
    ),
    agentRunIdx: index('workspace_memory_entries_run_idx').on(table.agentRunId),
    createdAtIdx: index('workspace_memory_entries_created_idx').on(table.createdAt),
  })
);

export type WorkspaceMemoryEntry = typeof workspaceMemoryEntries.$inferSelect;
export type NewWorkspaceMemoryEntry = typeof workspaceMemoryEntries.$inferInsert;
