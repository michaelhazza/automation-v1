// Delegation Outcomes — per-run delegation decision log.
// Spec: tasks/builds/paperclip-hierarchy/plan.md §5.4.
// Types imported from shared/types/delegation.ts (TypeScript-first contract).
//
// V2 (migration 0347) adds three columns for the cross-owner sub-step state
// machine (spec §9.7):
//   - crossOwnerApprovalTimeoutPolicy — policy applied when cross-owner approval
//     times out; NULL for non-cross-owner delegations.
//   - substepStatus — canonical sub-step lifecycle value (ten-state closed set;
//     terminal subset: 'success' | 'partial' | 'failed').
//   - terminalAt — set to NOW() on the first terminal transition; used by the
//     write-time predicate UPDATE ... WHERE id = $1 AND terminal_at IS NULL to
//     enforce the "exactly one terminal event per substep" guarantee (§9.4).
//
// Partial index enforced by migration 0347 (Drizzle does not natively support
// WHERE-clause partial indexes via the TypeScript schema API):
//   CREATE INDEX delegation_outcomes_open_substeps_idx
//     ON delegation_outcomes (run_id, substep_status)
//     WHERE terminal_at IS NULL;

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import type { DelegationScope, DelegationDirection } from '../../../shared/types/delegation.js';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';
import { agentRuns } from './agentRuns.js';
import { subaccountAgents } from './subaccountAgents.js';

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const delegationOutcomes = pgTable(
  'delegation_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    callerAgentId: uuid('caller_agent_id')
      .notNull()
      .references(() => subaccountAgents.id, { onDelete: 'cascade' }),
    targetAgentId: uuid('target_agent_id')
      .notNull()
      .references(() => subaccountAgents.id, { onDelete: 'cascade' }),
    delegationScope: text('delegation_scope').notNull().$type<DelegationScope>(),
    outcome: text('outcome').notNull().$type<'accepted' | 'rejected'>(),
    /** Required when outcome = 'rejected', null when outcome = 'accepted'. */
    reason: text('reason'),
    delegationDirection: text('delegation_direction').notNull().$type<DelegationDirection>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // ── Cross-owner state machine (migration 0347, spec §9.7) ─────────────────
    // Timeout policy applied when a cross-owner approval window expires.
    // NULL = not a cross-owner delegation.
    crossOwnerApprovalTimeoutPolicy: text('cross_owner_approval_timeout_policy')
      .$type<'fail_parent' | 'continue_without_substep' | 'ask_initiator'>(),

    // Sub-step lifecycle status (closed ten-state set per spec §9.7).
    // Terminal subset: 'success' | 'partial' | 'failed'.
    // Adding a new value requires a spec amendment.
    substepStatus: text('substep_status')
      .notNull()
      .default('proposed')
      .$type<
        | 'proposed'
        | 'authorised'
        | 'routed'
        | 'executing'
        | 'awaiting_cross_owner_approval'
        | 'approved'
        | 'rejected'
        | 'success'
        | 'partial'
        | 'failed'
      >(),

    // Set to NOW() on first terminal transition; NULL while in-flight.
    // Enforces: UPDATE ... WHERE id = $1 AND terminal_at IS NULL (§9.4).
    // Partial index on (run_id, substep_status) WHERE terminal_at IS NULL
    // is enforced by migration 0347 (not expressible in Drizzle WHERE API).
    terminalAt: timestamp('terminal_at', { withTimezone: true }),

    // Updated every time substep_status changes (migration 0349 + 0350 trigger).
    // Used by crossOwnerApprovalTimeoutSweep to detect rows that have been in
    // 'awaiting_cross_owner_approval' for more than the timeout window;
    // filtering on created_at would mis-fire on long-lived rows that only
    // recently transitioned to awaiting state.
    //
    // A BEFORE UPDATE trigger gated on substep_status IS DISTINCT FROM bumps
    // this column automatically — direct .set({ substepStatusUpdatedAt: ... })
    // is redundant but harmless. No-op status updates do NOT touch the column.
    substepStatusUpdatedAt: timestamp('substep_status_updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),

    // Migration 0350. Set to NOW() right after the awaiting_initiator_decision
    // event is appended to agent_execution_events. NULL until the event lands.
    // Independent from proposeAction's idempotency: handles the case where the
    // action insert succeeds but appendEvent later fails — re-sweeps detect the
    // missing event via this column and retry.
    awaitingInitiatorEventEmittedAt: timestamp('awaiting_initiator_event_emitted_at', {
      withTimezone: true,
    }),

    // Migration 0351 — claim+emit audit columns for cross-owner timeout events.
    // Pattern (per Round 3 chatgpt-pr-review F10/F11): atomic claim before
    // appendEvent, then UPDATE emitted_at after success. Stale-claim threshold
    // (5 min) releases the claim for retry if a sweep crashes mid-emit.
    //
    // terminal_event_*: gates fail_parent / continue_without_substep terminal
    //   cross_owner_substep.completed event emission (F10).
    // awaiting_initiator_event_claim_at: pairs with awaiting_initiator_event_emitted_at
    //   (added in 0350) to atomically claim awaiting_initiator_decision emission (F11).
    terminalEventClaimAt: timestamp('terminal_event_claim_at', { withTimezone: true }),
    terminalEventEmittedAt: timestamp('terminal_event_emitted_at', { withTimezone: true }),
    awaitingInitiatorEventClaimAt: timestamp('awaiting_initiator_event_claim_at', {
      withTimezone: true,
    }),
  },
  (table) => ({
    orgCreatedIdx: index('delegation_outcomes_org_created_idx').on(
      table.organisationId,
      table.createdAt,
    ),
    callerCreatedIdx: index('delegation_outcomes_caller_created_idx').on(
      table.callerAgentId,
      table.createdAt,
    ),
    runIdx: index('delegation_outcomes_run_idx').on(table.runId),
  })
);

export type DelegationOutcomeRow = typeof delegationOutcomes.$inferSelect;
export type NewDelegationOutcomeRow = typeof delegationOutcomes.$inferInsert;
