import { pgTable, uuid, text, integer, timestamp, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
      'manual_edit' | 'seed' | 'reset_to_canonical' | 'auto_synthesis' | 'workflow_upsert'
    >(),
    notes: text('notes'),
    // Consolidation C — Govern (migration 0286, spec §6) — SHA-256 of override
    // body. Drives key-based idempotency via partial unique index below. Nullable
    // so legacy rows are non-blocking; new override rows always populate it.
    bodyHash: text('body_hash'),
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
    blockBodyHashUniq: uniqueIndex('memory_block_versions_block_body_hash_uq')
      .on(table.memoryBlockId, table.bodyHash)
      .where(sql`${table.bodyHash} IS NOT NULL`),
  }),
);

export type MemoryBlockVersion = typeof memoryBlockVersions.$inferSelect;
export type NewMemoryBlockVersion = typeof memoryBlockVersions.$inferInsert;
