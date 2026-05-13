import { pgTable, uuid, text, numeric, integer, timestamp } from 'drizzle-orm/pg-core';
import { memoryBlockVersions } from './memoryBlockVersions.js';
import { workspaceMemoryEntries } from './workspaceMemories.js';
import { agentRuns } from './agentRuns.js';

/**
 * memory_block_version_sources — per-version lineage: which workspace_memory_entries
 * contributed to each auto-synthesised memory_block_versions row.
 *
 * Written by memoryBlockLineageService at synthesis time (spec §4 Phase 1).
 * Deletion-safe: source_entry_id + source_run_id are FK SET NULL so rows survive
 * hard-deletion of the source entry or run; captured hashes + labels are retained.
 * RLS: tenant_isolation policy on organisation_id (migration 0333).
 */
export const memoryBlockVersionSources = pgTable('memory_block_version_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  blockVersionId: uuid('block_version_id')
    .notNull()
    .references(() => memoryBlockVersions.id, { onDelete: 'cascade' }),
  sourceEntryId: uuid('source_entry_id').references(() => workspaceMemoryEntries.id, {
    onDelete: 'set null',
  }),
  sourceEntryIdHash: text('source_entry_id_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  // v1 only: always 'workspace_memory'. Narrowed via $type for future expansion.
  sourceType: text('source_type').notNull().$type<'workspace_memory'>(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  qualityScoreAtCapture: numeric('quality_score_at_capture'),
  contributionRank: integer('contribution_rank').notNull(),
  sourceRunId: uuid('source_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  sourceRunIdHash: text('source_run_id_hash'),
  sourceRunLabelAtCapture: text('source_run_label_at_capture'),
});

export type MemoryBlockVersionSource = typeof memoryBlockVersionSources.$inferSelect;
export type NewMemoryBlockVersionSource = typeof memoryBlockVersionSources.$inferInsert;
