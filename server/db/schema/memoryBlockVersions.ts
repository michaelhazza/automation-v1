import { pgTable, uuid, text, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { memoryBlocks } from './memoryBlocks';

/**
 * memory_block_versions — per-block version history (§S24)
 *
 * Every content-mutation path writes a row in the same transaction as the
 * block update. Consecutive identical-content versions coalesce (idempotent).
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 */
export const memoryBlockVersions = pgTable(
  'memory_block_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    memoryBlockId: uuid('memory_block_id')
      .notNull()
      .references(() => memoryBlocks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    /** Monotonically incremented per block. */
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Null for seed events. */
    createdByUserId: uuid('created_by_user_id'),
    changeSource: text('change_source').notNull().$type<
      'manual_edit' | 'seed' | 'reset_to_canonical' | 'auto_synthesis' | 'playbook_upsert'
    >(),
    notes: text('notes'),
  },
  (table) => ({
    blockVersionUniq: unique('memory_block_versions_block_version_uq').on(
      table.memoryBlockId,
      table.version,
    ),
    blockVersionIdx: index('memory_block_versions_block_version_idx').on(
      table.memoryBlockId,
      table.version,
    ),
  }),
);

export type MemoryBlockVersion = typeof memoryBlockVersions.$inferSelect;
export type NewMemoryBlockVersion = typeof memoryBlockVersions.$inferInsert;
