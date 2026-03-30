/**
 * Integration connection routes — subaccount-scoped.
 * Manages OAuth/API key connections per subaccount.
 */

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections } from '../db/schema/index.js';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { connectionTokenService } from '../services/connectionTokenService.js';

const router = Router();

function sanitizeConnection(conn: typeof integrationConnections.$inferSelect) {
  const { accessToken, refreshToken, secretsRef, ...rest } = conn;
  return {
    ...rest,
    hasAccessToken: !!accessToken,
    hasRefreshToken: !!refreshToken,
    hasSecretsRef: !!secretsRef,
  };
}

// List connections for a subaccount
router.get(
  '/api/subaccounts/:subaccountId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await db.select()
      .from(integrationConnections)
      .where(eq(integrationConnections.subaccountId, subaccount.id));
    res.json(rows.map(sanitizeConnection));
  })
);

// Create connection
router.post(
  '/api/subaccounts/:subaccountId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { providerType, authType, label, displayName, configJson, accessToken, refreshToken, tokenExpiresAt, secretsRef } = req.body;

    if (!providerType || !authType) {
      throw { statusCode: 400, message: 'providerType and authType are required' };
    }

    // Encrypt tokens before storage
    const encryptedAccess = accessToken ? connectionTokenService.encryptToken(accessToken) : null;
    const encryptedRefresh = refreshToken ? connectionTokenService.encryptToken(refreshToken) : null;
    const encryptedSecret = secretsRef ? connectionTokenService.encryptToken(secretsRef) : null;

    const [connection] = await db.insert(integrationConnections).values({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      providerType,
      authType,
      label: label ?? null,
      displayName: displayName ?? null,
      configJson: configJson ?? null,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
      secretsRef: encryptedSecret,
      connectionStatus: 'active',
    }).returning();

    res.status(201).json(sanitizeConnection(connection));
  })
);

// Get single connection
router.get(
  '/api/subaccounts/:subaccountId/connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [connection] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.subaccountId, subaccount.id)
      ));

    if (!connection) throw { statusCode: 404, message: 'Connection not found' };
    res.json(sanitizeConnection(connection));
  })
);

// Update connection (label, status, tokens)
router.patch(
  '/api/subaccounts/:subaccountId/connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [existing] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.subaccountId, subaccount.id)
      ));

    if (!existing) throw { statusCode: 404, message: 'Connection not found' };

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (req.body.label !== undefined) updates.label = req.body.label;
    if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
    if (req.body.connectionStatus !== undefined) updates.connectionStatus = req.body.connectionStatus;
    if (req.body.configJson !== undefined) updates.configJson = req.body.configJson;

    // Re-encrypt if new tokens provided
    if (req.body.accessToken) updates.accessToken = connectionTokenService.encryptToken(req.body.accessToken);
    if (req.body.refreshToken) updates.refreshToken = connectionTokenService.encryptToken(req.body.refreshToken);
    if (req.body.tokenExpiresAt) updates.tokenExpiresAt = new Date(req.body.tokenExpiresAt);
    if (req.body.secretsRef) updates.secretsRef = connectionTokenService.encryptToken(req.body.secretsRef);

    const [updated] = await db.update(integrationConnections)
      .set(updates)
      .where(eq(integrationConnections.id, req.params.id))
      .returning();

    res.json(sanitizeConnection(updated));
  })
);

// Revoke (delete) connection
router.delete(
  '/api/subaccounts/:subaccountId/connections/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [existing] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.subaccountId, subaccount.id)
      ));

    if (!existing) throw { statusCode: 404, message: 'Connection not found' };

    // Revoke rather than hard delete — keeps audit trail
    await db.update(integrationConnections)
      .set({ connectionStatus: 'revoked', accessToken: null, refreshToken: null, updatedAt: new Date() })
      .where(eq(integrationConnections.id, req.params.id));

    res.json({ success: true });
  })
);

export default router;
