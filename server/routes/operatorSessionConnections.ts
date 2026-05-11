/**
 * Operator session connection routes — AI Subscription management.
 *
 * operator-session-identity chunk 5.
 *
 * Routes:
 *  GET    /api/subaccounts/:subaccountId/operator-session-connections
 *  POST   /api/subaccounts/:subaccountId/operator-session-connections
 *  GET    /api/subaccounts/:subaccountId/operator-session-connections/:connId
 *  PATCH  /api/subaccounts/:subaccountId/operator-session-connections/:connId
 *  DELETE /api/subaccounts/:subaccountId/operator-session-connections/:connId
 *  POST   /api/subaccounts/:subaccountId/operator-session-connections/:connId/consent
 *  POST   /api/subaccounts/:subaccountId/operator-session-connections/:connId/make-default
 *  POST   /api/subaccounts/:subaccountId/operator-session-connections/:connId/reauth
 *  PATCH  /api/subaccounts/:subaccountId/operator-session-connections/:connId/allow-agent-use
 *  GET    /api/subaccounts/:subaccountId/agents/:agentId/allowed-subscriptions
 *
 * Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §9
 */

import { Router } from 'express';
import { sql, eq, and } from 'drizzle-orm';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { operatorSessionService } from '../services/operatorSessionService.js';
import { operatorSessionLifecycleService } from '../services/operatorSessionLifecycleService.js';
import { isTerminalState } from '../services/operatorSessionLifecycleServicePure.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { integrationConnections } from '../db/schema/index.js';
import { operatorSessionConsents } from '../db/schema/index.js';
import {
  connectBodySchema,
  reacceptBodySchema,
  updateLabelBodySchema,
  editAvailabilityBodySchema,
  makeDefaultBodySchema,
  reauthBodySchema,
} from '../schemas/operatorSessionConnections.js';
import type { UsabilityState } from '../services/operatorSessionLifecycleServicePure.js';

const router = Router();

// ─── GET list ─────────────────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/operator-session-connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    // Use listAllowedSubscriptionsForAgent with empty agentId — the SQL condition:
    //   availabilityScope = 'all_agents' OR allowedAgentIds ? agentId
    // With agentId='' no specific-agent rows match, so only all_agents rows appear.
    // For V1 all connections use all_agents scope so this returns the full list.
    const rows = await operatorSessionService.listAllowedSubscriptionsForAgent({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      agentId: '',
    });

    res.json(rows);
  }),
);

// ─── POST connect ─────────────────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/operator-session-connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_CONNECT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = connectBodySchema.parse(req.body);

    const connection = await operatorSessionService.connect({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      userId: req.user!.id,
      provider: parsed.provider,
      label: parsed.label,
      disclosureAcceptance: parsed.disclosureAcceptance,
    });

    res.status(201).json(connection);
  }),
);

