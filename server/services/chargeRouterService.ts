// ---------------------------------------------------------------------------
// chargeRouterService — impure charge router (propose → gate → execute)
//
// Single entry point for all money movement. Owns DB writes, Stripe calls,
// advisory locks, HITL enqueue, idempotency, execute-time kill-switch
// re-check, and agent_execution_events cross-reference emit.
//
// Pure decisions (policy evaluation, key building, error classification) live
// in chargeRouterServicePure.ts. This file does NOT export pure decisions.
//
// Spec:  tasks/builds/agentic-commerce/spec.md §7.4, §8.1-8.4a, §13.2, §15
// Plan:  tasks/builds/agentic-commerce/plan.md § Chunk 5
// Invariants enforced: 1, 2, 4, 7, 9, 10, 11, 12, 22, 24-26, 31, 34-36, 38
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentCharges } from '../db/schema/agentCharges.js';
import { spendingBudgets } from '../db/schema/spendingBudgets.js';
import { spendingPolicies } from '../db/schema/spendingPolicies.js';
import { costAggregates } from '../db/schema/costAggregates.js';
import {
  evaluatePolicy,
  validateAmountForCurrency,
  classifyStripeError,
  previewSpendForPlan,
  type ChargeRouterRequest,
  type EvaluatePolicyInput,
  type SpendingPolicy as PureSpendingPolicy,
  type ParsedPlan,
} from './chargeRouterServicePure.js';
import { sptVaultService } from './sptVaultService.js';
import { actionService } from './actionService.js';
import { logChargeTransition, withTrace } from '../lib/spendLogging.js';
import { withBackoff } from '../lib/withBackoff.js';
import {
  type AgentChargeStatus,
  type AgentChargeTransitionCaller,
} from '../../shared/stateMachineGuards.js';
import { appendEvent } from './agentExecutionEventService.js';
import { EXECUTION_TIMEOUT_MINUTES } from '../config/spendConstants.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Response types (spec §8.2)
// ---------------------------------------------------------------------------

export type ChargeRouterResponse =
  | { outcome: 'executed'; chargeId: string; providerChargeId: string | null; executionPath: 'main_app_stripe' | 'worker_hosted_form'; chargeToken?: string; sptExpiresAt?: string | null }
  | { outcome: 'shadow_settled'; chargeId: string }
  | { outcome: 'pending_approval'; chargeId: string; actionId: string }
  | { outcome: 'blocked'; chargeId: string | null; reason: string }
  | { outcome: 'failed'; chargeId: string; reason: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Hash a UUID to a stable bigint for pg_advisory_xact_lock.
 * Uses the first 16 hex chars (64 bits) of the UUID.
 */
function uuidToBigint(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 16);
  // Use signed 64-bit range — Postgres advisory lock uses int8.
  // Parse as unsigned, then re-interpret in signed range.
  const val = BigInt(`0x${hex}`);
  const MAX_INT8 = BigInt('9223372036854775807');
  if (val > MAX_INT8) {
    return String(val - BigInt('18446744073709551616'));
  }
  return String(val);
}

/** Map DB spending_policies row to the pure type */
function dbPolicyToPure(
  row: typeof spendingPolicies.$inferSelect,
): PureSpendingPolicy {
  return {
    id: row.id,
    spendingBudgetId: row.spendingBudgetId,
    mode: row.mode as 'shadow' | 'live',
    perTxnLimitMinor: row.perTxnLimitMinor,
    dailyLimitMinor: row.dailyLimitMinor,
    monthlyLimitMinor: row.monthlyLimitMinor,
    approvalThresholdMinor: row.approvalThresholdMinor,
    merchantAllowlist: row.merchantAllowlist as PureSpendingPolicy['merchantAllowlist'],
    approvalExpiresHours: row.approvalExpiresHours,
    version: row.version,
    velocityConfig: null,
    confidenceGateConfig: null,
  };
}

