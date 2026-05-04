// ---------------------------------------------------------------------------
// spendSkillHandlers — thin shells for spend-enabled skills (Chunk 6)
//
// Each handler:
//   1. Validates input against the registered Zod schema.
//   2. Resolves spendingBudgetId + spendingPolicyId for the run's subaccount/agent.
//   3. Normalises args.merchant via normaliseMerchantDescriptor (invariant 21).
//   4. Builds the charge idempotency key.
//   5. Calls chargeRouterService.proposeCharge(input).
//   6. Maps the ChargeRouterResponse to a skill output.
//
// issue_refund is special (invariant 41): handler does NOT mutate the parent row.
// It calls proposeCharge with kind='inbound_refund', parentChargeId=<original>,
// direction='subtract'. A NEW row is created; the original 'succeeded' row is
// never updated.
//
// worker_hosted_form skills in main-app context return the proposeCharge
// response directly with executionPath propagated. The worker round-trip
// (Chunk 11) wires the agent-spend-request queue for in-worker invocations.
//
// Spec:  tasks/builds/agentic-commerce/spec.md §7.1, §8.1-8.2
// Plan:  tasks/builds/agentic-commerce/plan.md § Chunk 6
// Invariants enforced: 2, 14, 21, 41
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { spendingBudgets } from '../db/schema/spendingBudgets.js';
import { spendingPolicies } from '../db/schema/spendingPolicies.js';
import {
  normaliseMerchantDescriptor,
  buildChargeIdempotencyKey,
  type ChargeRouterRequest,
} from './chargeRouterServicePure.js';
import { proposeCharge, type ChargeRouterResponse } from './chargeRouterService.js';
import type { SkillExecutionContext } from './skillExecutor.js';
import { ACTION_REGISTRY } from '../config/actionRegistry.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shape returned by every spend skill handler. */
export interface SpendSkillResult {
  outcome: 'shadow_settled' | 'executed' | 'pending_approval' | 'blocked' | 'failed';
  chargeId: string | null;
  providerChargeId?: string | null;
  executionPath?: 'main_app_stripe' | 'worker_hosted_form';
  reason?: string;
}

/** Resolve the active spending budget + policy for a (subaccountId, agentId, orgId) tuple. */
async function resolveSpendingContext(
  orgId: string,
  subaccountId: string | null,
  agentId: string,
  currency: string,
): Promise<{ spendingBudgetId: string; spendingPolicyId: string; mode: 'shadow' | 'live' } | null> {
  // Budget resolution priority per spec §5.1 cardinality rules:
  //   1. Per-agent budget (agent_id match)
  //   2. Per-subaccount budget (subaccount_id match, no agent_id)
  // Org-level (both null) is supported but requires an org-scoped budget row.
  // Filter out kill-switched budgets (disabled_at IS NULL) and currency-mismatched
  // ones — both would be rejected at the policy gate but with misleading error
  // codes; surface "no_active_spending_budget" instead.
  const tx = getOrgScopedDb('spendSkillHandlers.resolveSpendingContext');
  const budgetRows = await tx
    .select({ id: spendingBudgets.id, subaccountId: spendingBudgets.subaccountId, agentId: spendingBudgets.agentId })
    .from(spendingBudgets)
    .where(and(
      eq(spendingBudgets.organisationId, orgId),
      eq(spendingBudgets.currency, currency),
      isNull(spendingBudgets.disabledAt),
    ))
    .limit(20);

  // Prefer per-agent budget, fall back to per-subaccount, then org-level.
  let budgetId: string | undefined;
  for (const row of budgetRows) {
    if (row.agentId === agentId) {
      budgetId = row.id;
      break;
    }
  }
  if (!budgetId && subaccountId) {
    for (const row of budgetRows) {
      if (row.subaccountId === subaccountId && !row.agentId) {
        budgetId = row.id;
        break;
      }
    }
  }
  if (!budgetId) {
    // Org-level budget (both subaccountId and agentId null)
    for (const row of budgetRows) {
      if (!row.subaccountId && !row.agentId) {
        budgetId = row.id;
        break;
      }
    }
  }

  if (!budgetId) return null;

  const [policy] = await tx
    .select({ id: spendingPolicies.id, mode: spendingPolicies.mode })
    .from(spendingPolicies)
    .where(eq(spendingPolicies.spendingBudgetId, budgetId))
    .limit(1);

  if (!policy) return null;

  return { spendingBudgetId: budgetId, spendingPolicyId: policy.id, mode: policy.mode as 'shadow' | 'live' };
}

