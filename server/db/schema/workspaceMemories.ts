import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
