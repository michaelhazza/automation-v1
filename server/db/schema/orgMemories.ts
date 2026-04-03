import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp, uniqueIndex, index, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { agentRuns } from './agentRuns.js';
import { agents } from './agents.js';

// ---------------------------------------------------------------------------
// Org Memories — compiled summary per organisation (one per org)
// ---------------------------------------------------------------------------

export const orgMemories = pgTable(
  'org_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    summary: text('summary'),
    qualityThreshold: real('quality_threshold').notNull().default(0.5),
    runsSinceSummary: integer('runs_since_summary').notNull().default(0),
    summaryThreshold: integer('summary_threshold').notNull().default(5),
    version: integer('version').notNull().default(1),
    summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgUnique: uniqueIndex('org_memories_org_unique').on(table.organisationId),
  })
);

// ---------------------------------------------------------------------------
// Org Memory Entries — individual cross-subaccount insights
// ---------------------------------------------------------------------------

export const orgMemoryEntries = pgTable(
  'org_memory_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    sourceSubaccountIds: jsonb('source_subaccount_ids').$type<string[]>(),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    agentId: uuid('agent_id').references(() => agents.id),
    content: text('content').notNull(),
    entryType: text('entry_type').notNull().default('observation').$type<'observation' | 'decision' | 'preference' | 'issue' | 'pattern'>(),
    scopeTags: jsonb('scope_tags').$type<Record<string, string>>(),
    qualityScore: real('quality_score').notNull().default(0.5),
    embedding: customType<{ data: number[]; driverData: string }>({
      dataType() { return 'vector(1536)'; },
      toDriver(value) { return JSON.stringify(value); },
      fromDriver(value) { return typeof value === 'string' ? JSON.parse(value) : value as number[]; },
    })('embedding'),
    evidenceCount: integer('evidence_count').notNull().default(1),
    includedInSummary: boolean('included_in_summary').notNull().default(false),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIncludedIdx: index('org_memory_entries_org_idx').on(table.organisationId, table.includedInSummary),
    typeIdx: index('org_memory_entries_type_idx').on(table.organisationId, table.entryType),
  })
);

export type OrgMemory = typeof orgMemories.$inferSelect;
export type OrgMemoryEntry = typeof orgMemoryEntries.$inferSelect;
export type NewOrgMemoryEntry = typeof orgMemoryEntries.$inferInsert;
