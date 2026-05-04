// ---------------------------------------------------------------------------
// spendingBudgetService — CRUD for spending_budgets and spending_policies
//
// Owns:
//   - spending_budgets CRUD (create, update, getById, listForOrg, listForSubaccount)
//   - spending_policies CRUD (getByBudgetId, update)
//   - spend_approver default-grant logic (runs atomically with budget INSERT)
//   - Merchant allowlist validation (delegated to spendingBudgetServicePure)
//   - Unique-constraint HTTP mapping (spec §9.5)
//
// Spec: tasks/builds/agentic-commerce/spec.md §5.1, §9.5, §11.1
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// Invariants: 29, 32
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { orgUserRoles, actions, permissionSetItems } from '../db/schema/index.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { spendingBudgets } from '../db/schema/spendingBudgets.js';
import { spendingPolicies } from '../db/schema/spendingPolicies.js';
import { spendingBudgetApprovers } from '../db/schema/spendingBudgetApprovers.js';
import { auditService } from './auditService.js';
import { reviewService } from './reviewService.js';
import { actionService } from './actionService.js';
import { logger } from '../lib/logger.js';
import {
  validateMerchantAllowlist,
  incrementPolicyVersion,
  computeDefaultGrantScope,
  resolvePromotionTransition,
} from './spendingBudgetServicePure.js';
import type { MerchantAllowlistEntry } from '../db/schema/spendingPolicies.js';
import type { SpendingBudget } from '../db/schema/spendingBudgets.js';
import type { SpendingPolicy } from '../db/schema/spendingPolicies.js';

// ---------------------------------------------------------------------------
// Error helpers — unique-constraint HTTP mapping (spec §9.5)
// ---------------------------------------------------------------------------

function isPostgresUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505';
}

function mapUniqueViolation(err: unknown, context: string): never {
  const e = err as { constraint?: string };
  const constraint = e.constraint ?? '';

  if (context === 'spending_budget') {
    if (constraint.includes('agent_uniq') || constraint.includes('subaccount_currency_uniq')) {
      const error: { statusCode: number; message: string; errorCode: string } = {
        statusCode: 409,
        message: 'A Spending Budget already exists with this scope.',
        errorCode: 'spending_budget_conflict',
      };
      throw error;
    }
  }

  if (context === 'spending_policy') {
    const error: { statusCode: number; message: string; errorCode: string } = {
      statusCode: 409,
      message: 'A Spending Policy already exists for this budget.',
      errorCode: 'spending_policy_conflict',
    };
    throw error;
  }

  if (context === 'spending_budget_approver') {
    const error: { statusCode: number; message: string; errorCode: string } = {
      statusCode: 409,
      message: 'This user is already an approver for this budget.',
      errorCode: 'approver_conflict',
    };
    throw error;
  }

  // Generic fallback for unmapped 23505.
  const error: { statusCode: number; message: string; errorCode: string } = {
    statusCode: 409,
    message: 'A duplicate record exists.',
    errorCode: 'conflict',
  };
  throw error;
}

// ---------------------------------------------------------------------------
// create
//
// Creates a spending_budget + spending_policy atomically.
// spend_approver default-grant runs inside the same transaction.
// ---------------------------------------------------------------------------

export interface CreateBudgetInput {
  organisationId: string;
  subaccountId: string | null;
  agentId: string | null;
  currency: string;
  name: string;
  monthlySpendAlertThresholdMinor?: number | null;
  policy: {
    mode: 'shadow' | 'live';
    perTxnLimitMinor?: number;
    dailyLimitMinor?: number;
    monthlyLimitMinor?: number;
    approvalThresholdMinor?: number;
    merchantAllowlist?: MerchantAllowlistEntry[];
    approvalExpiresHours?: number;
  };
  createdByUserId: string; // reserved for audit log in future; default grant uses enumerated admins
}

export interface CreateBudgetResult {
  budget: SpendingBudget;
  policy: SpendingPolicy;
}

