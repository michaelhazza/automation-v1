import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { tasks } from './tasks';

// ---------------------------------------------------------------------------
// feature_requests — durable capability-request signal
//
// Written by the request_feature skill when the Orchestrator determines a
// request exercises a capability the platform does not currently support
// (Path D) or matches a system-promotion candidate pattern (Path C).
//
// See docs/orchestrator-capability-routing-spec.md §5.2.
// ---------------------------------------------------------------------------

export type FeatureRequestCategory = 'new_capability' | 'system_promotion_candidate' | 'infrastructure_alert';
export type FeatureRequestStatus = 'open' | 'triaged' | 'accepted' | 'rejected' | 'shipped' | 'duplicate';

export const featureRequests = pgTable(
  'feature_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Attribution
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
    requestedByAgentId: uuid('requested_by_agent_id'),
    sourceTaskId: uuid('source_task_id').references(() => tasks.id),

    // Classification
    category: text('category').notNull().$type<FeatureRequestCategory>(),
    status: text('status').notNull().default('open').$type<FeatureRequestStatus>(),

    // Dedupe (§5.4)
    dedupeHash: text('dedupe_hash').notNull(),
    dedupeGroupCount: integer('dedupe_group_count').notNull().default(1),

    // Content
    summary: text('summary').notNull(),
    userIntent: text('user_intent').notNull(),
    requiredCapabilities: jsonb('required_capabilities').notNull().$type<Array<{ kind: string; slug: string }>>(),
    missingCapabilities: jsonb('missing_capabilities').notNull().$type<Array<{ kind: string; slug: string }>>(),
    orchestratorReasoning: text('orchestrator_reasoning'),

    // Workflow
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notificationChannels: jsonb('notification_channels'),
    triagedBy: uuid('triaged_by').references(() => users.id),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    resolutionNotes: text('resolution_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgCreatedIdx: index('feature_requests_org_created_idx')
      .on(table.organisationId, table.createdAt)
      .where(sql`${table.deletedAt} IS NULL`),
    categoryStatusIdx: index('feature_requests_category_status_idx')
      .on(table.category, table.status)
      .where(sql`${table.deletedAt} IS NULL`),
    statusIdx: index('feature_requests_status_idx')
      .on(table.status)
      .where(sql`${table.deletedAt} IS NULL`),
    orgDedupeIdx: index('feature_requests_org_dedupe_idx')
      .on(table.organisationId, table.dedupeHash)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type FeatureRequest = typeof featureRequests.$inferSelect;
export type NewFeatureRequest = typeof featureRequests.$inferInsert;