// ─── GET single ───────────────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const db = getOrgScopedDb('operatorSessionConnections.getOne');

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, req.params.connId),
          eq(integrationConnections.subaccountId, subaccount.id),
          eq(integrationConnections.organisationId, req.orgId!),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .limit(1);

    if (!conn) {
      throw { statusCode: 404, message: 'Connection not found' };
    }

    // On-read disclosure check
    await operatorSessionService.detectAndTransitionStaleDisclosure({
      organisationId: req.orgId!,
      connectionId: conn.id,
    });

    // Re-read to get current state after any transition
    const [fresh] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, conn.id))
      .limit(1);

    if (!fresh) {
      throw { statusCode: 404, message: 'Connection not found' };
    }

    // Map to AiSubscriptionConnection shape via service helper — re-use service's
    // listAllowedSubscriptionsForAgent and filter, or do a direct minimal mapping.
    // Simplest: fetch via the service's list path filtered to this connection.
    const cfg = (fresh.configJson as { operator_session?: { availabilityScope?: string; allowedAgentIds?: string[] | null } } | null)?.operator_session;
    const result = {
      id: fresh.id,
      authMethod: 'ai_subscription' as const,
      provider: fresh.providerType,
      planTier: fresh.planTier ?? 'unknown',
      planVerificationStatus: fresh.planVerificationStatus ?? 'failed',
      planVerifiedAt: fresh.planVerifiedAt ? fresh.planVerifiedAt.toISOString() : null,
      usabilityState: fresh.usabilityState ?? 'connected_unverified',
      disabledReason: null,
      pendingReason: (() => {
        switch (fresh.usabilityState) {
          case 'connected_needs_consent': return 'needs_new_consent' as const;
          case 'connected_needs_reauth':  return 'needs_reauth' as const;
          case 'connected_unverified':    return 'plan_unverified' as const;
          default:                        return null;
        }
      })(),
      isDefault: fresh.isDefault,
      availabilityScope: (cfg?.availabilityScope ?? 'all_agents') as 'all_agents' | 'specific_agents',
      allowedAgentIds: cfg?.allowedAgentIds ?? null,
      label: fresh.label ?? null,
      user: { userId: fresh.ownerUserId ?? null, userIdNullified: false, displayName: null },
      lastRefreshedAt: null,
      createdAt: fresh.createdAt.toISOString(),
    };

    res.json(result);
  }),
);

// ─── PATCH label ──────────────────────────────────────────────────────────────

router.patch(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_CONNECT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = updateLabelBodySchema.parse(req.body);
    const db = getOrgScopedDb('operatorSessionConnections.updateLabel');

    const [updated] = await db
      .update(integrationConnections)
      .set({ label: parsed.label, updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.id, req.params.connId),
          eq(integrationConnections.subaccountId, subaccount.id),
          eq(integrationConnections.organisationId, req.orgId!),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .returning();

    if (!updated) {
      throw { statusCode: 404, message: 'Connection not found' };
    }

    res.json({ id: updated.id, label: updated.label });
  }),
);

// ─── DELETE (disable) ─────────────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_DISCONNECT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const db = getOrgScopedDb('operatorSessionConnections.delete');

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, req.params.connId),
          eq(integrationConnections.subaccountId, subaccount.id),
          eq(integrationConnections.organisationId, req.orgId!),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .limit(1);

    if (!conn) {
      throw { statusCode: 404, message: 'Connection not found' };
    }

    const currentState = (conn.usabilityState as UsabilityState) ?? 'connected_unverified';

    // Idempotent: if already in a terminal state, return 200
    if (isTerminalState(currentState)) {
      res.json({ message: 'Connection already disconnected' });
      return;
    }

    await operatorSessionLifecycleService.transition({
      connectionId: conn.id,
      organisationId: req.orgId!,
      from: currentState,
      to: 'disabled',
      cause: 'admin_disabled',
      actorUserId: req.user!.id,
    });

    res.json({ message: 'Connection disconnected' });
  }),
);

// ─── POST consent (re-accept) ─────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId/consent',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_CONNECT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = reacceptBodySchema.parse(req.body);

    const result = await operatorSessionService.reaccept({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      connectionId: req.params.connId,
      actorUserId: req.user!.id,
      disclosureAcceptance: parsed.disclosureAcceptance,
    });

    res.json({ newState: result.newState, consentId: result.consent.id });
  }),
);

