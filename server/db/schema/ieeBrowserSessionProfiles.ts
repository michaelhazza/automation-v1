import { pgTable, uuid, text, integer, bigint, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const ieeBrowserSessionProfiles = pgTable(
  'iee_browser_session_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'cascade' }),
    sessionKey: text('session_key').notNull().default('default'),
    volumeId: text('volume_id').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    sizeCapBytes: bigint('size_cap_bytes', { mode: 'number' }).notNull().default(524288000),
    status: text('status').notNull().default('active')
      .$type<'active' | 'scheduled_gc' | 'gc_in_progress' | 'gc_done'>(),
    scheduledGcAt: timestamp('scheduled_gc_at', { withTimezone: true }),
    gcStartedAt: timestamp('gc_started_at', { withTimezone: true }),
    retentionDaysOverride: integer('retention_days_override'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantKeyUniqueIdx: uniqueIndex('iee_browser_session_profiles_tenant_key_unique_idx')
      .on(table.organisationId, table.subaccountId, table.sessionKey),
    lastUsedAtIdx: index('iee_browser_session_profiles_last_used_at_idx').on(table.lastUsedAt),
  }),
);

export type IeeBrowserSessionProfile = typeof ieeBrowserSessionProfiles.$inferSelect;
export type NewIeeBrowserSessionProfile = typeof ieeBrowserSessionProfiles.$inferInsert;