/** Execute a DB status update with optimistic compare-and-set */
async function updateChargeStatus(
  chargeId: string,
  expectedStatus: AgentChargeStatus,
  newStatus: AgentChargeStatus,
  fields: Partial<{
    failureReason: string | null;
    providerChargeId: string | null;
    approvedAt: Date;
    executedAt: Date;
    settledAt: Date;
    approvalExpiresAt: Date;
    expiresAt: Date;
    decisionPath: Record<string, unknown>;
    lastTransitionBy: AgentChargeTransitionCaller;
    actionId: string;
  }>,
  caller: AgentChargeTransitionCaller,
): Promise<boolean> {
  const setFields: Record<string, unknown> = {
    status: newStatus,
    lastTransitionBy: caller,
    updatedAt: new Date(),
  };

  if (fields.failureReason !== undefined) setFields['failureReason'] = fields.failureReason;
  if (fields.providerChargeId !== undefined) setFields['providerChargeId'] = fields.providerChargeId;
  if (fields.approvedAt !== undefined) setFields['approvedAt'] = fields.approvedAt;
  if (fields.executedAt !== undefined) setFields['executedAt'] = fields.executedAt;
  if (fields.settledAt !== undefined) setFields['settledAt'] = fields.settledAt;
  if (fields.approvalExpiresAt !== undefined) setFields['approvalExpiresAt'] = fields.approvalExpiresAt;
  if (fields.expiresAt !== undefined) setFields['expiresAt'] = fields.expiresAt;
  if (fields.decisionPath !== undefined) setFields['decisionPath'] = fields.decisionPath;
  if (fields.actionId !== undefined) setFields['actionId'] = fields.actionId;

  const tx = getOrgScopedDb('chargeRouterService.updateChargeStatus');
  // Set the trigger-only GUC documented in migration 0271 header so the
  // agent_charges_validate_update trigger sees the same caller identity that
  // we record in last_transition_by. Required for the failed → succeeded
  // carve-out and is the canonical convention the migration documents — see
  // DG#3 in spec-conformance-log-agentic-commerce-2026-05-03T14-12-21Z.md.
  // set_config(name, value, is_local) — is_local=true matches SET LOCAL.
  await tx.execute(sql`SELECT set_config('app.spend_caller', ${caller}, true)`);
  const result = await tx
    .update(agentCharges)
    .set(setFields)
    .where(and(
      eq(agentCharges.id, chargeId),
      eq(agentCharges.status, expectedStatus),
    ))
    .returning({ id: agentCharges.id });

  return result.length > 0;
}

