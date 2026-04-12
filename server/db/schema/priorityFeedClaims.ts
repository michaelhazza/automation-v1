import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// priority_feed_claims — Feature 2: optimistic claim locks for feed entries
// ---------------------------------------------------------------------------

export const priorityFeedClaims = pgTable(
  'priority_feed_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    itemSource: text('item_source').notNull(),
    itemId: text('item_id').notNull(),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    itemUnique: uniqueIndex('priority_feed_claims_item_idx').on(table.itemSource, table.itemId),
    expiresIdx: index('priority_feed_claims_expires_idx').on(table.expiresAt),
  }),
);

export type PriorityFeedClaim = typeof priorityFeedClaims.$inferSelect;
export type NewPriorityFeedClaim = typeof priorityFeedClaims.$inferInsert;
