import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';

export const subaccountTags = pgTable(
  'subaccount_tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountKeyUnique: uniqueIndex('subaccount_tags_subaccount_key_unique').on(table.subaccountId, table.key),
    orgKeyValueIdx: index('subaccount_tags_org_key_value_idx').on(table.organisationId, table.key, table.value),
    subaccountIdx: index('subaccount_tags_subaccount_idx').on(table.subaccountId),
  })
);

export type SubaccountTag = typeof subaccountTags.$inferSelect;
export type NewSubaccountTag = typeof subaccountTags.$inferInsert;