/** Emit agent_execution_events cross-reference (invariant — one per attempt) */
async function emitSpendLedgerEvent(
  chargeId: string,
  runId: string | null,
  organisationId: string,
  subaccountId: string | null,
): Promise<void> {
  if (!runId) return;
  try {
    await appendEvent({
      runId,
      organisationId,
      subaccountId,
      payload: {
        eventType: 'skill.invoked',
        critical: false,
        skillSlug: 'charge_router',
        skillRunId: chargeId,
        agentId: null,
      } as unknown as import('../../shared/types/agentExecutionLog.js').AgentExecutionEventPayload,
      sourceService: 'skillExecutor',
      linkedEntity: { type: 'spend_ledger', id: chargeId },
    });
  } catch (err) {
    logger.warn('chargeRouterService.event_emit_failed', {
      chargeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// proposeCharge — main entry point (invariant 2)
// ---------------------------------------------------------------------------

export async function proposeCharge(
  input: ChargeRouterRequest & {
    spendingBudgetId: string;
    spendingPolicyId: string;
    executionPath: 'main_app_stripe' | 'worker_hosted_form';
    agentRunId: string | null;
    idempotencyKey: string;
    intentId: string;
    traceId: string;
  },
): Promise<ChargeRouterResponse> {
  return withTrace(input.traceId, async () => {
    // Step 1: INSERT agent_charges (status='proposed') with idempotency.
    // ON CONFLICT DO UPDATE SET updated_at preserves the row; is_new distinguishes.
    const tx = getOrgScopedDb('chargeRouterService.proposeCharge');
    const [chargeRow] = await tx
      .insert(agentCharges)
      .values({
        id: randomUUID(),
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        spendingBudgetId: input.spendingBudgetId,
        spendingPolicyId: input.spendingPolicyId,
        policyVersion: 0, // updated inside lock after policy read
        agentId: input.agentId,
        skillRunId: input.skillRunId ?? (input.agentRunId ?? null),
        actionId: null,
        idempotencyKey: input.idempotencyKey,
        intentId: input.intentId,
        intent: input.intent,
        chargeType: input.chargeType,
        direction: input.parentChargeId ? 'inbound_refund' : 'outbound',
        amountMinor: input.amountMinor,
        currency: input.currency,
        merchantId: input.merchant.id,
        merchantDescriptor: input.merchant.descriptor,
        status: 'proposed' as AgentChargeStatus,
        mode: 'live', // resolved inside lock; updated below
        kind: input.parentChargeId ? 'inbound_refund' : 'outbound_charge',
        parentChargeId: input.parentChargeId,
        decisionPath: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentCharges.idempotencyKey,
        set: { updatedAt: new Date() },
      })
      .returning();

    if (!chargeRow) {
      return { outcome: 'blocked', chargeId: null, reason: 'insert_failed' };
    }

    const chargeId = chargeRow.id;
    // isNew detection: a freshly-inserted row is in `proposed` status with an
    // empty decisionPath. The gate writes a non-empty decisionPath atomically
    // with the status transition, so a row that survives this check has not yet
    // been gated. Concurrent callers hitting the same idempotency key are
    // serialised by the unique constraint on idempotency_key (one wins the
    // INSERT, others get the existing row via onConflictDoUpdate). The advisory
    // lock in runPolicyGate + the optimistic UPDATE predicate
    // (`status = 'proposed'`) catch the residual race where two callers both
    // see `isNew = true` — the second one's UPDATE updates zero rows and falls
    // through to resolveExistingOutcome on a subsequent retry.
    const isNew = chargeRow.status === 'proposed' && chargeRow.decisionPath && Object.keys(chargeRow.decisionPath as object).length === 0;

    if (!isNew) {
      return resolveExistingOutcome(chargeRow);
    }

    // Step 2-4: Advisory lock + capacity read + policy evaluation + UPDATE.
    const gateResult = await runPolicyGate(chargeId, input);

    if (gateResult.outcome === 'blocked') {
      await emitSpendLedgerEvent(chargeId, input.agentRunId, input.organisationId, input.subaccountId);
      return { outcome: 'blocked', chargeId, reason: gateResult.failureReason ?? 'policy_blocked' };
    }

    if (gateResult.outcome === 'pending_approval') {
      await emitSpendLedgerEvent(chargeId, input.agentRunId, input.organisationId, input.subaccountId);
      return {
        outcome: 'pending_approval',
        chargeId,
        actionId: gateResult.actionId!,
      };
    }

    if (gateResult.mode === 'shadow') {
      // Shadow auto-approved — transition directly to shadow_settled.
      const updated = await updateChargeStatus(
        chargeId,
        'approved',
        'shadow_settled',
        { settledAt: new Date() },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'shadow_settled', reason: 'shadow_auto', caller: 'charge_router' });
      }
      await emitSpendLedgerEvent(chargeId, input.agentRunId, input.organisationId, input.subaccountId);
      return { outcome: 'shadow_settled', chargeId };
    }

    // Live approved — execute.
    const execResult = await executeApproved(chargeId, {
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      agentRunId: input.agentRunId,
      executionPath: input.executionPath,
      traceId: input.traceId,
    });
    await emitSpendLedgerEvent(chargeId, input.agentRunId, input.organisationId, input.subaccountId);
    return execResult;
  });
}

// ---------------------------------------------------------------------------
// runPolicyGate — steps 2-4: lock → aggregate → evaluate → UPDATE
// ---------------------------------------------------------------------------

async function runPolicyGate(
  chargeId: string,
  input: ChargeRouterRequest & {
    spendingBudgetId: string;
    spendingPolicyId: string;
    executionPath: 'main_app_stripe' | 'worker_hosted_form';
    agentRunId: string | null;
    idempotencyKey: string;
    intentId: string;
    traceId: string;
  },
): Promise<{
  outcome: 'approved' | 'pending_approval' | 'blocked';
  mode?: 'shadow' | 'live';
  failureReason?: string | null;
  actionId?: string;
}> {
  const tx = getOrgScopedDb('chargeRouterService.runPolicyGate');
  // Acquire transactional advisory lock on the spending budget. Invariant 25:
  // capacity reads MUST occur inside this same lock scope.
  const lockId = uuidToBigint(input.spendingBudgetId);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(lockId)})`);
  await tx.execute(sql`SET LOCAL app.spend_caller = 'charge_router'`);

  // Read budget + policy.
    const [budget] = await tx
      .select()
      .from(spendingBudgets)
      .where(and(
        eq(spendingBudgets.id, input.spendingBudgetId),
        eq(spendingBudgets.organisationId, input.organisationId),
      ))
      .limit(1);

    if (!budget) {
      await tx
        .update(agentCharges)
        .set({ status: 'blocked', failureReason: 'budget_not_found', lastTransitionBy: 'charge_router', updatedAt: new Date() })
        .where(and(eq(agentCharges.id, chargeId), eq(agentCharges.status, 'proposed')));
      logChargeTransition({ chargeId, from: 'proposed', to: 'blocked', reason: 'budget_not_found', caller: 'charge_router' });
      return { outcome: 'blocked', failureReason: 'budget_not_found' };
    }

    const [policy] = await tx
      .select()
      .from(spendingPolicies)
      .where(and(
        eq(spendingPolicies.id, input.spendingPolicyId),
        eq(spendingPolicies.organisationId, input.organisationId),
      ))
      .limit(1);

    if (!policy) {
      await tx
        .update(agentCharges)
        .set({ status: 'blocked', failureReason: 'policy_not_found', lastTransitionBy: 'charge_router', updatedAt: new Date() })
        .where(and(eq(agentCharges.id, chargeId), eq(agentCharges.status, 'proposed')));
      logChargeTransition({ chargeId, from: 'proposed', to: 'blocked', reason: 'policy_not_found', caller: 'charge_router' });
      return { outcome: 'blocked', failureReason: 'policy_not_found' };
    }

    // Read SPT status (outside Stripe — just the DB row status).
    let sptStatus: 'active' | 'expired' | 'revoked' | 'unavailable' = 'unavailable';
    if (input.subaccountId) {
      try {
        const spt = await sptVaultService.getActiveSpt(input.subaccountId, input.organisationId);
        sptStatus = spt ? 'active' : 'unavailable';
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'spt_revoked') sptStatus = 'revoked';
        else if (e.code === 'spt_unavailable') sptStatus = 'unavailable';
        else sptStatus = 'unavailable';
      }
    }

    // Read settled + reserved capacity INSIDE the lock (invariant 25).
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Settled net: terminal rows (succeeded, executed) in this window.
    const [dailySettled] = await tx.execute(sql`
      SELECT COALESCE(SUM(amount_minor), 0) AS total
      FROM agent_charges
      WHERE spending_budget_id = ${input.spendingBudgetId}
        AND status IN ('executed', 'succeeded')
        AND direction = 'outbound'
        AND created_at >= ${dayStart.toISOString()}::timestamptz
    `) as unknown as Array<{ total: string }>;

    const [monthlySettled] = await tx.execute(sql`
      SELECT COALESCE(SUM(amount_minor), 0) AS total
      FROM agent_charges
      WHERE spending_budget_id = ${input.spendingBudgetId}
        AND status IN ('executed', 'succeeded')
        AND direction = 'outbound'
        AND created_at >= ${monthStart.toISOString()}::timestamptz
    `) as unknown as Array<{ total: string }>;

    // Reserved capacity: non-terminal in-flight rows (pending_approval, approved).
    const [dailyReserved] = await tx.execute(sql`
      SELECT COALESCE(SUM(amount_minor), 0) AS total
      FROM agent_charges
      WHERE spending_budget_id = ${input.spendingBudgetId}
        AND status IN ('proposed', 'pending_approval', 'approved')
        AND direction = 'outbound'
        AND created_at >= ${dayStart.toISOString()}::timestamptz
        AND id != ${chargeId}::uuid
    `) as unknown as Array<{ total: string }>;

    const [monthlyReserved] = await tx.execute(sql`
      SELECT COALESCE(SUM(amount_minor), 0) AS total
      FROM agent_charges
      WHERE spending_budget_id = ${input.spendingBudgetId}
        AND status IN ('proposed', 'pending_approval', 'approved')
        AND direction = 'outbound'
        AND created_at >= ${monthStart.toISOString()}::timestamptz
        AND id != ${chargeId}::uuid
    `) as unknown as Array<{ total: string }>;

    const settledNet = {
      dailyMinor: Number((dailySettled as { total: string }).total ?? 0),
      monthlyMinor: Number((monthlySettled as { total: string }).total ?? 0),
    };
    const reservedCapacity = {
      dailyMinor: Number((dailyReserved as { total: string }).total ?? 0),
      monthlyMinor: Number((monthlyReserved as { total: string }).total ?? 0),
    };

    // Kill-switch active = budget.disabledAt is set.
    const killSwitchActive = budget.disabledAt !== null;

    const policyPure = dbPolicyToPure(policy);

    const evalInput: EvaluatePolicyInput = {
      policy: policyPure,
      budget: { currency: budget.currency, disabledAt: budget.disabledAt },
      request: input,
      killSwitchActive,
      sptStatus,
      reservedCapacity,
      settledNet,
    };

    const evalResult = evaluatePolicy(evalInput);

    // UPDATE agent_charges inside lock scope, before COMMIT.
    if (evalResult.outcome === 'blocked') {
      await tx
        .update(agentCharges)
        .set({
          status: 'blocked',
          failureReason: evalResult.failureReason,
          decisionPath: evalResult.decisionPath as unknown as Record<string, unknown>,
          policyVersion: policy.version,
          mode: policy.mode,
          lastTransitionBy: 'charge_router',
          updatedAt: new Date(),
        })
        .where(and(eq(agentCharges.id, chargeId), eq(agentCharges.status, 'proposed')));

      logChargeTransition({
        chargeId,
        from: 'proposed',
        to: 'blocked',
        reason: evalResult.failureReason ?? 'blocked',
        caller: 'charge_router',
      });

      return { outcome: 'blocked', failureReason: evalResult.failureReason };
    }

    const nowForExpiry = new Date();

    if (evalResult.outcome === 'pending_approval') {
      const approvalExpiresAt = new Date(
        nowForExpiry.getTime() + policy.approvalExpiresHours * 60 * 60 * 1000,
      );

      await tx
        .update(agentCharges)
        .set({
          status: 'pending_approval',
          decisionPath: evalResult.decisionPath as unknown as Record<string, unknown>,
          approvalExpiresAt,
          policyVersion: policy.version,
          mode: policy.mode,
          lastTransitionBy: 'charge_router',
          updatedAt: new Date(),
        })
        .where(and(eq(agentCharges.id, chargeId), eq(agentCharges.status, 'proposed')));

      logChargeTransition({
        chargeId,
        from: 'proposed',
        to: 'pending_approval',
        reason: 'threshold_exceeded',
        caller: 'charge_router',
      });

      // Enqueue HITL action.
      const actionResult = await actionService.proposeAction({
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        agentId: input.agentId ?? null, // null when no agent context (system flow)
        agentRunId: input.agentRunId ?? undefined,
        actionType: input.chargeType,
        idempotencyKey: input.idempotencyKey,
        payload: { chargeId, amountMinor: input.amountMinor, currency: input.currency, merchant: input.merchant },
        metadata: { category: 'spend', actionType: input.chargeType, chargeId, ledgerRowId: chargeId },
      });

      // Link actionId on the charge row.
      await tx
        .update(agentCharges)
        .set({ actionId: actionResult.actionId, updatedAt: new Date() })
        .where(eq(agentCharges.id, chargeId));

      return { outcome: 'pending_approval', actionId: actionResult.actionId };
    }

    // Auto-approved. Set expires_at for execution window (invariant 11).
    const expiresAt = new Date(
      nowForExpiry.getTime() + EXECUTION_TIMEOUT_MINUTES * 60 * 1000,
    );

    await tx
      .update(agentCharges)
      .set({
        status: 'approved',
        approvedAt: nowForExpiry,
        expiresAt,
        decisionPath: evalResult.decisionPath as unknown as Record<string, unknown>,
        policyVersion: policy.version,
        mode: policy.mode,
        lastTransitionBy: 'charge_router',
        updatedAt: new Date(),
      })
      .where(and(eq(agentCharges.id, chargeId), eq(agentCharges.status, 'proposed')));

    logChargeTransition({
      chargeId,
      from: 'proposed',
      to: 'approved',
      reason: 'auto_approved',
      caller: 'charge_router',
    });

    return { outcome: 'approved', mode: policy.mode as 'shadow' | 'live' };
}

// ---------------------------------------------------------------------------
// executeApproved — runs OUTSIDE any advisory-lock-held tx (invariant 35)
// ---------------------------------------------------------------------------

export async function executeApproved(
  chargeId: string,
  context: {
    organisationId: string;
    subaccountId: string | null;
    agentRunId: string | null;
    executionPath: 'main_app_stripe' | 'worker_hosted_form';
    traceId: string;
  },
): Promise<ChargeRouterResponse> {
  return withTrace(context.traceId, async () => {
    const tx = getOrgScopedDb('chargeRouterService.executeApproved');
    // Re-read the charge row outside any lock.
    const [charge] = await tx
      .select()
      .from(agentCharges)
      .where(and(
        eq(agentCharges.id, chargeId),
        eq(agentCharges.organisationId, context.organisationId),
      ))
      .limit(1);

    if (!charge || charge.status !== 'approved') {
      return { outcome: 'blocked', chargeId, reason: 'not_approved' };
    }

    // Invariant 36: Re-check expires_at before Stripe call.
    const now = new Date();
    if (charge.expiresAt && now >= charge.expiresAt) {
      const updated = await updateChargeStatus(chargeId, 'approved', 'failed',
        { failureReason: 'execution_window_elapsed', settledAt: now },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'failed', reason: 'execution_window_elapsed', caller: 'charge_router' });
      }
      return { outcome: 'failed', chargeId, reason: 'execution_window_elapsed' };
    }

    // Invariant 7: Re-check kill switch (re-read budget) before Stripe call.
    const [budget] = await tx
      .select()
      .from(spendingBudgets)
      .where(and(
        eq(spendingBudgets.id, charge.spendingBudgetId),
        eq(spendingBudgets.organisationId, context.organisationId),
      ))
      .limit(1);

    if (!budget || budget.disabledAt !== null) {
      const updated = await updateChargeStatus(chargeId, 'approved', 'blocked',
        { failureReason: 'kill_switch_late' },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'blocked', reason: 'kill_switch_late', caller: 'charge_router' });
      }
      return { outcome: 'blocked', chargeId, reason: 'kill_switch_late' };
    }

    // Invariant 7: Re-check SPT status.
    let sptToken: string | null = null;
    let sptExpiresAt: Date | null = null;
    let sptConnectionId: string | null = null;

    if (context.subaccountId) {
      try {
        const spt = await sptVaultService.getActiveSpt(context.subaccountId, context.organisationId);
        sptToken = spt.token;
        sptExpiresAt = spt.expiresAt;
        sptConnectionId = spt.connectionId;
      } catch (err: unknown) {
        const e = err as { code?: string };
        const reason = e.code === 'spt_revoked' ? 'spt_revoked' : 'spt_unavailable';
        const updated = await updateChargeStatus(chargeId, 'approved', 'blocked',
          { failureReason: reason },
          'charge_router',
        );
        if (updated) {
          logChargeTransition({ chargeId, from: 'approved', to: 'blocked', reason, caller: 'charge_router' });
        }
        return { outcome: 'blocked', chargeId, reason };
      }
    }

    // Invariant 24 (outbound twin): validateAmountForCurrency before Stripe call.
    const amountValidation = validateAmountForCurrency(charge.amountMinor, charge.currency);
    if (!amountValidation.valid) {
      const updated = await updateChargeStatus(chargeId, 'approved', 'blocked',
        { failureReason: 'currency_amount_invalid' },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'blocked', reason: 'currency_amount_invalid', caller: 'charge_router' });
      }
      return { outcome: 'blocked', chargeId, reason: 'currency_amount_invalid' };
    }

    // Worker-hosted-form path: return SPT to worker, mark executed with NULL provider_charge_id.
    if (context.executionPath === 'worker_hosted_form') {
      const updated = await updateChargeStatus(chargeId, 'approved', 'executed',
        { executedAt: now, providerChargeId: null },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'executed', reason: 'worker_hosted_form', caller: 'charge_router' });
      }
      return {
        outcome: 'executed',
        chargeId,
        providerChargeId: null,
        executionPath: 'worker_hosted_form',
        chargeToken: sptToken ?? undefined,
        sptExpiresAt: sptExpiresAt ? sptExpiresAt.toISOString() : null,
      };
    }

    // Main-app-stripe path: call Stripe via withBackoff + classifyStripeError.
    const traceId = context.traceId;
    const metadata = { agent_charge_id: chargeId, mode: 'live' as const, traceId };

    let providerChargeId: string | null;
    let stripeError: unknown = null;
    let retried401 = false;

    const stripeResult = await withBackoff(
      async () => {
        const { chargeViaSpt } = await import('../adapters/stripeAdapter.js');
        const result = await chargeViaSpt({
          sptToken: sptToken!,
          idempotencyKey: charge.idempotencyKey,
          amountMinor: charge.amountMinor,
          currency: charge.currency,
          merchantId: charge.merchantId,
          merchantDescriptor: charge.merchantDescriptor ?? '',
          metadata,
        });
        return result;
      },
      {
        label: 'chargeRouterService.stripe_charge',
        maxAttempts: 3,
        correlationId: chargeId,
        runId: context.agentRunId ?? chargeId,
        isRetryable: (err: unknown) => {
          const cls = classifyStripeError(err);
          return cls === 'rate_limited_retry' || cls === 'server_retry';
        },
        onRetry: (attempt, err) => {
          const cls = classifyStripeError(err);
          if (cls === 'auth_refresh_retry' && !retried401 && sptConnectionId) {
            retried401 = true;
            sptVaultService.refreshIfExpired(sptConnectionId, { orgId: context.organisationId })
              .catch(() => {/* best effort */});
          }
          stripeError = err;
          logger.warn('chargeRouterService.stripe_retry', {
            chargeId,
            attempt,
            classification: cls,
          });
        },
      },
    ).catch((err: unknown) => {
      stripeError = err;
      return null;
    });

    if (stripeResult !== null) {
      providerChargeId = stripeResult.providerChargeId;
      const updated = await updateChargeStatus(chargeId, 'approved', 'executed',
        { providerChargeId, executedAt: now },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'executed', reason: 'stripe_success', caller: 'charge_router' });
      }
      return {
        outcome: 'executed',
        chargeId,
        providerChargeId,
        executionPath: 'main_app_stripe',
      };
    }

    // Stripe failed — classify and determine failure reason.
    const cls = classifyStripeError(stripeError);
    let failureReason: string;

    if (cls === 'auth_refresh_retry') {
      failureReason = 'spt_auth_failed';
    } else if (cls === 'fail_402') {
      failureReason = 'card_declined';
    } else if (cls === 'idempotency_conflict') {
      // Re-read by idempotency key — apply Stripe's reported outcome.
      // For now, treat as a successful prior call (idempotent).
      const updated = await updateChargeStatus(chargeId, 'approved', 'executed',
        { providerChargeId: null, executedAt: now },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'approved', to: 'executed', reason: 'idempotency_conflict_prior_success', caller: 'charge_router' });
      }
      return { outcome: 'executed', chargeId, providerChargeId: null, executionPath: 'main_app_stripe' };
    } else if (cls === 'rate_limited_retry') {
      failureReason = 'stripe_rate_limited';
    } else if (cls === 'server_retry') {
      failureReason = 'stripe_unavailable';
    } else {
      // fail_other_4xx — use stripe error code if available.
      const e = stripeError as { code?: string; statusCode?: number } | null;
      failureReason = e?.code ?? 'stripe_declined';
    }

    const updated = await updateChargeStatus(chargeId, 'approved', 'failed',
      { failureReason, settledAt: now },
      'charge_router',
    );
    if (updated) {
      logChargeTransition({ chargeId, from: 'approved', to: 'failed', reason: failureReason, caller: 'charge_router' });
    }
    return { outcome: 'failed', chargeId, reason: failureReason };
  });
}

// ---------------------------------------------------------------------------
// resolveApproval — SOLE writer for pending_approval → approved/denied
// (invariant 17 / spec §13.2)
// ---------------------------------------------------------------------------

export async function resolveApproval(
  actionId: string,
  decision: 'approved' | 'denied',
  context: {
    organisationId: string;
    responderId: string;
    traceId: string;
  },
): Promise<{ status: 'resolved' | 'superseded' }> {
  return withTrace(context.traceId, async () => {
    const tx = getOrgScopedDb('chargeRouterService.resolveApproval');
    // Find the charge linked to this action.
    const [charge] = await tx
      .select()
      .from(agentCharges)
      .where(and(
        eq(agentCharges.actionId, actionId),
        eq(agentCharges.organisationId, context.organisationId),
      ))
      .limit(1);

    if (!charge) {
      logger.warn('chargeRouterService.resolveApproval_no_charge', { actionId });
      return { status: 'superseded' };
    }

    if (charge.status !== 'pending_approval') {
      // Another responder already won the compare-and-set.
      return { status: 'superseded' };
    }

    const chargeId = charge.id;
    const now = new Date();

    if (decision === 'denied') {
      const updated = await updateChargeStatus(chargeId, 'pending_approval', 'denied',
        { settledAt: now },
        'charge_router',
      );
      if (!updated) return { status: 'superseded' };
      logChargeTransition({ chargeId, from: 'pending_approval', to: 'denied', reason: 'human_denied', caller: 'charge_router' });
      return { status: 'resolved' };
    }

    // Approved: re-read policy and revalidate (policy_changed guard).
    const [policy] = await tx
      .select()
      .from(spendingPolicies)
      .where(and(
        eq(spendingPolicies.id, charge.spendingPolicyId),
        eq(spendingPolicies.organisationId, context.organisationId),
      ))
      .limit(1);

    if (!policy) {
      const updated = await updateChargeStatus(chargeId, 'pending_approval', 'denied',
        { failureReason: 'policy_changed', settledAt: now },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'pending_approval', to: 'denied', reason: 'policy_changed', caller: 'charge_router' });
      }
      return { status: 'superseded' };
    }

    if (policy.version !== charge.policyVersion) {
      // Policy changed since proposal — auto-deny per spec §13.2.
      const updated = await updateChargeStatus(chargeId, 'pending_approval', 'denied',
        { failureReason: 'policy_changed', settledAt: now },
        'charge_router',
      );
      if (updated) {
        logChargeTransition({ chargeId, from: 'pending_approval', to: 'denied', reason: 'policy_changed', caller: 'charge_router' });
      }
      return { status: 'superseded' };
    }

    // Transition to approved with fresh expires_at (invariant 11).
    const expiresAt = new Date(now.getTime() + EXECUTION_TIMEOUT_MINUTES * 60 * 1000);
    const updated = await updateChargeStatus(chargeId, 'pending_approval', 'approved',
      { approvedAt: now, expiresAt },
      'charge_router',
    );

    if (!updated) return { status: 'superseded' };
    logChargeTransition({ chargeId, from: 'pending_approval', to: 'approved', reason: 'human_approved', caller: 'charge_router' });

    return { status: 'resolved' };
  });
}

// ---------------------------------------------------------------------------
// previewSpendAdvisory — planning-phase wrapper (fail-open, never blocks)
// ---------------------------------------------------------------------------

export function previewSpendAdvisory(
  plan: ParsedPlan,
  policy: PureSpendingPolicy,
): ReturnType<typeof previewSpendForPlan> {
  return previewSpendForPlan(plan, policy);
}

// ---------------------------------------------------------------------------
// resolveExistingOutcome — maps a pre-existing row to ChargeRouterResponse
// ---------------------------------------------------------------------------

function resolveExistingOutcome(
  row: typeof agentCharges.$inferSelect,
): ChargeRouterResponse {
  const chargeId = row.id;
  const status = row.status as AgentChargeStatus;

  switch (status) {
    case 'executed':
    case 'succeeded':
      return {
        outcome: 'executed',
        chargeId,
        providerChargeId: row.providerChargeId ?? null,
        executionPath: 'main_app_stripe',
      };
    case 'shadow_settled':
      return { outcome: 'shadow_settled', chargeId };
    case 'pending_approval':
      return { outcome: 'pending_approval', chargeId, actionId: row.actionId ?? '' };
    case 'blocked':
      return { outcome: 'blocked', chargeId, reason: row.failureReason ?? 'blocked' };
    case 'failed':
      return { outcome: 'failed', chargeId, reason: row.failureReason ?? 'failed' };
    case 'denied':
      return { outcome: 'blocked', chargeId, reason: row.failureReason ?? 'denied' };
    default:
      return { outcome: 'blocked', chargeId, reason: 'unknown_status' };
  }
}

// ---------------------------------------------------------------------------
// Read-only ledger queries — used by the agentCharges route (§7.6)
// ---------------------------------------------------------------------------

const IN_FLIGHT_STATUSES: AgentChargeStatus[] = ['pending_approval', 'approved', 'executed'];

export interface ListChargesOptions {
  organisationId: string;
  status?: AgentChargeStatus;
  intentId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

export async function listCharges(opts: ListChargesOptions): Promise<{
  items: typeof agentCharges.$inferSelect[];
  nextCursor: string | null;
}> {
  const tx = getOrgScopedDb('chargeRouterService.listCharges');
  const conditions = [eq(agentCharges.organisationId, opts.organisationId)];

  if (opts.status) conditions.push(eq(agentCharges.status, opts.status));
  if (opts.intentId) conditions.push(eq(agentCharges.intentId, opts.intentId));
  if (opts.from) conditions.push(gte(agentCharges.createdAt, opts.from));
  if (opts.to) conditions.push(lte(agentCharges.createdAt, opts.to));
  if (opts.cursor) conditions.push(sql`${agentCharges.id} > ${opts.cursor}::uuid`);

  const rows = await tx
    .select()
    .from(agentCharges)
    .where(and(...conditions))
    .orderBy(agentCharges.id)
    .limit(opts.limit);

  const nextCursor = rows.length === opts.limit ? rows[rows.length - 1]?.id ?? null : null;
  return { items: rows, nextCursor };
}

export async function getChargeById(
  chargeId: string,
  organisationId: string,
): Promise<typeof agentCharges.$inferSelect | null> {
  const tx = getOrgScopedDb('chargeRouterService.getChargeById');
  const [charge] = await tx
    .select()
    .from(agentCharges)
    .where(and(
      sql`${agentCharges.id} = ${chargeId}::uuid`,
      eq(agentCharges.organisationId, organisationId),
    ))
    .limit(1);
  return charge ?? null;
}

export async function getChargeAggregates(opts: {
  organisationId: string;
  dimension: string;
  entityId?: string;
  periodKey?: string;
}): Promise<{
  settledSpend: typeof costAggregates.$inferSelect[];
  inFlightReservedMinor: number;
}> {
  const tx = getOrgScopedDb('chargeRouterService.getChargeAggregates');

  // App-layer org filter is mandatory even with RLS in force — sentinel-org
  // rows in cost_aggregates are visible cross-tenant by design and would leak
  // through if the SELECT relied on RLS alone (DEVELOPMENT_GUIDELINES §1).
  const settledConditions = [
    eq(costAggregates.organisationId, opts.organisationId),
    eq(costAggregates.entityType, opts.dimension),
  ];
  if (opts.entityId) settledConditions.push(eq(costAggregates.entityId, opts.entityId));
  if (opts.periodKey) settledConditions.push(eq(costAggregates.periodKey, opts.periodKey));

  const settled = await tx
    .select({
      entityType: costAggregates.entityType,
      entityId: costAggregates.entityId,
      periodType: costAggregates.periodType,
      periodKey: costAggregates.periodKey,
      totalCostCents: costAggregates.totalCostCents,
      updatedAt: costAggregates.updatedAt,
    })
    .from(costAggregates)
    .where(and(...settledConditions));

  const inFlightRows = await tx
    .select({
      totalReservedMinor: sql<number>`COALESCE(SUM(${agentCharges.amountMinor}), 0)`,
    })
    .from(agentCharges)
    .where(and(
      eq(agentCharges.organisationId, opts.organisationId),
      inArray(agentCharges.status, IN_FLIGHT_STATUSES),
    ));

  return {
    settledSpend: settled as typeof costAggregates.$inferSelect[],
    inFlightReservedMinor: Number(inFlightRows[0]?.totalReservedMinor ?? 0),
  };
}