export async function create(input: CreateBudgetInput): Promise<CreateBudgetResult> {
  const { organisationId, subaccountId, agentId, currency, name, policy } = input;

  // Validate allowlist before touching the DB.
  const allowlist = policy.merchantAllowlist ?? [];
  const allowlistValidation = validateMerchantAllowlist(allowlist);
  if (!allowlistValidation.valid) {
    throw {
      statusCode: 400,
      message: `Merchant allowlist validation failed: ${allowlistValidation.reason}`,
      errorCode: 'validation_error',
      validationError: allowlistValidation.reason,
    };
  }

  // Enumerate role-holders for default grant before the transaction.
  const grantScope = computeDefaultGrantScope(organisationId, subaccountId);

  const tx = getOrgScopedDb('spendingBudgetService.create');
  // Default-grant target: users whose role grants the SPEND_APPROVER permission
  // key. By default that's only "Org Admin"; custom roles can also grant it.
  // Spec §11.1: "spend_approver granted to ALL users currently holding the
  // org-admin role for that organisation" — modelled here via the permission
  // key, which is the codebase's canonical org-admin signal.
  //
  // The grantScope split (org vs subaccount) currently funnels both branches
  // into the same query — sub-account-admin is not yet modelled as a distinct
  // role in v1. When that lands, replace the subaccount branch with a query
  // joining a future subaccount_user_roles table on the SPEND_APPROVER key.
  const orgAdmins = await tx
    .selectDistinct({ userId: orgUserRoles.userId })
    .from(orgUserRoles)
    .innerJoin(
      permissionSetItems,
      eq(permissionSetItems.permissionSetId, orgUserRoles.permissionSetId),
    )
    .where(and(
      eq(orgUserRoles.organisationId, organisationId),
      eq(permissionSetItems.permissionKey, ORG_PERMISSIONS.SPEND_APPROVER),
    ));
  const adminUserIds = orgAdmins.map((r) => r.userId);
  // Acknowledge grantScope read-only for now — preserves the call so the
  // subaccount-vs-org distinction is wired for the future role split.
  void grantScope;

  try {
    const budgetId = randomUUID();
    const policyId = randomUUID();
    const now = new Date();

    const [budget] = await tx
        .insert(spendingBudgets)
        .values({
          id: budgetId,
          organisationId,
          subaccountId: subaccountId ?? undefined,
          agentId: agentId ?? undefined,
          currency,
          name,
          monthlySpendAlertThresholdMinor: input.monthlySpendAlertThresholdMinor ?? undefined,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!budget) {
        throw { statusCode: 500, message: 'Failed to create spending budget.', errorCode: 'internal_error' };
      }

      const [createdPolicy] = await tx
        .insert(spendingPolicies)
        .values({
          id: policyId,
          organisationId,
          spendingBudgetId: budgetId,
          mode: policy.mode,
          perTxnLimitMinor: policy.perTxnLimitMinor ?? 0,
          dailyLimitMinor: policy.dailyLimitMinor ?? 0,
          monthlyLimitMinor: policy.monthlyLimitMinor ?? 0,
          approvalThresholdMinor: policy.approvalThresholdMinor ?? 0,
          merchantAllowlist: allowlistValidation.normalised,
          approvalExpiresHours: policy.approvalExpiresHours ?? 24,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!createdPolicy) {
        throw { statusCode: 500, message: 'Failed to create spending policy.', errorCode: 'internal_error' };
      }

      // Default-grant: insert spend_approver grants for all admin users.
      if (adminUserIds.length > 0) {
        for (const userId of adminUserIds) {
          try {
            await tx.insert(spendingBudgetApprovers).values({
              id: randomUUID(),
              organisationId,
              spendingBudgetId: budgetId,
              userId,
              createdAt: now,
            }).onConflictDoNothing();
          } catch (grantErr) {
            // Partial failure on individual grant should not fail the whole transaction.
            logger.error('spendingBudgetService.default_grant_failed', {
              userId,
              budgetId,
              error: grantErr instanceof Error ? grantErr.message : String(grantErr),
            });
            throw {
              statusCode: 500,
              message: 'Default grant failed during budget creation.',
              errorCode: 'default_grant_failed',
              failureReason: 'default_grant_failed',
            };
          }
        }
      }

    return { budget, policy: createdPolicy };
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      mapUniqueViolation(err, 'spending_budget');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export interface UpdateBudgetInput {
  budgetId: string;
  organisationId: string;
  name?: string;
  monthlySpendAlertThresholdMinor?: number | null;
  disabledAt?: Date | null;
}

export async function update(input: UpdateBudgetInput): Promise<SpendingBudget> {
  const { budgetId, organisationId, ...fields } = input;
  const tx = getOrgScopedDb('spendingBudgetService.update');

  const [updated] = await tx
    .update(spendingBudgets)
    .set({ ...fields, updatedAt: new Date() })
    .where(
      and(
        eq(spendingBudgets.id, budgetId),
        eq(spendingBudgets.organisationId, organisationId),
      ),
    )
    .returning();

  if (!updated) {
    throw { statusCode: 404, message: 'Spending budget not found.', errorCode: 'not_found' };
  }
  return updated;
}

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

export async function getById(budgetId: string, organisationId: string): Promise<SpendingBudget> {
  const tx = getOrgScopedDb('spendingBudgetService.getById');
  const [budget] = await tx
    .select()
    .from(spendingBudgets)
    .where(
      and(
        eq(spendingBudgets.id, budgetId),
        eq(spendingBudgets.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!budget) {
    throw { statusCode: 404, message: 'Spending budget not found.', errorCode: 'not_found' };
  }
  return budget;
}

// ---------------------------------------------------------------------------
// listForOrg
// ---------------------------------------------------------------------------

export async function listForOrg(organisationId: string): Promise<SpendingBudget[]> {
  return getOrgScopedDb('spendingBudgetService.listForOrg')
    .select()
    .from(spendingBudgets)
    .where(eq(spendingBudgets.organisationId, organisationId));
}

// ---------------------------------------------------------------------------
// listForSubaccount
// ---------------------------------------------------------------------------

export async function listForSubaccount(
  subaccountId: string,
  organisationId: string,
): Promise<SpendingBudget[]> {
  return getOrgScopedDb('spendingBudgetService.listForSubaccount')
    .select()
    .from(spendingBudgets)
    .where(
      and(
        eq(spendingBudgets.subaccountId, subaccountId),
        eq(spendingBudgets.organisationId, organisationId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Policy operations
// ---------------------------------------------------------------------------

export async function getPolicyByBudgetId(
  budgetId: string,
  organisationId: string,
): Promise<SpendingPolicy> {
  const tx = getOrgScopedDb('spendingBudgetService.getPolicyByBudgetId');
  const [policy] = await tx
    .select()
    .from(spendingPolicies)
    .where(
      and(
        eq(spendingPolicies.spendingBudgetId, budgetId),
        eq(spendingPolicies.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!policy) {
    throw { statusCode: 404, message: 'Spending policy not found.', errorCode: 'not_found' };
  }
  return policy;
}

export interface UpdatePolicyInput {
  budgetId: string;
  organisationId: string;
  updatedByUserId: string;
  mode?: 'shadow' | 'live';
  perTxnLimitMinor?: number;
  dailyLimitMinor?: number;
  monthlyLimitMinor?: number;
  approvalThresholdMinor?: number;
  merchantAllowlist?: MerchantAllowlistEntry[];
  approvalExpiresHours?: number;
}

export async function updatePolicy(input: UpdatePolicyInput): Promise<SpendingPolicy> {
  const { budgetId, organisationId, updatedByUserId, merchantAllowlist, ...rest } = input;

  // Validate allowlist if provided.
  let normalisedAllowlist: MerchantAllowlistEntry[] | undefined;
  if (merchantAllowlist !== undefined) {
    const validation = validateMerchantAllowlist(merchantAllowlist);
    if (!validation.valid) {
      throw {
        statusCode: 400,
        message: `Merchant allowlist validation failed: ${validation.reason}`,
        errorCode: 'validation_error',
        validationError: validation.reason,
      };
    }
    normalisedAllowlist = validation.normalised;
  }

  const current = await getPolicyByBudgetId(budgetId, organisationId);
  const newVersion = incrementPolicyVersion(current.version);

  const updatePayload: Partial<SpendingPolicy> = {
    ...rest,
    ...(normalisedAllowlist !== undefined ? { merchantAllowlist: normalisedAllowlist } : {}),
    version: newVersion,
    updatedAt: new Date(),
  };

  const tx = getOrgScopedDb('spendingBudgetService.updatePolicy');
  const [updated] = await tx
    .update(spendingPolicies)
    .set(updatePayload)
    .where(
      and(
        eq(spendingPolicies.spendingBudgetId, budgetId),
        eq(spendingPolicies.organisationId, organisationId),
      ),
    )
    .returning();

  if (!updated) {
    throw { statusCode: 404, message: 'Spending policy not found.', errorCode: 'not_found' };
  }

  await auditService.log({
    organisationId,
    actorId: updatedByUserId,
    actorType: 'user',
    action: 'spending_policy_updated',
    entityType: 'spending_policy',
    entityId: updated.id,
    metadata: { budgetId, newVersion },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// uuidToBigint — advisory lock key derivation (mirrors approvalChannelService)
// ---------------------------------------------------------------------------

function uuidToBigint(id: string): string {
  const hex = id.replace(/-/g, '').slice(0, 16);
  const val = BigInt(`0x${hex}`);
  const MAX_INT8 = BigInt('9223372036854775807');
  if (val > MAX_INT8) {
    return String(val - BigInt('18446744073709551616'));
  }
  return String(val);
}

// ---------------------------------------------------------------------------
// requestPromotion
//
// Enforces invariant 29: one active promotion per spending_policy_id at a time.
// Under advisory lock keyed on spending_policy_id, checks for an existing
// pending_approval promotion action; if found → returns existing actionId.
// Otherwise creates a new actions row and fans out to approvers via the
// in-app review queue.
// ---------------------------------------------------------------------------

export interface RequestPromotionResult {
  outcome: 'promotion_requested' | 'promotion_already_pending';
  actionId: string;
}

export async function requestPromotion(
  budgetId: string,
  requesterId: string,
  organisationId: string,
): Promise<RequestPromotionResult> {
  const policy = await getPolicyByBudgetId(budgetId, organisationId);

  const transition = resolvePromotionTransition(policy.mode);
  if (!transition.valid) {
    throw {
      statusCode: 409,
      message: 'This policy is already live.',
      errorCode: transition.reason,
    };
  }

  const lockId = uuidToBigint(policy.id);
  const tx = getOrgScopedDb('spendingBudgetService.requestPromotion');

  await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(lockId)})`);

  // Invariant 29: check for an existing pending promotion.
  const [existing] = await tx
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.actionType, 'promote_spending_policy_to_live'),
        eq(actions.status, 'pending_approval'),
        sql`${actions.metadataJson}->>'spendingBudgetId' = ${budgetId}`,
      ),
    )
    .limit(1);

  if (existing) {
    return { outcome: 'promotion_already_pending', actionId: existing.id };
  }

  const idempotencyKey = `promote:${policy.id}:${policy.version}`;

  // Route through actionService.proposeAction so registry validation, gate
  // resolution, and event emission run for this HITL action like every other.
  // Spec: §14 Shadow-to-Live Promotion. Registry entry: actionRegistry.ts
  // → promote_spending_policy_to_live (defaultGateLevel: 'review').
  const proposeResult = await actionService.proposeAction({
    organisationId,
    subaccountId: null,
    agentId: null, // system-initiated; actions.agent_id nullable per migration 0274
    actionType: 'promote_spending_policy_to_live',
    idempotencyKey,
    payload: { spendingBudgetId: budgetId, requesterId },
    metadata: {
      category: 'spend_promotion',
      spendingBudgetId: budgetId,
      currentVersion: policy.version,
    },
  });

  const actionId = proposeResult.actionId;

  // Fan out to approvers via the in-app review queue.
  try {
    const actionRow = await tx
      .select()
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)))
      .limit(1)
      .then(([row]) => row);

    if (actionRow) {
      await reviewService.createReviewItem(actionRow, {
        actionType: 'spend_promotion',
        reasoning: `Shadow-to-live promotion requested for Spending Budget ${budgetId} (policy v${actionRow.metadataJson && typeof actionRow.metadataJson === 'object' && 'currentVersion' in actionRow.metadataJson ? (actionRow.metadataJson as Record<string, unknown>).currentVersion : '?'})`,
        proposedPayload: {
          spendingBudgetId: budgetId,
          requesterId,
          policyId: policy.id,
          currentVersion: policy.version,
        },
      });
    }
  } catch (err) {
    logger.error('spendingBudgetService.requestPromotion_review_fanout_failed', {
      actionId,
      budgetId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Mark action failed — all channels failed to dispatch.
    await tx
      .update(actions)
      .set({
        status: 'failed',
        metadataJson: sql`coalesce(${actions.metadataJson}, '{}'::jsonb) || ${JSON.stringify({ failureReason: 'channel_dispatch_failed' })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(actions.id, actionId));
    throw {
      statusCode: 500,
      message: 'Failed to dispatch promotion approval request.',
      errorCode: 'channel_dispatch_failed',
    };
  }

  return { outcome: 'promotion_requested', actionId };
}

// ---------------------------------------------------------------------------
// promoteToLive
//
// Called on approval of a promote_spending_policy_to_live action.
// Re-validates policy version; flips mode to live; increments version.
// ---------------------------------------------------------------------------

export async function promoteToLive(
  budgetId: string,
  approvalActionId: string,
  organisationId: string,
): Promise<SpendingPolicy> {
  const tx = getOrgScopedDb('spendingBudgetService.promoteToLive');
  // Read the action metadata to retrieve the version at time of request.
  const [actionRow] = await tx
    .select({ metadataJson: actions.metadataJson })
    .from(actions)
    .where(and(eq(actions.id, approvalActionId), eq(actions.organisationId, organisationId)))
    .limit(1);

  if (!actionRow) {
    throw { statusCode: 404, message: 'Promotion action not found.', errorCode: 'not_found' };
  }

  const metadata = actionRow.metadataJson as Record<string, unknown> | null;
  const requestedVersion = metadata && typeof metadata['currentVersion'] === 'number'
    ? (metadata['currentVersion'] as number)
    : null;

  const policy = await getPolicyByBudgetId(budgetId, organisationId);

  // Version drift check — auto-deny if policy was updated since promotion was requested.
  if (requestedVersion !== null && policy.version !== requestedVersion) {
    logger.warn('spendingBudgetService.promoteToLive_version_drift', {
      budgetId,
      approvalActionId,
      requestedVersion,
      currentVersion: policy.version,
    });
    // Auto-deny the action.
    await tx
      .update(actions)
      .set({
        status: 'rejected',
        metadataJson: sql`coalesce(${actions.metadataJson}, '{}'::jsonb) || ${JSON.stringify({ autoDenyReason: 'policy_changed' })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(actions.id, approvalActionId));
    throw {
      statusCode: 409,
      message: 'Policy changed since promotion was requested. Please re-initiate the promotion.',
      errorCode: 'policy_changed',
    };
  }

  const transition = resolvePromotionTransition(policy.mode);
  if (!transition.valid) {
    throw {
      statusCode: 409,
      message: 'Policy is already live.',
      errorCode: transition.reason,
    };
  }

  const newVersion = incrementPolicyVersion(policy.version);

  const [updated] = await tx
    .update(spendingPolicies)
    .set({ mode: 'live', version: newVersion, updatedAt: new Date() })
    .where(
      and(
        eq(spendingPolicies.spendingBudgetId, budgetId),
        eq(spendingPolicies.organisationId, organisationId),
        eq(spendingPolicies.version, policy.version), // optimistic CAS
      ),
    )
    .returning();

  if (!updated) {
    throw {
      statusCode: 409,
      message: 'Promotion failed — concurrent policy update detected.',
      errorCode: 'concurrent_update',
    };
  }

  await auditService.log({
    organisationId,
    actorId: approvalActionId,
    actorType: 'system',
    action: 'spending_policy_promoted_to_live',
    entityType: 'spending_policy',
    entityId: updated.id,
    metadata: { budgetId, previousVersion: policy.version, newVersion, approvalActionId },
  });

  logger.info('spendingBudgetService.promoteToLive_completed', {
    budgetId,
    policyId: updated.id,
    previousVersion: policy.version,
    newVersion,
    approvalActionId,
  });

  return updated;
}

export const spendingBudgetService = {
  create,
  update,
  getById,
  listForOrg,
  listForSubaccount,
  getPolicyByBudgetId,
  updatePolicy,
  requestPromotion,
  promoteToLive,
};
