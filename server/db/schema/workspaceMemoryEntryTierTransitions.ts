import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import type { ConsolidationTier } from '../../../shared/types/memoryConsolidation.js';

// ---------------------------------------------------------------------------
// Workspace Memory Entry Tier Transitions — ground-truth audit trail for
// tier promotions. Written inside the promotion transaction before commit.
// Phase 4 (migration 0372, §6 Phase 4, §10.3).
// ---------------------------------------------------------------------------

export const workspaceMemoryEntryTierTransitions = pgTable(
  'workspace_memory_entry_tier_transitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // No FK constraint to workspace_memory_entries — avoids cascade delete complexity.
    entryId: uuid('entry_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull(),
    oldTier: text('old_tier').notNull().$type<ConsolidationTier>(),
    newTier: text('new_tier').notNull().$type<ConsolidationTier>(),
    configVersion: integer('config_version').notNull(),
    signalContributions: jsonb('signal_contributions').notNull(),
    promotionMode: text('promotion_mode').notNull().$type<'auto' | 'operator-approved'>(),
    approvedByUserId: uuid('approved_by_user_id'),
    jobId: text('job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    lookupIdx: index('workspace_memory_entry_tier_transitions_lookup_idx')
      .on(table.organisationId, table.subaccountId, table.entryId, table.createdAt),
  })
);

export type WorkspaceMemoryEntryTierTransition = typeof workspaceMemoryEntryTierTransitions.$inferSelect;
export type NewWorkspaceMemoryEntryTierTransition = typeof workspaceMemoryEntryTierTransitions.$inferInsert;
