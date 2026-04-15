import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { memoryBlocks } from './memoryBlocks';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Memory Block Attachments — links a memory block to an agent with
// read or read_write permissions. Spec: P4.2.
//
// Phase G / §7.4 additions (migration 0125):
//   - `source` distinguishes manual vs. auto-attach provenance.
//   - `deletedAt` soft-delete tombstone — once a user detaches an
//     auto-attached row, re-running the auto-attach iteration does NOT
//     revive it (G7.3).
// ---------------------------------------------------------------------------

export type MemoryBlockAttachmentSource = 'manual' | 'auto_attach';

export const memoryBlockAttachments = pgTable(
  'memory_block_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    blockId: uuid('block_id')
      .notNull()
      .references(() => memoryBlocks.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    permission: text('permission').notNull().$type<'read' | 'read_write'>(),
    source: text('source').notNull().default('manual').$type<MemoryBlockAttachmentSource>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    blockAgentIdx: uniqueIndex('memory_block_attachments_block_agent_idx')
      .on(table.blockId, table.agentId),
    agentIdx: index('memory_block_attachments_agent_idx')
      .on(table.agentId),
  })
);

export type MemoryBlockAttachment = typeof memoryBlockAttachments.$inferSelect;
export type NewMemoryBlockAttachment = typeof memoryBlockAttachments.$inferInsert;
