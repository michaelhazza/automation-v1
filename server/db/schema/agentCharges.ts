import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { spendingBudgets } from './spendingBudgets';
import { spendingPolicies } from './spendingPolicies';

// ---------------------------------------------------------------------------
// agent_charges — Spend Ledger (append-only)
//
// Every money-movement attempt, regardless of outcome. System source of truth
// for agent intent and audit trail. Stripe is the financial source of truth
// for payment state.
//
// Append-only enforcement is handled by BEFORE UPDATE / BEFORE DELETE triggers
// (0271_agentic_commerce_schema.sql). Do not update immutable columns; only
// the mutable-on-transition allowlist defined in spec §5.1 may be written.
//
// Status, mode, kind, and last_transition_by are Postgres ENUM columns at the
// DB layer (invariant 30). TypeScript types here mirror the closed sets.
//
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export type AgentChargeStatus =
  | 'proposed'
  | 'pending_approval'
  | 'approved'
  | 'executed'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'denied'
  | 'disputed'
  | 'shadow_settled'
  | 'refunded';

export type AgentChargeMode = 'shadow' | 'live';

export type AgentChargeKind = 'outbound_charge' | 'inbound_refund';

export type AgentChargeTransitionCaller =
  | 'charge_router'
  | 'stripe_webhook'
  | 'timeout_job'
  | 'worker_completion'
  | 'approval_expiry_job'
  | 'retention_purge';

export const agentCharges = pgTable(
  'agent_charges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    spendingBudgetId: uuid('spending_budget_id')
      .notNull()
      .references(() => spendingBudgets.id),
    spendingPolicyId: uuid('spending_policy_id')
      .notNull()
      .references(() => spendingPolicies.id),
    // Snapshot of policy version at charge time (audit-only).
    policyVersion: integer('policy_version').notNull(),
    // Initiating agent (nullable for direct-call retries).
    agentId: uuid('agent_id'),
    // The agent run that initiated this charge.
    skillRunId: uuid('skill_run_id'),
    // The action row from the gate path (set when routing through HITL).
    actionId: uuid('action_id'),
    // Unique key preventing duplicate ledger inserts. Pattern per spec §8.1.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // Groups retries. All charges for the same logical operation share one intent_id.
    intentId: uuid('intent_id').notNull(),
    // Human-readable description of the spend.
    intent: text('intent').notNull(),
    // 'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund'
    chargeType: text('charge_type').notNull(),
    // Direction of balance impact. 'outbound' or 'inbound_refund'.
    direction: text('direction').notNull(),
    // Always positive. DB CHECK amount_minor > 0 enforced in migration.
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    // ISO 4217 currency code.
    currency: text('currency').notNull(),
    // Stripe merchant ID where available.
    merchantId: text('merchant_id'),
    // Normalised string fallback for merchant identification.
    merchantDescriptor: text('merchant_descriptor'),
    // Closed ENUM at DB layer. See agent_charge_status type in migration.
    status: text('status').notNull().$type<AgentChargeStatus>(),
    // Closed ENUM at DB layer. See agent_charge_mode type in migration.
    mode: text('mode').notNull().$type<AgentChargeMode>(),
    // Closed ENUM at DB layer. Distinguishes refund rows (invariant 41).
    kind: text('kind').notNull().default('outbound_charge').$type<AgentChargeKind>(),
    // Stripe charge/payment-intent ID; populated after executed.
    providerChargeId: text('provider_charge_id'),
    // The SPT connection used for this charge.
    sptConnectionId: uuid('spt_connection_id'),
    // Policy evaluation trace: allowlist result, limit check, threshold compare, mode.
    decisionPath: jsonb('decision_path').notNull().default({}).$type<Record<string, unknown>>(),
    // For terminal failed/blocked/denied states.
    failureReason: text('failure_reason'),
    // For refunds: points to the original outbound charge.
    parentChargeId: uuid('parent_charge_id'),
    // For retries after SPT expiry.
    replayOfChargeId: uuid('replay_of_charge_id'),
    // 'workflow' | 'manual' | 'scheduled' | 'retry' — reserved, not required for v1.
    provenance: text('provenance'),
    // Execution window deadline; auto-fail if exceeded.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Approval expiry; auto-deny if exceeded (scoped to pending_approval rows only).
    approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    // Closed ENUM at DB layer. Actor that drove the most recent status transition.
    lastTransitionBy: text('last_transition_by')
      .notNull()
      .default('charge_router')
      .$type<AgentChargeTransitionCaller>(),
    // Stripe event id (webhook-driven) or pg-boss job id (job-driven). NULL for charge_router.
    lastTransitionEventId: text('last_transition_event_id'),
    // NULL on insert; used by agentSpendAggregateService for invariant 27 idempotency.
    lastAggregatedState: text('last_aggregated_state').$type<AgentChargeStatus>(),
    // Free-form metadata bucket.
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('agent_charges_org_idx').on(table.organisationId),
    subaccountIdx: index('agent_charges_subaccount_idx')
      .on(table.subaccountId, table.organisationId),
    budgetIdx: index('agent_charges_budget_idx').on(table.spendingBudgetId),
    statusIdx: index('agent_charges_status_idx').on(table.status, table.organisationId),
    intentIdx: index('agent_charges_intent_idx').on(table.intentId),
    // Supports execution-window timeout job scan.
    approvedExpiresIdx: index('agent_charges_approved_expires_idx')
      .on(table.status, table.expiresAt),
    // Supports approval-expiry job scan.
    pendingApprovalExpiresIdx: index('agent_charges_pending_approval_expires_idx')
      .on(table.status, table.approvalExpiresAt),
  }),
);

export type AgentCharge = typeof agentCharges.$inferSelect;
export type NewAgentCharge = typeof agentCharges.$inferInsert;
