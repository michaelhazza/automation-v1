// ---------------------------------------------------------------------------
// approvalChannelService — approval channel orchestrator (impure)
//
// Owns the approval state machine fan-out and channel lifecycle.
// Does NOT own the HITL queue — that stays with actionService/reviewService.
// Does NOT write to agent_charges directly — that stays with chargeRouterService.
//
// Responsibilities:
//   - Active-approval guard (one pending actions row per chargeId)
//   - Fan-out to eligible channels on requestApproval
//   - First-response-wins resolution via chargeRouterService.resolveApproval
//   - "Resolved by Y at T" notification to losing channels (best-effort)
//   - Grant/revoke lifecycle for org_subaccount_channel_grants
//   - Audit logging of grant/revoke events
//   - spending_budget_approvers CRUD
//
// Spec: tasks/builds/agentic-commerce/spec.md §11.1, §13.2, §13.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 9
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { eq, and, sql, asc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { actions } from '../db/schema/index.js';
import { spendingBudgetApprovers } from '../db/schema/spendingBudgetApprovers.js';
import { orgSubaccountChannelGrants } from '../db/schema/orgSubaccountChannelGrants.js';
import { subaccountApprovalChannels } from '../db/schema/subaccountApprovalChannels.js';
import { orgApprovalChannels } from '../db/schema/orgApprovalChannels.js';
import { subaccounts } from '../db/schema/subaccounts.js';
import { resolveApproval as chargeRouterResolveApproval } from './chargeRouterService.js';
import { promoteToLive } from './spendingBudgetService.js';
import { auditService } from './auditService.js';
import { logger } from '../lib/logger.js';
import {
  collectEligibleChannels,
  validateGrantTransition,
  type SubaccountChannel,
  type OrgChannel,
  type ActiveGrant,
} from './approvalChannelServicePure.js';
import { InAppApprovalChannel } from './approvalChannels/InAppApprovalChannel.js';
import type {
  ApprovalRequest,
  ApprovalResolution,
  ApprovalChannel,
} from '../../shared/types/approvalChannel.js';

// ---------------------------------------------------------------------------
// Channel registry — open/closed: add one entry per new adapter file
// ---------------------------------------------------------------------------

const CHANNEL_ADAPTERS: ApprovalChannel[] = [
  new InAppApprovalChannel(),
];

function getAdapter(channelType: string): ApprovalChannel | undefined {
  return CHANNEL_ADAPTERS.find((a) => a.channelType === channelType);
}

// ---------------------------------------------------------------------------
// uuidToBigint — advisory lock key derivation (mirrors chargeRouterService)
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
// requestApproval
//
// Active-approval guard + channel fan-out.
// Returns the existing actionId if one is already pending for this chargeId.
// ---------------------------------------------------------------------------

export async function requestApproval(
  req: ApprovalRequest & { traceId: string },
): Promise<{ actionId: string }> {
  const { chargeId, subaccountId, organisationId } = req;

  // Active-approval guard under advisory lock keyed on chargeId (belt-and-braces
  // on top of the agent_charges idempotency_key UNIQUE constraint).
  const lockId = uuidToBigint(chargeId);
  const tx = getOrgScopedDb('approvalChannelService.requestApproval');

  await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(lockId)})`);

  const [existing] = await tx
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        sql`${actions.metadataJson}->>'chargeId' = ${chargeId}`,
        sql`${actions.metadataJson}->>'category' = 'spend'`,
        eq(actions.status, 'pending_approval'),
      ),
    )
    .limit(1);

  if (existing) {
    return { actionId: existing.id };
  }

  // Collect eligible channels.
  const subaccountChannelRows = subaccountId
    ? await tx
        .select()
        .from(subaccountApprovalChannels)
        .where(
          and(
            eq(subaccountApprovalChannels.subaccountId, subaccountId),
            eq(subaccountApprovalChannels.organisationId, organisationId),
          ),
        )
    : [];

  const orgChannelRows = await tx
    .select()
    .from(orgApprovalChannels)
    .where(eq(orgApprovalChannels.organisationId, organisationId));

  const grantRows = subaccountId
    ? await tx
        .select()
        .from(orgSubaccountChannelGrants)
        .where(
          and(
            eq(orgSubaccountChannelGrants.subaccountId, subaccountId),
            eq(orgSubaccountChannelGrants.organisationId, organisationId),
            eq(orgSubaccountChannelGrants.active, true),
          ),
        )
    : [];

    const subaccountChannels: SubaccountChannel[] = subaccountChannelRows.map((r) => ({
      id: r.id,
      channelType: r.channelType,
      enabled: r.enabled,
      config: r.config,
    }));

    const orgChannels: OrgChannel[] = orgChannelRows.map((r) => ({
      id: r.id,
      channelType: r.channelType,
      enabled: r.enabled,
      config: r.config,
      organisationId: r.organisationId,
    }));

    const activeGrants: ActiveGrant[] = grantRows.map((g) => ({
      id: g.id,
      orgChannelId: g.orgChannelId,
      subaccountId: g.subaccountId,
      active: g.active,
    }));

    const targets = collectEligibleChannels(subaccountChannels, orgChannels, activeGrants);

    if (targets.length === 0) {
      logger.warn('approvalChannelService.requestApproval_no_eligible_channels', {
        actionId: req.actionId,
        chargeId,
      });
    }

    // Fan-out to all eligible channels. Collect failures; if all fail, mark action failed.
    const failures: Array<{ channelType: string; error: string }> = [];

    await Promise.all(
      targets.map(async (target) => {
        const adapter = getAdapter(target.channelType);
        if (!adapter) {
          logger.warn('approvalChannelService.no_adapter_for_channel_type', {
            channelType: target.channelType,
          });
          failures.push({ channelType: target.channelType, error: 'no_adapter' });
          return;
        }
        try {
          await adapter.sendApprovalRequest(req);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('approvalChannelService.channel_dispatch_failed', {
            channelType: target.channelType,
            actionId: req.actionId,
            error: message,
          });
          failures.push({ channelType: target.channelType, error: message });
        }
      }),
    );

    // If all channels failed, mark the action failed with a structured reason.
    if (targets.length > 0 && failures.length === targets.length) {
      logger.error('approvalChannelService.all_channels_failed_critical', {
        actionId: req.actionId,
        chargeId,
        channelCount: targets.length,
      });
      await tx
        .update(actions)
        .set({
          status: 'failed',
          metadataJson: sql`coalesce(${actions.metadataJson}, '{}'::jsonb) || ${JSON.stringify({ failureReason: 'channel_dispatch_failed' })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(actions.id, req.actionId));
    }

    return { actionId: req.actionId };
}