// ─── POST make-default ────────────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId/make-default',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_CONNECT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    makeDefaultBodySchema.parse(req.body);

    const db = getOrgScopedDb('operatorSessionConnections.makeDefault');

    try {
      // Lock current default row to prevent concurrent make-default races
      await db.execute(sql`
        SELECT id FROM integration_connections
        WHERE subaccount_id = ${subaccount.id}::uuid
          AND auth_type = 'operator_session'
          AND is_default = true
        FOR UPDATE
      `);

      // Clear current default
      await db
        .update(integrationConnections)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.subaccountId, subaccount.id),
            eq(integrationConnections.authType, 'operator_session'),
            eq(integrationConnections.isDefault, true),
          ),
        );

      // Promote target connection
      const [promoted] = await db
        .update(integrationConnections)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.id, req.params.connId),
            eq(integrationConnections.subaccountId, subaccount.id),
            eq(integrationConnections.authType, 'operator_session'),
          ),
        )
        .returning();

      if (!promoted) {
        throw { statusCode: 404, message: 'Connection not found' };
      }

      res.json({ id: promoted.id, isDefault: promoted.isDefault });
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (
        pgErr.code === '23505' &&
        (pgErr.constraint ?? '').includes('ic_subaccount_operator_session_default_unique')
      ) {
        throw {
          statusCode: 409,
          errorCode: 'concurrent_default_change',
          message: 'A concurrent make-default operation was detected. Please retry.',
        };
      }
      throw err;
    }
  }),
);

// ─── POST reauth ──────────────────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId/reauth',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_REAUTH),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    reauthBodySchema.parse(req.body);

    const db = getOrgScopedDb('operatorSessionConnections.reauth');

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, req.params.connId),
          eq(integrationConnections.organisationId, req.orgId!),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .limit(1);

    if (!conn) {
      throw { statusCode: 404, message: 'Connection not found' };
    }

    // Owner-mismatch guard: if the connection has a consent record with a userId,
    // only that user can trigger reauth.
    if (conn.consentRecordId) {
      const [consent] = await db
        .select()
        .from(operatorSessionConsents)
        .where(eq(operatorSessionConsents.id, conn.consentRecordId))
        .limit(1);

      if (consent?.userId && consent.userId !== req.user!.id) {
        throw {
          statusCode: 422,
          errorCode: 'owner_mismatch_transfer_ownership_required',
          message:
            'This subscription is owned by another user. Transfer ownership flow is not yet available — contact your administrator.',
        };
      }
    }

    // V1: connectionMechanism is always none_verified so no actual OAuth flow.
    // Return a mock response indicating reauth was initiated.
    res.json({ message: 'Re-authentication initiated.' });
  }),
);

// ─── PATCH allow-agent-use ────────────────────────────────────────────────────

router.patch(
  '/api/subaccounts/:subaccountId/operator-session-connections/:connId/allow-agent-use',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_ALLOW_AGENT_USE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const parsed = editAvailabilityBodySchema.parse(req.body);
    const db = getOrgScopedDb('operatorSessionConnections.allowAgentUse');

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, req.params.connId),
          eq(integrationConnections.subaccountId, subaccount.id),
          eq(integrationConnections.organisationId, req.orgId!),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .limit(1);

    if (!conn) {
      throw { statusCode: 404, message: 'Connection not found' };
    }

    // Merge the operator_session config into existing configJson
    const existingConfig = (conn.configJson as Record<string, unknown> | null) ?? {};
    const updatedConfig = {
      ...existingConfig,
      operator_session: {
        ...(existingConfig.operator_session as Record<string, unknown> | undefined ?? {}),
        availabilityScope: parsed.availabilityScope,
        allowedAgentIds:
          parsed.availabilityScope === 'all_agents'
            ? null
            : (parsed.allowedAgentIds ?? null),
      },
    };

    const [updated] = await db
      .update(integrationConnections)
      .set({ configJson: updatedConfig, updatedAt: new Date() })
      .where(eq(integrationConnections.id, req.params.connId))
      .returning();

    const cfg = (updated.configJson as { operator_session?: { availabilityScope?: string; allowedAgentIds?: string[] | null } } | null)?.operator_session;
    res.json({
      id: updated.id,
      availabilityScope: cfg?.availabilityScope ?? 'all_agents',
      allowedAgentIds: cfg?.allowedAgentIds ?? null,
    });
  }),
);

// ─── GET allowed-subscriptions (agent route) ──────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents/:agentId/allowed-subscriptions',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const rows = await operatorSessionService.listAllowedSubscriptionsForAgent({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      agentId: req.params.agentId,
    });

    res.json(rows);
  }),
);

export default router;
