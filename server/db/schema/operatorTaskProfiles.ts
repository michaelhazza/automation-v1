import { pgTable, uuid, text, integer, bigint, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { users } from './users';

// ---------------------------------------------------------------------------
// operator_task_profiles — persistent browser profile volumes per task
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.15
//
// One row per (task_id, attempt_number). The volume persists across chain links
// for the same task attempt, allowing the browser state to survive the 120-min
// soft cap boundaries.
//
// RLS: dual-GUC scoping on both organisation_id AND subaccount_id.
// Migration: 0336_create_operator_task_profiles.sql
// ---------------------------------------------------------------------------

export const operatorTaskProfiles = pgTable(
  'operator_task_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // One profile per task attempt (spec §3.15 item 1)
    taskId: uuid('task_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),

    // Tenant scoping (dual-GUC RLS)
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),

    // Attempt tracking (bumps on fresh-profile restart)
    attemptNumber: integer('attempt_number').notNull().default(1),

    // Opaque sandbox-volume identifier (safe to log)
    volumeId: text('volume_id').notNull(),

    // Size tracking (updated on each chain link end)
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),

    // System-wide 500 MB cap (spec §3.15 item 3)
    sizeCapBytes: bigint('size_cap_bytes', { mode: 'number' }).notNull().default(524288000),

    // Profile lifecycle (spec §3.15 item 4)
    status: text('status').notNull().default('active').$type<'active' | 'scheduled_gc' | 'gc_in_progress' | 'gc_done'>(),

    // GC scheduling
    scheduledGcAt: timestamp('scheduled_gc_at', { withTimezone: true }),
    gcStartedAt: timestamp('gc_started_at', { withTimezone: true }),

    // Admin debug-retention extension (spec §3.15 item 4)
    debugRetentionExtendedBy: uuid('debug_retention_extended_by').references(() => users.id),
    debugRetentionExtendedAt: timestamp('debug_retention_extended_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // UNIQUE: at most one profile per (task, attempt)
    taskAttemptUniqueIdx: uniqueIndex('operator_task_profiles_task_attempt_unique_idx')
      .on(table.taskId, table.attemptNumber),
  }),
);

export type OperatorTaskProfile = typeof operatorTaskProfiles.$inferSelect;
export type NewOperatorTaskProfile = typeof operatorTaskProfiles.$inferInsert;
