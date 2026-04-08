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

// Fetch Slack channel list using the stored bot token.
// Returns [{id, name}] sorted alphabetically so the UI can render a searchable dropdown.
router.get(
  '/api/subaccounts/:subaccountId/connections/:id/slack-channels',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [conn] = await db.select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.subaccountId, subaccount.id),
        eq(integrationConnections.providerType, 'slack'),
      ));

    if (!conn) throw { statusCode: 404, message: 'Slack connection not found' };
    if (!conn.accessToken) throw { statusCode: 422, message: 'Slack connection has no token — reconnect first' };

    const token = connectionTokenService.decryptToken(conn.accessToken);

    // Fetch all channels (public + private the bot is a member of), paginating up to 500.
    const channels: { id: string; name: string }[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        types: 'public_channel',
        exclude_archived: 'true',
        limit: '200',
      });
      if (cursor) params.set('cursor', cursor);

      const response = await fetch(`https://slack.com/api/conversations.list?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });

      const data = await response.json() as {
        ok: boolean;
        channels?: { id: string; name: string }[];
        response_metadata?: { next_cursor?: string };
        error?: string;
      };

      if (!data.ok) {
        throw { statusCode: 502, message: `Slack API error: ${data.error ?? 'unknown'}` };
      }

      for (const ch of data.channels ?? []) {
        channels.push({ id: ch.id, name: ch.name });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor && channels.length < 500);

    channels.sort((a, b) => a.name.localeCompare(b.name));
    res.json(channels);
  })
);

export default router;
