// ---------------------------------------------------------------------------
// agentSpendRequestHandler — main-app handler for `agent-spend-request` queue
//
// Receives WorkerSpendRequest from the IEE worker, recomputes the idempotency
// key from the payload fields, rejects on mismatch (invariant 21), calls
// chargeRouterService.proposeCharge, then emits the immediate-decision response
// on the `agent-spend-response` queue keyed by correlationId.
//
// Decision union is bounded to 'approved' | 'blocked' | 'pending_approval'
// (spec §8.4). Human-decided outcomes never travel on this queue.
//
// Spec: tasks/builds/agentic-commerce/spec.md §7.2, §8.3, §8.4
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 11
// Invariants enforced: 1, 3, 21, 38
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';
import { withTrace } from '../lib/spendLogging.js';
import {
  buildChargeIdempotencyKey,
  normaliseMerchantDescriptor,
} from '../services/chargeRouterServicePure.js';
import { SPT_WORKER_HANDOFF_MARGIN_MS } from '../config/spendConstants.js';
import { getJobConfig } from '../config/jobConfig.js';
import { createWorker } from '../lib/createWorker.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { SpendRequestPayload } from '../../shared/iee/actionSchema.js';

export const QUEUE = 'agent-spend-request';
export const RESPONSE_QUEUE = 'agent-spend-response';

// ---------------------------------------------------------------------------
// WorkerSpendResponse shape — written to RESPONSE_QUEUE (spec §8.4)
// ---------------------------------------------------------------------------

export interface WorkerSpendResponse {
  correlationId: string;
  decision: 'approved' | 'blocked' | 'pending_approval';
  executionPath: 'main_app_stripe' | 'worker_hosted_form' | null;
  chargeToken: string | null;
  providerChargeId: string | null;
  sptExpiresAt: string | null;
  ledgerRowId: string | null;
  errorReason: string | null;
  traceId: string;
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function validatePayload(data: unknown): SpendRequestPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.ieeRunId !== 'string' || obj.ieeRunId.length === 0) return null;
  if (typeof obj.skillRunId !== 'string' || obj.skillRunId.length === 0) return null;
  if (typeof obj.organisationId !== 'string' || obj.organisationId.length === 0) return null;
  if (typeof obj.subaccountId !== 'string' || obj.subaccountId.length === 0) return null;
  if (typeof obj.agentId !== 'string' || obj.agentId.length === 0) return null;
  if (typeof obj.toolCallId !== 'string' || obj.toolCallId.length === 0) return null;
  if (typeof obj.intent !== 'string' || obj.intent.length === 0) return null;
  if (typeof obj.amountMinor !== 'number' || !Number.isInteger(obj.amountMinor) || obj.amountMinor <= 0) return null;
  if (typeof obj.currency !== 'string' || obj.currency.length !== 3) return null;
  if (typeof obj.merchant !== 'object' || obj.merchant === null) return null;
  const merchant = obj.merchant as Record<string, unknown>;
  if (typeof merchant.descriptor !== 'string' || merchant.descriptor.length === 0) return null;
  if (
    obj.chargeType !== 'purchase' &&
    obj.chargeType !== 'subscription' &&
    obj.chargeType !== 'top_up' &&
    obj.chargeType !== 'invoice_payment'
  ) return null;
  if (typeof obj.args !== 'object' || obj.args === null) return null;
  if (typeof obj.idempotencyKey !== 'string' || obj.idempotencyKey.length === 0) return null;
  if (typeof obj.correlationId !== 'string' || obj.correlationId.length === 0) return null;

  return obj as unknown as SpendRequestPayload;
}

// ---------------------------------------------------------------------------
// Idempotency-key drift check (invariant 21)
// ---------------------------------------------------------------------------

/**
 * Pure helper: recompute the idempotency key from payload fields and compare.
 * Returns null if keys match (no drift), or the computed key if they differ.
 */
export function checkIdempotencyKeyDrift(
  payload: SpendRequestPayload,
  mode: 'shadow' | 'live',
): { drifted: false } | { drifted: true; recomputedKey: string } {
  // The merchant descriptor in args must already be normalised (invariant 21 contract).
  const recomputedKey = buildChargeIdempotencyKey({
    skillRunId: payload.skillRunId,
    toolCallId: payload.toolCallId,
    intent: payload.intent,
    args: payload.args,
    mode,
  });
  if (recomputedKey === payload.idempotencyKey) {
    return { drifted: false };
  }
  return { drifted: true, recomputedKey };
}

