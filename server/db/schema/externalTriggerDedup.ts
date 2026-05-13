import { pgTable, uuid, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

export const externalTriggerDedup = pgTable(
  'external_trigger_dedup',
  {
    provider: text('provider').notNull(),
    dedupKey: text('dedup_key').notNull(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'cascade' }),
    firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
    triggerId: uuid('trigger_id'),
    runId: uuid('run_id'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.dedupKey, table.ownerUserId] }),
    orgOwnerIdx: index('external_trigger_dedup_org_owner_idx')
      .on(table.organisationId, table.ownerUserId, table.firedAt),
  })
);

export type ExternalTriggerDedup = typeof externalTriggerDedup.$inferSelect;
export type InsertExternalTriggerDedup = typeof externalTriggerDedup.$inferInsert;
