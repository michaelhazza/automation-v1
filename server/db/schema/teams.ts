import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

// ---------------------------------------------------------------------------
// Teams — groups of users within an organisation, used for visibility scoping
// on canonical data rows and integration connections.
// ---------------------------------------------------------------------------

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id'),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('teams_org_idx').on(table.organisationId),
  })
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
