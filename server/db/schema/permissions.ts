import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const permissions = pgTable(
  'permissions',
  {
    key: text('key').primaryKey(),
    description: text('description').notNull(),
    groupName: text('group_name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  }
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