/** Map a ChargeRouterResponse to the uniform SpendSkillResult shape. */
function mapResponse(response: ChargeRouterResponse): SpendSkillResult {
  switch (response.outcome) {
    case 'executed':
      return {
        outcome: 'executed',
        chargeId: response.chargeId,
        providerChargeId: response.providerChargeId,
        executionPath: response.executionPath,
      };
    case 'shadow_settled':
      return { outcome: 'shadow_settled', chargeId: response.chargeId };
    case 'pending_approval':
      return { outcome: 'pending_approval', chargeId: response.chargeId };
    case 'blocked':
      return { outcome: 'blocked', chargeId: response.chargeId, reason: response.reason };
    case 'failed':
      return { outcome: 'failed', chargeId: response.chargeId, reason: response.reason };
  }
}

/**
 * Core spend handler factory. Validates input schema, resolves spending context,
 * normalises merchant, builds idempotency key, and calls proposeCharge.
 *
 * @param skillSlug    - The action registry slug for schema and executionPath lookup.
 * @param chargeType   - ChargeRouterRequest.chargeType value for this skill.
 * @param idFieldName  - The skill-specific "resource identifier" field in the input
 *                       (e.g. 'invoiceId', 'resourceId'). Included in canonical args.
 * @param input        - Raw tool input from the LLM.
 * @param context      - Skill execution context.
 * @param extra        - Optional overrides (e.g. parentChargeId for issue_refund).
 */
