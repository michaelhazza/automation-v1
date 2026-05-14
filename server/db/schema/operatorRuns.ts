import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { users } from './users';

// ---------------------------------------------------------------------------
// operator_runs — chain-link rows for the operator_managed execution backend
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.3
//
// One row per chain link. A single agent_run spans 1..N chain links.
// Parallel to iee_runs; the operator_managed adapter uses this as its
// terminalStateTable.
//
// RLS: dual-GUC scoping on both organisation_id AND subaccount_id.
// Migration: 0335_create_operator_runs.sql
// ---------------------------------------------------------------------------

export const operatorRuns = pgTable(
  'operator_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Parent task
    agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),

    // Tenant scoping (dual-GUC RLS)
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),

    // Chain-link position
    chainSeq: integer('chain_seq').notNull(),
    parentChainLinkId: uuid('parent_chain_link_id'),

    // Attempt tracking (fresh-profile restart semantics — spec §3.15 item 7)
    attemptNumber: integer('attempt_number').notNull().default(1),
    supersededByAttempt: integer('superseded_by_attempt'),

    // Sandbox image pinning (spec §3.5)
    imageTag: text('image_tag').notNull(),

    // Vendor session identifier (opaque; surfaced in Run Trace and incidents)
    vendorSessionId: text('vendor_session_id'),

    // Credential mode — IMMUTABLE start mode (cost attribution source of truth)
    credentialStartMode: text('credential_start_mode').notNull().$type<'operator_session' | 'api_key'>(),

    // Credential mode — MUTABLE current mode (flipped on mid-run fallback)
    credentialMode: text('credential_mode').notNull().$type<'operator_session' | 'api_key'>(),

    // Chain-link lifecycle
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed' | 'cancelled'>(),
    failureReason: text('failure_reason'),

    // Sub-flag: hard-cap unresumable without reaching a checkpoint-safe state
    failedMidStep: boolean('failed_mid_step').notNull().default(false),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Finaliser idempotency stamp (set after operator-session-completed event emitted)
    eventEmittedAt: timestamp('event_emitted_at', { withTimezone: true }),

    // Cost mirrors (ledger is source of truth; these are cheap-read denormalisations)
    costSubscriptionMediatedCents: integer('cost_subscription_mediated_cents').notNull().default(0),
    costSandboxComputeCents: integer('cost_sandbox_compute_cents').notNull().default(0),

    // Progress tracking
    stepCount: integer('step_count').notNull().default(0),
    lastProgressAt: timestamp('last_progress_at', { withTimezone: true }),

    // Settings snapshot: effective caps captured at dispatch time (spec §3.3)
    settingsSnapshot: jsonb('settings_snapshot').notNull().$type<{
      session_soft_cap_minutes: number;
      auto_extend_grace_minutes: number;
      max_chain_length: number;
      max_wall_clock_per_task_days: number;
      per_task_budget_cap_minutes: number;
      concurrent_operator_sessions_cap: number;
    }>(),

    // Cancellation (spec §3.10)
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelRequestedByUserId: uuid('cancel_requested_by_user_id').references(() => users.id),

    // Checkpoint payload (encrypted-at-rest; spec §3.14 item 10, §4.6)
    checkpointPayload: jsonb('checkpoint_payload'),

    // Persistent browser profile pointer (spec §3.15)
    profileVolumeId: text('profile_volume_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // UNIQUE: at most one chain link per (task, attempt, seq)
    taskAttemptSeqUniqueIdx: uniqueIndex('operator_runs_task_attempt_seq_unique_idx')
      .on(table.agentRunId, table.attemptNumber, table.chainSeq),

    // Common dashboard query
    orgSubaccountStatusIdx: index('operator_runs_org_subaccount_status_idx')
      .on(table.organisationId, table.subaccountId, table.status),

    // Heartbeat-stale reconcile scan (partial: only running rows)
    runningProgressIdx: index('operator_runs_running_progress_idx')
      .on(table.status, table.lastProgressAt)
      .where(sql`${table.status} = 'running'`),
  }),
);

export type OperatorRun = typeof operatorRuns.$inferSelect;
export type NewOperatorRun = typeof operatorRuns.$inferInsert;
