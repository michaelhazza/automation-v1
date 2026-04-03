import { pgTable, uuid, text, integer, numeric, jsonb, real, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { canonicalAccounts } from './canonicalAccounts.js';

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_contacts_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_contacts_account_idx').on(table.accountId),
    orgIdx: index('canonical_contacts_org_idx').on(table.organisationId),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_opportunities_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_opportunities_account_idx').on(table.accountId),
    orgIdx: index('canonical_opportunities_org_idx').on(table.organisationId),
    statusIdx: index('canonical_opportunities_status_idx').on(table.accountId, table.status),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_conversations_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_conversations_account_idx').on(table.accountId),
    orgIdx: index('canonical_conversations_org_idx').on(table.organisationId),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountExternalUnique: uniqueIndex('canonical_revenue_account_external_unique').on(table.accountId, table.externalId),
    accountIdx: index('canonical_revenue_account_idx').on(table.accountId),
    orgIdx: index('canonical_revenue_org_idx').on(table.organisationId),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountTimeIdx: index('health_snapshots_account_time_idx').on(table.accountId, table.createdAt),
    orgIdx: index('health_snapshots_org_idx').on(table.organisationId),
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
    acknowledged: boolean('acknowledged').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountTimeIdx: index('anomaly_events_account_time_idx').on(table.accountId, table.createdAt),
    orgSeverityIdx: index('anomaly_events_org_severity_idx').on(table.organisationId, table.severity, table.acknowledged),
  })
);

export type CanonicalContact = typeof canonicalContacts.$inferSelect;
export type CanonicalOpportunity = typeof canonicalOpportunities.$inferSelect;
export type CanonicalConversation = typeof canonicalConversations.$inferSelect;
export type CanonicalRevenueRecord = typeof canonicalRevenue.$inferSelect;
export type HealthSnapshot = typeof healthSnapshots.$inferSelect;
export type AnomalyEvent = typeof anomalyEvents.$inferSelect;
