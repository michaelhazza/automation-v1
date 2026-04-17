import { pgTable, uuid, text, integer, numeric, jsonb, real, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { canonicalAccounts } from './canonicalAccounts.js';
import { users } from './users.js';
import { integrationConnections } from './integrationConnections.js';

// ---------------------------------------------------------------------------
// Canonical Contacts
// ---------------------------------------------------------------------------

export const canonicalContacts = pgTable(
  'canonical_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    tags: jsonb('tags').$type<string[]>(),
    source: text('source'),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_contacts_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_contacts_account_idx').on(table.accountId),
    orgIdx: index('canonical_contacts_org_idx').on(table.organisationId),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_contacts_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_contacts_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_contacts_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

// ---------------------------------------------------------------------------
// Canonical Opportunities
// ---------------------------------------------------------------------------

export const canonicalOpportunities = pgTable(
  'canonical_opportunities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name'),
    stage: text('stage'),
    value: numeric('value'),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('open').$type<'open' | 'won' | 'lost' | 'abandoned'>(),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }),
    stageHistory: jsonb('stage_history').$type<Array<{ stage: string; enteredAt: string; exitedAt?: string }>>(),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_opportunities_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_opportunities_account_idx').on(table.accountId),
    orgIdx: index('canonical_opportunities_org_idx').on(table.organisationId),
    statusIdx: index('canonical_opportunities_status_idx').on(table.accountId, table.status),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_opportunities_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_opportunities_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_opportunities_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

// ---------------------------------------------------------------------------
// Canonical Conversations
// ---------------------------------------------------------------------------

export const canonicalConversations = pgTable(
  'canonical_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    channel: text('channel').notNull().default('other').$type<'sms' | 'email' | 'chat' | 'phone' | 'other'>(),
    status: text('status').notNull().default('active').$type<'active' | 'inactive' | 'closed'>(),
    messageCount: integer('message_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastResponseTimeSeconds: integer('last_response_time_seconds'),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_conversations_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_conversations_account_idx').on(table.accountId),
    orgIdx: index('canonical_conversations_org_idx').on(table.organisationId),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_conversations_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_conversations_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_conversations_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

// ---------------------------------------------------------------------------
// Canonical Revenue
// ---------------------------------------------------------------------------

export const canonicalRevenue = pgTable(
  'canonical_revenue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    amount: numeric('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    type: text('type').notNull().default('one_time').$type<'one_time' | 'recurring' | 'refund'>(),
    status: text('status').notNull().default('completed').$type<'pending' | 'completed' | 'failed' | 'refunded'>(),
    transactionDate: timestamp('transaction_date', { withTimezone: true }),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_revenue_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_revenue_account_idx').on(table.accountId),
    orgIdx: index('canonical_revenue_org_idx').on(table.organisationId),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('canonical_revenue_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('canonical_revenue_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('canonical_revenue_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

// ---------------------------------------------------------------------------
// Health Snapshots — point-in-time computed health scores
// ---------------------------------------------------------------------------

export const healthSnapshots = pgTable(
  'health_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    factorBreakdown: jsonb('factor_breakdown').notNull().$type<Array<{ factor: string; score: number; weight: number }>>(),
    trend: text('trend').notNull().default('stable').$type<'improving' | 'stable' | 'declining'>(),
    confidence: real('confidence').notNull().default(0.5),
    configVersion: text('config_version'),
    algorithmVersion: text('algorithm_version'),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountTimeIdx: index('health_snapshots_account_time_idx').on(table.accountId, table.createdAt),
    orgIdx: index('health_snapshots_org_idx').on(table.organisationId),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('health_snapshots_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('health_snapshots_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('health_snapshots_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

// ---------------------------------------------------------------------------
// Anomaly Events — detected metric deviations
// ---------------------------------------------------------------------------

export const anomalyEvents = pgTable(
  'anomaly_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    accountId: uuid('account_id').notNull().references(() => canonicalAccounts.id, { onDelete: 'cascade' }),
    metricName: text('metric_name').notNull(),
    currentValue: numeric('current_value'),
    baselineValue: numeric('baseline_value'),
    deviationPercent: real('deviation_percent'),
    direction: text('direction').notNull().default('below').$type<'above' | 'below'>(),
    severity: text('severity').notNull().default('low').$type<'low' | 'medium' | 'high' | 'critical'>(),
    description: text('description'),
    algorithmVersion: text('algorithm_version'),
    configVersion: text('config_version'),
    acknowledged: boolean('acknowledged').notNull().default(false),
    // P3A: ownership & visibility (migration 0165)
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibilityScope: text('visibility_scope').notNull().default('shared_subaccount').$type<'private' | 'shared_team' | 'shared_subaccount' | 'shared_org'>(),
    sharedTeamIds: uuid('shared_team_ids').array().notNull().default(sql`'{}'`),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountTimeIdx: index('anomaly_events_account_time_idx').on(table.accountId, table.createdAt),
    orgSeverityIdx: index('anomaly_events_org_severity_idx').on(table.organisationId, table.severity, table.acknowledged),
    // P3A indexes (migration 0165)
    ownerUserIdx: index('anomaly_events_owner_user_id_idx')
      .on(table.organisationId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    sharedTeamGinIdx: index('anomaly_events_shared_team_gin_idx').using('gin', table.sharedTeamIds),
    sourceConnectionIdx: index('anomaly_events_source_connection_idx')
      .on(table.sourceConnectionId, table.createdAt)
      .where(sql`${table.sourceConnectionId} IS NOT NULL`),
  })
);

export type CanonicalContact = typeof canonicalContacts.$inferSelect;
export type CanonicalOpportunity = typeof canonicalOpportunities.$inferSelect;
export type CanonicalConversation = typeof canonicalConversations.$inferSelect;
export type CanonicalRevenueRecord = typeof canonicalRevenue.$inferSelect;
export type HealthSnapshot = typeof healthSnapshots.$inferSelect;
export type AnomalyEvent = typeof anomalyEvents.$inferSelect;
