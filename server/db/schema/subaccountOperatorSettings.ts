import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// subaccount_operator_settings — per-subaccount operator backend configuration
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.16
//
// One row per subaccount (PRIMARY KEY subaccount_id). Created lazily on first
// write; absent row means use column defaults. Mirrors the shape of
// subaccount_optimiser_settings (same isolated-concern pattern).
//
// R2-F3: settings_version is the deterministic ETag source (integer, not
// timestamp-based). ETag = String(settings_version). PATCH increments via
// settings_version = settings_version + 1.
//
// RLS: dual-GUC scoping on both organisation_id AND subaccount_id.
// Migration: 0337_create_subaccount_operator_settings.sql
// ---------------------------------------------------------------------------

export const subaccountOperatorSettings = pgTable(
  'subaccount_operator_settings',
  {
    // Primary key is the subaccount (one row per subaccount)
    subaccountId: uuid('subaccount_id').primaryKey().references(() => subaccounts.id, { onDelete: 'cascade' }),

    // Defence-in-depth tenant scope for RLS
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),

    // Session limits (spec §3.16)
    sessionSoftCapMinutes: integer('session_soft_cap_minutes').notNull().default(120),
    autoExtendGraceMinutes: integer('auto_extend_grace_minutes').notNull().default(30),

    // Task limits (spec §3.16)
    maxChainLength: integer('max_chain_length').notNull().default(50),
    maxWallClockPerTaskDays: integer('max_wall_clock_per_task_days').notNull().default(30),
    perTaskBudgetCapMinutes: integer('per_task_budget_cap_minutes').notNull().default(6000),

    // Concurrency limit (spec §3.16)
    concurrentOperatorSessionsCap: integer('concurrent_operator_sessions_cap').notNull().default(5),

    // Deterministic ETag source (R2-F3). ETag = String(settings_version).
    // Incremented via settings_version = settings_version + 1 on every PATCH.
    settingsVersion: integer('settings_version').notNull().default(1),

    // Audit
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  },
);

export type SubaccountOperatorSettings = typeof subaccountOperatorSettings.$inferSelect;
export type NewSubaccountOperatorSettings = typeof subaccountOperatorSettings.$inferInsert;
