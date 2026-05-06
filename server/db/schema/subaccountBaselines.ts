import { pgTable, uuid, text, integer, smallint, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';
import { users } from './users.js';

export type BaselineStatus = 'pending' | 'ready' | 'capturing' | 'captured' | 'failed' | 'manual' | 'reset';
export type BaselineSource = 'auto' | 'manual' | 'mixed';
export type BaselineConfidence = 'confirmed' | 'estimated' | 'partial';

export const subaccountBaselines = pgTable(
  'subaccount_baselines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    baselineVersion: integer('baseline_version').notNull().default(1),
    status: text('status').notNull().$type<BaselineStatus>(),
    captureAttemptCount: smallint('capture_attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    source: text('source').notNull().default('auto').$type<BaselineSource>(),
    confidence: text('confidence').notNull().default('partial').$type<BaselineConfidence>(),
    failureReason: text('failure_reason'),
    adminResetReason: text('admin_reset_reason'),
    resetAt: timestamp('reset_at', { withTimezone: true }),
    resetByUserId: uuid('reset_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activeUniq: uniqueIndex('subaccount_baselines_active_uniq')
      .on(table.subaccountId)
      .where(sql`${table.status} <> 'reset'`),
    statusIdx: index('subaccount_baselines_status_idx').on(table.organisationId, table.status),
    pendingRetryIdx: index('subaccount_baselines_pending_retry_idx')
      .on(table.lastAttemptAt)
      .where(sql`${table.status} = 'ready' AND ${table.captureAttemptCount} > 0`),
  }),
);

export type SubaccountBaseline = typeof subaccountBaselines.$inferSelect;
export type NewSubaccountBaseline = typeof subaccountBaselines.$inferInsert;
