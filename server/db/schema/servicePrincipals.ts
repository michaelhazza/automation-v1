import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

// ---------------------------------------------------------------------------
// Service Principals — non-human identities (e.g. cron jobs, integrations)
// that can own or act on canonical data within an organisation.
// ---------------------------------------------------------------------------

export const servicePrincipals = pgTable(
  'service_principals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id'),
    serviceId: text('service_id').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => ({
    orgServiceUnique: uniqueIndex('service_principals_org_service_unique').on(table.organisationId, table.serviceId),
  })
);

export type ServicePrincipal = typeof servicePrincipals.$inferSelect;
export type NewServicePrincipal = typeof servicePrincipals.$inferInsert;