// ---------------------------------------------------------------------------
// sptExpiresAt computation
// ---------------------------------------------------------------------------

/**
 * Compute the SPT expiry timestamp for the worker response.
 * Non-null only for live + worker_hosted_form paths.
 * Applies SPT_WORKER_HANDOFF_MARGIN_MS safety margin.
 */
export function computeSptExpiresAt(
  tokenExpiresAt: Date | null,
): string | null {
  if (!tokenExpiresAt) return null;
  const adjustedMs = tokenExpiresAt.getTime() - SPT_WORKER_HANDOFF_MARGIN_MS;
  return new Date(adjustedMs).toISOString();
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export async function registerAgentSpendRequestHandler(boss: PgBoss): Promise<void> {
  const config = getJobConfig(QUEUE);

  await createWorker<Record<string, unknown>>({
    queue: QUEUE,
    boss,
    concurrency: 4,
    resolveOrgContext: (job) => {
      const data = (job.data ?? {}) as Record<string, unknown>;
      const organisationId = typeof data.organisationId === 'string' ? data.organisationId : null;
      const subaccountId = typeof data.subaccountId === 'string' ? data.subaccountId : null;
      if (!organisationId) return null; // handler validates payload and logs
      return { organisationId, subaccountId };
    },
    handler: async (job) => {
      const payload = validatePayload(job.data);
      if (!payload) {
        logger.warn('agent_spend_request.invalid_payload', {
          jobId: job.id,
          rawKeys: typeof job.data === 'object' && job.data !== null
            ? Object.keys(job.data as Record<string, unknown>)
            : typeof job.data,
        });
        return;
      }

      const { correlationId } = payload;

      // Invariant 38: propagate traceId through every log line.
      const traceId = payload.ieeRunId;

      await withTrace(traceId, async () => {
        logger.info('agent_spend_request.received', {
          correlationId,
          traceId,
          ieeRunId: payload.ieeRunId,
          organisationId: payload.organisationId,
        });

        // Fetch the execution path for this charge (needs SPT to determine live vs shadow).
        // We call proposeCharge which will determine mode from the active spending policy.
        // But first we must validate idempotency key — we need the mode, which comes from the policy.
        // Per spec: worker must have already normalised merchant descriptor before building the key.
        // The handler recomputes for both modes and checks against the supplied key.
        // If neither matches, reject with idempotency_args_drift.

        const normalisedDescriptor = normaliseMerchantDescriptor(payload.merchant.descriptor);

        // Build args with normalised merchant descriptor for key recomputation.
        // Per invariant 21: the merchant field inside args MUST be normalised before hashing.
        const argsWithNormalisedMerchant: Record<string, unknown> = {
          ...payload.args,
          merchant: {
            ...(typeof payload.args.merchant === 'object' && payload.args.merchant !== null
              ? payload.args.merchant as Record<string, unknown>
              : {}),
            descriptor: normalisedDescriptor,
          },
        };

        // Try recomputing for both modes to determine which applies.
        // The supplied key encodes the mode (charge:shadow: vs charge:live: prefix in intent).
        // We try both and match; the one that matches gives us the mode.
        const recomputedLive = buildChargeIdempotencyKey({
          skillRunId: payload.skillRunId,
          toolCallId: payload.toolCallId,
          intent: payload.intent,
          args: argsWithNormalisedMerchant,
          mode: 'live',
        });
        const recomputedShadow = buildChargeIdempotencyKey({
          skillRunId: payload.skillRunId,
          toolCallId: payload.toolCallId,
          intent: payload.intent,
          args: argsWithNormalisedMerchant,
          mode: 'shadow',
        });

        const matchesLive = recomputedLive === payload.idempotencyKey;
        const matchesShadow = recomputedShadow === payload.idempotencyKey;

        if (!matchesLive && !matchesShadow) {
          logger.warn('agent_spend_request.idempotency_args_drift', {
            correlationId,
            traceId,
            ieeRunId: payload.ieeRunId,
          });
          await emitBlockedResponse(boss, {
            correlationId,
            errorReason: 'idempotency_args_drift',
            traceId,
          });
          return;
        }

        // Determine execution path from the action registry / per-skill declaration.
        // Per spec §6.1 the executionPath is declared on the ActionDefinition. However,
        // the worker already knows the path (it chose which queue to use). The chargeType
        // carries enough signal to determine the correct executionPath for validation.
        // purchase/subscription/top_up → worker_hosted_form; invoice_payment → main_app_stripe.
        const executionPath: 'main_app_stripe' | 'worker_hosted_form' =
          payload.chargeType === 'invoice_payment' ? 'main_app_stripe' : 'worker_hosted_form';

        // Resolve the spending budget + policy context. proposeCharge requires
        // spendingBudgetId and spendingPolicyId from the app's routing layer.
        // For the worker path, we derive these from the organisationId + subaccountId
        // by looking up the active spending budget for the subaccount.
        let spendingBudgetId: string;
        let spendingPolicyId: string;
        let intentId: string;

        try {
          const resolved = await resolveSpendingContext(
            payload.organisationId,
            payload.subaccountId,
          );
          spendingBudgetId = resolved.spendingBudgetId;
          spendingPolicyId = resolved.spendingPolicyId;
          intentId = payload.toolCallId; // toolCallId as intentId for worker charges
        } catch (err) {
          logger.warn('agent_spend_request.context_resolution_failed', {
            correlationId,
            traceId,
            error: err instanceof Error ? err.message : String(err),
          });
          await emitBlockedResponse(boss, {
            correlationId,
            errorReason: 'spending_context_unavailable',
            traceId,
          });
          return;
        }

        // Call chargeRouterService.proposeCharge — single entry point for all money movement.
        const { proposeCharge } = await import('../services/chargeRouterService.js');
        let chargeResult: import('../services/chargeRouterService.js').ChargeRouterResponse;
        try {
          chargeResult = await proposeCharge({
            organisationId: payload.organisationId,
            subaccountId: payload.subaccountId,
            agentId: payload.agentId,
            skillRunId: payload.skillRunId,
            toolCallId: payload.toolCallId,
            intent: payload.intent,
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            merchant: {
              id: payload.merchant.id ?? null,
              descriptor: normalisedDescriptor,
            },
            chargeType: payload.chargeType,
            args: argsWithNormalisedMerchant,
            parentChargeId: null,
            spendingBudgetId,
            spendingPolicyId,
            executionPath,
            agentRunId: payload.skillRunId, // agentRunId = skillRunId for worker charges
            idempotencyKey: payload.idempotencyKey,
            intentId,
            traceId,
          });
        } catch (err) {
          logger.error('agent_spend_request.propose_charge_failed', {
            correlationId,
            traceId,
            error: err instanceof Error ? err.message : String(err),
          });
          await emitBlockedResponse(boss, {
            correlationId,
            errorReason: 'propose_charge_error',
            traceId,
          });
          return;
        }

        // Build the response based on the charge outcome.
        const response = await buildResponse(
          chargeResult,
          correlationId,
          traceId,
          payload.subaccountId,
          payload.organisationId,
        );

        // Emit response synchronously within this handler, before pg-boss acks the job.
        const responseConfig = getJobConfig(RESPONSE_QUEUE);
        await boss.send(RESPONSE_QUEUE, response, responseConfig);

        logger.info('agent_spend_request.response_emitted', {
          correlationId,
          traceId,
          decision: response.decision,
          executionPath: response.executionPath,
        });
      });
    },
  });

  logger.info('agent_spend_request.handler_registered', {
    retryLimit: config.retryLimit,
    deadLetter: 'deadLetter' in config ? config.deadLetter : undefined,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Emit a blocked response on the response queue. */
async function emitBlockedResponse(
  boss: PgBoss,
  opts: { correlationId: string; errorReason: string; traceId: string },
): Promise<void> {
  const response: WorkerSpendResponse = {
    correlationId: opts.correlationId,
    decision: 'blocked',
    executionPath: null,
    chargeToken: null,
    providerChargeId: null,
    sptExpiresAt: null,
    ledgerRowId: null,
    errorReason: opts.errorReason,
    traceId: opts.traceId,
  };
  try {
    const responseConfig = getJobConfig(RESPONSE_QUEUE);
    await boss.send(RESPONSE_QUEUE, response, responseConfig);
  } catch (err) {
    logger.error('agent_spend_request.blocked_response_emit_failed', {
      correlationId: opts.correlationId,
      traceId: opts.traceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Build the WorkerSpendResponse from a ChargeRouterResponse.
 * Computes sptExpiresAt for live + worker_hosted_form paths.
 */
async function buildResponse(
  chargeResult: import('../services/chargeRouterService.js').ChargeRouterResponse,
  correlationId: string,
  traceId: string,
  subaccountId: string,
  organisationId: string,
): Promise<WorkerSpendResponse> {
  if (chargeResult.outcome === 'blocked' || chargeResult.outcome === 'failed') {
    return {
      correlationId,
      decision: 'blocked',
      executionPath: null,
      chargeToken: null,
      providerChargeId: null,
      sptExpiresAt: null,
      ledgerRowId: chargeResult.chargeId ?? null,
      errorReason: chargeResult.reason ?? null,
      traceId,
    };
  }

  if (chargeResult.outcome === 'pending_approval') {
    return {
      correlationId,
      decision: 'pending_approval',
      executionPath: null,
      chargeToken: null,
      providerChargeId: null,
      sptExpiresAt: null,
      ledgerRowId: chargeResult.chargeId,
      errorReason: null,
      traceId,
    };
  }

  if (chargeResult.outcome === 'shadow_settled') {
    return {
      correlationId,
      decision: 'approved',
      executionPath: null,
      chargeToken: null,
      providerChargeId: null,
      sptExpiresAt: null,
      ledgerRowId: chargeResult.chargeId,
      errorReason: null,
      traceId,
    };
  }

  // outcome === 'executed'
  if (chargeResult.executionPath === 'main_app_stripe') {
    return {
      correlationId,
      decision: 'approved',
      executionPath: 'main_app_stripe',
      chargeToken: null,
      providerChargeId: chargeResult.providerChargeId ?? null,
      sptExpiresAt: null,
      ledgerRowId: chargeResult.chargeId,
      errorReason: null,
      traceId,
    };
  }

  // worker_hosted_form — compute sptExpiresAt (invariant 3 extended: must include expiry)
  let sptExpiresAt: string | null = null;
  if (chargeResult.chargeToken) {
    // Use sptExpiresAt from the charge result if provided (set by executeApproved).
    if (chargeResult.sptExpiresAt) {
      // Apply margin to what executeApproved already read from the DB.
      const rawExpiry = new Date(chargeResult.sptExpiresAt);
      sptExpiresAt = computeSptExpiresAt(rawExpiry);
    } else {
      // Fallback: fetch SPT expiry directly.
      try {
        const { sptVaultService } = await import('../services/sptVaultService.js');
        const spt = await sptVaultService.getActiveSpt(subaccountId, organisationId);
        sptExpiresAt = computeSptExpiresAt(spt.expiresAt);
      } catch {
        // If we can't get expiry, null is safer than infinite; worker will check.
        sptExpiresAt = null;
      }
    }
  }

  return {
    correlationId,
    decision: 'approved',
    executionPath: 'worker_hosted_form',
    chargeToken: chargeResult.chargeToken ?? null,
    providerChargeId: null,
    sptExpiresAt,
    ledgerRowId: chargeResult.chargeId,
    errorReason: null,
    traceId,
  };
}

/**
 * Resolve the active spending budget + policy for a given subaccount/org.
 * Looks up the first non-disabled spending budget for the subaccount.
 */
async function resolveSpendingContext(
  organisationId: string,
  subaccountId: string,
): Promise<{ spendingBudgetId: string; spendingPolicyId: string }> {
  const { spendingBudgets } = await import('../db/schema/spendingBudgets.js');
  const { spendingPolicies } = await import('../db/schema/spendingPolicies.js');
  const { eq, and, isNull } = await import('drizzle-orm');

  const tx = getOrgScopedDb('agentSpendRequestHandler.resolveSpendingContext');

  const [budget] = await tx
    .select()
    .from(spendingBudgets)
    .where(and(
      eq(spendingBudgets.organisationId, organisationId),
      eq(spendingBudgets.subaccountId, subaccountId),
      isNull(spendingBudgets.disabledAt),
    ))
    .limit(1);

  if (!budget) {
    throw new Error(`No active spending budget for subaccount ${subaccountId} in org ${organisationId}`);
  }

  const [policy] = await tx
    .select()
    .from(spendingPolicies)
    .where(and(
      eq(spendingPolicies.spendingBudgetId, budget.id),
      eq(spendingPolicies.organisationId, organisationId),
    ))
    .limit(1);

  if (!policy) {
    throw new Error(`No spending policy for budget ${budget.id}`);
  }

  return { spendingBudgetId: budget.id, spendingPolicyId: policy.id };
}
