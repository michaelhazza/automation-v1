import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

// ---------------------------------------------------------------------------
// Inbox Read States — tracks read/archived status per user per inbox item
// ---------------------------------------------------------------------------

export const inboxReadStates = pgTable(
  'inbox_read_states',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    entityType: text('entity_type').notNull().$type<'task' | 'review_item' | 'agent_run'>(),
    entityId: uuid('entity_id').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userEntityUniq: uniqueIndex('inbox_read_user_entity_uniq').on(table.userId, table.entityType, table.entityId),
    userUnreadIdx: index('inbox_read_user_unread_idx').on(table.userId, table.isRead),
    userArchivedIdx: index('inbox_read_user_archived_idx').on(table.userId, table.isArchived),
  })
);

export type InboxReadState = typeof inboxReadStates.$inferSelect;
export type NewInboxReadState = typeof inboxReadStates.$inferInsert;
