import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { memoryBlocks } from './memoryBlocks';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Memory Block Attachments — links a memory block to an agent with
// read or read_write permissions. Spec: P4.2.
// ---------------------------------------------------------------------------

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
