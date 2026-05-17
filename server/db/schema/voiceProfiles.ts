import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

export const voiceProfiles = pgTable(
  'voice_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id, { onDelete: 'cascade' }),
    orgScope: boolean('org_scope').notNull().default(false),
    sources: text('sources').array().notNull().default(sql`'{}'`),
    sourceConfig: jsonb('source_config').notNull().default({}),
    sampleSize: integer('sample_size').notNull().default(0),
    profileJson: jsonb('profile_json'),
    state: text('state').notNull().default('pending').$type<'pending' | 'deriving' | 'ready' | 'failed'>(),
    refreshPolicy: text('refresh_policy').notNull().default('manual').$type<'manual' | 'periodic' | 'on_send_count'>(),
    refreshConfig: jsonb('refresh_config').notNull().default({}),
    lastDerivedAt: timestamp('last_derived_at', { withTimezone: true }),
    optOutAt: timestamp('opt_out_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index('voice_profiles_owner_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    subaccountIdx: index('voice_profiles_subaccount_idx')
      .on(table.organisationId, table.subaccountId)
      .where(sql`${table.subaccountId} IS NOT NULL`),
    stateRefreshIdx: index('voice_profiles_state_refresh_idx')
      .on(table.state, table.lastDerivedAt)
      .where(sql`${table.state} IN ('ready', 'pending') AND ${table.optOutAt} IS NULL`),
  })
);

export type VoiceProfile = typeof voiceProfiles.$inferSelect;
export type InsertVoiceProfile = typeof voiceProfiles.$inferInsert;