// ---------------------------------------------------------------------------
// resolveApproval — routes by actionType; delegates to the appropriate handler
// ---------------------------------------------------------------------------

export async function resolveApproval(
  actionId: string,
  decision: 'approved' | 'denied',
  context: { organisationId: string; responderId: string; traceId: string },
): Promise<{ status: 'resolved' | 'superseded' }> {
  const tx = getOrgScopedDb('approvalChannelService.resolveApproval');
  // Peek at the action type to route to the correct resolver.
  const [actionRow] = await tx
    .select({ actionType: actions.actionType, metadataJson: actions.metadataJson, status: actions.status })
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.organisationId, context.organisationId)))
    .limit(1);

  if (!actionRow) {
    return { status: 'superseded' };
  }

  if (actionRow.actionType === 'promote_spending_policy_to_live') {
    if (actionRow.status !== 'pending_approval') {
      return { status: 'superseded' };
    }

    const metadata = actionRow.metadataJson as Record<string, unknown> | null;
    const budgetId = metadata && typeof metadata['spendingBudgetId'] === 'string'
      ? (metadata['spendingBudgetId'] as string)
      : null;

    if (!budgetId) {
      logger.warn('approvalChannelService.resolveApproval_promotion_missing_budget', { actionId });
      return { status: 'superseded' };
    }

    // Mark action status first (optimistic CAS).
    const [updated] = await tx
      .update(actions)
      .set({
        status: decision === 'approved' ? 'completed' : 'rejected',
        approvedBy: decision === 'approved' ? context.responderId : undefined,
        approvedAt: decision === 'approved' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(actions.id, actionId), eq(actions.status, 'pending_approval')))
      .returning({ id: actions.id });

    if (!updated) {
      // Another responder already resolved it.
      return { status: 'superseded' };
    }

    if (decision === 'approved') {
      try {
        await promoteToLive(budgetId, actionId, context.organisationId);
      } catch (err) {
        logger.error('approvalChannelService.resolveApproval_promotion_failed', {
          actionId,
          budgetId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Re-throw — caller handles the error; action is already marked completed
        // but promoteToLive may have thrown due to drift (policy_changed) in which
        // case the action row remains completed with the auto-deny recorded inside
        // promoteToLive itself. Safe to surface the error.
        throw err;
      }
    }

    return { status: 'resolved' };
  }

  // Default: delegate to chargeRouterService for spend-charge approvals.
  return chargeRouterResolveApproval(actionId, decision, context);
}

// ---------------------------------------------------------------------------
// notifyResolution — fan-out to losing channels (best-effort)
// ---------------------------------------------------------------------------

export async function notifyResolution(resolution: ApprovalResolution): Promise<void> {
  // In v1 there is only one channel type; notify all registered adapters that
  // have a sendResolutionNotice implementation. Failures are logged and swallowed.
  await Promise.all(
    CHANNEL_ADAPTERS.map(async (adapter) => {
      try {
        await adapter.sendResolutionNotice(resolution);
      } catch (err) {
        logger.warn('approvalChannelService.resolution_notice_failed', {
          channelType: adapter.channelType,
          actionId: resolution.actionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// spending_budget_approvers CRUD
// ---------------------------------------------------------------------------

export async function addApprover(
  spendingBudgetId: string,
  userId: string,
  organisationId: string,
): Promise<void> {
  await getOrgScopedDb('approvalChannelService.addApprover')
    .insert(spendingBudgetApprovers)
    .values({
      id: randomUUID(),
      organisationId,
      spendingBudgetId,
      userId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function removeApprover(
  spendingBudgetId: string,
  userId: string,
  organisationId: string,
): Promise<void> {
  await getOrgScopedDb('approvalChannelService.removeApprover')
    .delete(spendingBudgetApprovers)
    .where(
      and(
        eq(spendingBudgetApprovers.spendingBudgetId, spendingBudgetId),
        eq(spendingBudgetApprovers.userId, userId),
        eq(spendingBudgetApprovers.organisationId, organisationId),
      ),
    );
}

// ---------------------------------------------------------------------------
// org_subaccount_channel_grants CRUD
// ---------------------------------------------------------------------------

/**
 * Idempotent — re-granting the same (orgChannelId, subaccountId) pair returns
 * the existing active grant id rather than inserting a duplicate. Protects
 * against double-clicks, retries, and network replays. Backed by the partial
 * UNIQUE index `org_subaccount_channel_grants_active_unique` (migration 0275).
 *
 * Flow:
 *   1. Fast path — SELECT for an active grant on the pair; if found, return its id.
 *   2. Slow path — INSERT a new active row.
 *   3. Race path — if the INSERT raises a unique-violation (PG 23505) because
 *      a concurrent caller inserted between our SELECT and INSERT, re-SELECT
 *      and return that grant's id.
 */
export async function addGrant(
  orgChannelId: string,
  subaccountId: string,
  organisationId: string,
  grantedByUserId: string,
): Promise<{ grantId: string }> {
  const tx = getOrgScopedDb('approvalChannelService.addGrant');

  const findActiveGrantId = async (): Promise<string | null> => {
    const [row] = await tx
      .select({ id: orgSubaccountChannelGrants.id })
      .from(orgSubaccountChannelGrants)
      .where(
        and(
          eq(orgSubaccountChannelGrants.orgChannelId, orgChannelId),
          eq(orgSubaccountChannelGrants.subaccountId, subaccountId),
          eq(orgSubaccountChannelGrants.organisationId, organisationId),
          eq(orgSubaccountChannelGrants.active, true),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  };

  const existingId = await findActiveGrantId();
  if (existingId) {
    return { grantId: existingId };
  }

  const id = randomUUID();

  try {
    await tx.insert(orgSubaccountChannelGrants).values({
      id,
      organisationId,
      subaccountId,
      orgChannelId,
      grantedByUserId,
      active: true,
      createdAt: new Date(),
    });
  } catch (err) {
    const isUniqueViolation =
      err instanceof Error && /duplicate key|unique constraint|23505/.test(err.message);
    if (!isUniqueViolation) throw err;

    const raceWinnerId = await findActiveGrantId();
    if (raceWinnerId) {
      return { grantId: raceWinnerId };
    }
    throw err;
  }

  await auditService.log({
    organisationId,
    actorId: grantedByUserId,
    actorType: 'user',
    action: 'approval_channel_grant_added',
    entityType: 'org_subaccount_channel_grant',
    entityId: id,
    metadata: { orgChannelId, subaccountId },
  });

  return { grantId: id };
}

export async function revokeGrant(
  grantId: string,
  organisationId: string,
  revokedByUserId: string,
): Promise<void> {
  const tx = getOrgScopedDb('approvalChannelService.revokeGrant');
  const [current] = await tx
    .select({ id: orgSubaccountChannelGrants.id, active: orgSubaccountChannelGrants.active })
    .from(orgSubaccountChannelGrants)
    .where(
      and(
        eq(orgSubaccountChannelGrants.id, grantId),
        eq(orgSubaccountChannelGrants.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!current) {
    throw Object.assign(new Error('Grant not found'), { statusCode: 404 });
  }

  const transition = validateGrantTransition(
    current.active ? 'active' : 'revoked',
    'revoked',
  );

  if (!transition.valid) {
    throw Object.assign(new Error(`Invalid grant transition: ${transition.reason}`), { statusCode: 409 });
  }

  await tx
    .update(orgSubaccountChannelGrants)
    .set({ active: false, revokedAt: new Date() })
    .where(eq(orgSubaccountChannelGrants.id, grantId));

  await auditService.log({
    organisationId,
    actorId: revokedByUserId,
    actorType: 'user',
    action: 'approval_channel_grant_revoked',
    entityType: 'org_subaccount_channel_grant',
    entityId: grantId,
    metadata: { grantId },
  });
}

/**
 * List active grants for an org. Returns the grant row joined with its
 * org channel and target sub-account so the client can render display
 * strings without per-row follow-up fetches. Deterministic ORDER BY on
 * `(orgApprovalChannels.channelType ASC, subaccounts.name ASC)` — the
 * UI relies on stable ordering across mutations to avoid flicker, and
 * `org_approval_channels` has no `name` column (channelType is the
 * canonical identifier in v1; channels are grouped by type).
 *
 * Only `active = true` rows are returned. Revoked rows are preserved
 * for audit but never surfaced to the management UI.
 */
export async function listGrants(organisationId: string): Promise<Array<{
  id: string;
  orgChannelId: string;
  subaccountId: string;
  orgChannel: { id: string; channelType: string };
  subaccount: { id: string; name: string };
}>> {
  return getOrgScopedDb('approvalChannelService.listGrants')
    .select({
      id: orgSubaccountChannelGrants.id,
      orgChannelId: orgSubaccountChannelGrants.orgChannelId,
      subaccountId: orgSubaccountChannelGrants.subaccountId,
      orgChannel: {
        id: orgApprovalChannels.id,
        channelType: orgApprovalChannels.channelType,
      },
      subaccount: {
        id: subaccounts.id,
        name: subaccounts.name,
      },
    })
    .from(orgSubaccountChannelGrants)
    .innerJoin(
      orgApprovalChannels,
      eq(orgApprovalChannels.id, orgSubaccountChannelGrants.orgChannelId),
    )
    .innerJoin(
      subaccounts,
      eq(subaccounts.id, orgSubaccountChannelGrants.subaccountId),
    )
    .where(
      and(
        eq(orgSubaccountChannelGrants.organisationId, organisationId),
        eq(orgSubaccountChannelGrants.active, true),
      ),
    )
    .orderBy(asc(orgApprovalChannels.channelType), asc(subaccounts.name));
}

// ---------------------------------------------------------------------------
// Channel CRUD — used by approvalChannels route
// ---------------------------------------------------------------------------

export async function createSubaccountChannel(values: {
  id: string;
  organisationId: string;
  subaccountId: string;
  channelType: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Promise<typeof subaccountApprovalChannels.$inferSelect> {
  const [channel] = await getOrgScopedDb('approvalChannelService.createSubaccountChannel')
    .insert(subaccountApprovalChannels)
    .values(values)
    .returning();
  return channel;
}

export async function listSubaccountChannels(
  subaccountId: string,
  organisationId: string,
): Promise<typeof subaccountApprovalChannels.$inferSelect[]> {
  return getOrgScopedDb('approvalChannelService.listSubaccountChannels')
    .select()
    .from(subaccountApprovalChannels)
    .where(and(
      eq(subaccountApprovalChannels.subaccountId, subaccountId),
      eq(subaccountApprovalChannels.organisationId, organisationId),
    ));
}

export async function updateSubaccountChannel(
  channelId: string,
  subaccountId: string,
  organisationId: string,
  fields: { channelType?: string; config?: Record<string, unknown>; enabled?: boolean },
): Promise<typeof subaccountApprovalChannels.$inferSelect | null> {
  const tx = getOrgScopedDb('approvalChannelService.updateSubaccountChannel');
  const [updated] = await tx
    .update(subaccountApprovalChannels)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(
      eq(subaccountApprovalChannels.id, channelId),
      eq(subaccountApprovalChannels.subaccountId, subaccountId),
      eq(subaccountApprovalChannels.organisationId, organisationId),
    ))
    .returning();
  return updated ?? null;
}

export async function deleteSubaccountChannel(
  channelId: string,
  subaccountId: string,
  organisationId: string,
): Promise<typeof subaccountApprovalChannels.$inferSelect | null> {
  const tx = getOrgScopedDb('approvalChannelService.deleteSubaccountChannel');
  const [deleted] = await tx
    .delete(subaccountApprovalChannels)
    .where(and(
      eq(subaccountApprovalChannels.id, channelId),
      eq(subaccountApprovalChannels.subaccountId, subaccountId),
      eq(subaccountApprovalChannels.organisationId, organisationId),
    ))
    .returning();
  return deleted ?? null;
}

export async function createOrgChannel(values: {
  id: string;
  organisationId: string;
  channelType: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Promise<typeof orgApprovalChannels.$inferSelect> {
  const [channel] = await getOrgScopedDb('approvalChannelService.createOrgChannel')
    .insert(orgApprovalChannels)
    .values(values)
    .returning();
  return channel;
}

export async function listOrgChannels(
  organisationId: string,
): Promise<typeof orgApprovalChannels.$inferSelect[]> {
  return getOrgScopedDb('approvalChannelService.listOrgChannels')
    .select()
    .from(orgApprovalChannels)
    .where(eq(orgApprovalChannels.organisationId, organisationId));
}

export async function updateOrgChannel(
  channelId: string,
  organisationId: string,
  fields: { channelType?: string; config?: Record<string, unknown>; enabled?: boolean },
): Promise<typeof orgApprovalChannels.$inferSelect | null> {
  const tx = getOrgScopedDb('approvalChannelService.updateOrgChannel');
  const [updated] = await tx
    .update(orgApprovalChannels)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(
      eq(orgApprovalChannels.id, channelId),
      eq(orgApprovalChannels.organisationId, organisationId),
    ))
    .returning();
  return updated ?? null;
}

export async function deleteOrgChannel(
  channelId: string,
  organisationId: string,
): Promise<typeof orgApprovalChannels.$inferSelect | null> {
  const tx = getOrgScopedDb('approvalChannelService.deleteOrgChannel');
  const [deleted] = await tx
    .delete(orgApprovalChannels)
    .where(and(
      eq(orgApprovalChannels.id, channelId),
      eq(orgApprovalChannels.organisationId, organisationId),
    ))
    .returning();
  return deleted ?? null;
}