async function executeSpendSkill(opts: {
  skillSlug: string;
  chargeType: ChargeRouterRequest['chargeType'];
  idFieldName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
  parentChargeId?: string | null;
}): Promise<SpendSkillResult> {
  const { skillSlug, chargeType, idFieldName, input, context, parentChargeId = null } = opts;

  // Step 1: Validate input against the registered Zod schema.
  const def = ACTION_REGISTRY[skillSlug];
  if (!def) {
    return { outcome: 'blocked', chargeId: null, reason: 'invalid_skill_args: registry entry missing' };
  }

  const parseResult = def.parameterSchema.safeParse(input);
  if (!parseResult.success) {
    logger.warn('spend skill input validation failed', { skillSlug, errorCount: parseResult.error.issues.length });
    return {
      outcome: 'blocked',
      chargeId: null,
      reason: `invalid_skill_args: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
    };
  }

  const parsed = parseResult.data as {
    amount: number;
    currency: string;
    merchant: { id: string | null; descriptor: string };
    intent: string;
    [key: string]: unknown;
  };

  // Step 2: Resolve spending context (budgetId, policyId, mode).
  const spendCtx = await resolveSpendingContext(
    context.organisationId,
    context.subaccountId,
    context.agentId,
    parsed.currency,
  );

  if (!spendCtx) {
    return { outcome: 'blocked', chargeId: null, reason: 'no_active_spending_budget' };
  }

  // Step 3: Normalise merchant descriptor BEFORE canonicalising args (invariant 21).
  const normalisedDescriptor = normaliseMerchantDescriptor(parsed.merchant.descriptor);
  const normalisedMerchant = {
    id: parsed.merchant.id,
    descriptor: normalisedDescriptor,
  };

  // Step 4: Build canonical args (normalised merchant included) and idempotency key.
  const canonicalArgs: Record<string, unknown> = {
    [idFieldName]: parsed[idFieldName],
    amount: parsed.amount,
    currency: parsed.currency,
    merchant: normalisedMerchant,
  };
  if (parentChargeId) {
    canonicalArgs['parentChargeId'] = parentChargeId;
  }

  const idempotencyKey = buildChargeIdempotencyKey({
    skillRunId: context.runId,
    toolCallId: context.toolCallId ?? 'unknown',
    intent: parsed.intent as string,
    args: canonicalArgs,
    mode: spendCtx.mode,
  });

  // Step 5: Call proposeCharge.
  const executionPath = def.executionPath ?? 'main_app_stripe';

  // Deterministic intent id (spec §16.1): retries of the same logical operation
  // share an intent_id. Derive a UUID-formatted SHA-256 from
  // (skillRunId, toolCallId, intent) so the operator UI's retry-grouping
  // surface clusters attempts correctly. Mirrors the agentSpendRequestHandler
  // pattern of `intentId = toolCallId` but adds skillRunId + intent so distinct
  // tool-calls with the same toolCallId from different runs don't collide.
  const intentSeed = `${context.runId}:${context.toolCallId ?? 'unknown'}:${parsed.intent as string}`;
  const intentHex = createHash('sha256').update(intentSeed).digest('hex').slice(0, 32);
  const intentId = `${intentHex.slice(0, 8)}-${intentHex.slice(8, 12)}-${intentHex.slice(12, 16)}-${intentHex.slice(16, 20)}-${intentHex.slice(20, 32)}`;

  const request: ChargeRouterRequest & {
    spendingBudgetId: string;
    spendingPolicyId: string;
    executionPath: 'main_app_stripe' | 'worker_hosted_form';
    agentRunId: string | null;
    idempotencyKey: string;
    intentId: string;
    traceId: string;
  } = {
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    agentId: context.agentId,
    skillRunId: context.runId,
    toolCallId: context.toolCallId ?? 'unknown',
    intent: parsed.intent as string,
    amountMinor: parsed.amount,
    currency: parsed.currency,
    merchant: normalisedMerchant,
    chargeType,
    args: canonicalArgs,
    parentChargeId,
    spendingBudgetId: spendCtx.spendingBudgetId,
    spendingPolicyId: spendCtx.spendingPolicyId,
    executionPath,
    agentRunId: context.runId,
    idempotencyKey,
    intentId,
    traceId: context.runId,
  };

  const response = await proposeCharge(request);

  // Step 6: Map response.
  return mapResponse(response);
}

// ---------------------------------------------------------------------------
// Exported skill handlers (registered in SKILL_HANDLERS in skillExecutor.ts)
// ---------------------------------------------------------------------------

export async function executePayInvoice(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<SpendSkillResult> {
  return executeSpendSkill({
    skillSlug: 'pay_invoice',
    chargeType: 'invoice_payment',
    idFieldName: 'invoiceId',
    input,
    context,
  });
}

export async function executePurchaseResource(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<SpendSkillResult> {
  return executeSpendSkill({
    skillSlug: 'purchase_resource',
    chargeType: 'purchase',
    idFieldName: 'resourceId',
    input,
    context,
  });
}

export async function executeSubscribeToService(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<SpendSkillResult> {
  return executeSpendSkill({
    skillSlug: 'subscribe_to_service',
    chargeType: 'subscription',
    idFieldName: 'serviceId',
    input,
    context,
  });
}

export async function executeTopUpBalance(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<SpendSkillResult> {
  return executeSpendSkill({
    skillSlug: 'top_up_balance',
    chargeType: 'top_up',
    idFieldName: 'accountId',
    input,
    context,
  });
}

/**
 * issue_refund handler — invariant 41 (operator refunds are append-only).
 *
 * Creates a NEW agent_charges row with kind='inbound_refund', direction='subtract'.
 * Does NOT mutate (UPDATE) the parent row. The original 'succeeded' row is preserved.
 *
 * Reviewer checklist: confirm this handler contains zero
 * `UPDATE agent_charges SET status = 'refunded'` calls.
 */
export async function executeIssueRefund(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<SpendSkillResult> {
  // Validate parentChargeId separately before passing through.
  const parentChargeId = typeof input['parentChargeId'] === 'string' ? input['parentChargeId'] : null;
  if (!parentChargeId) {
    return { outcome: 'blocked', chargeId: null, reason: 'invalid_skill_args: parentChargeId is required' };
  }

  return executeSpendSkill({
    skillSlug: 'issue_refund',
    chargeType: 'refund',
    idFieldName: 'parentChargeId',
    input,
    context,
    parentChargeId,
  });
}
