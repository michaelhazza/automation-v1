/**
 * Integration connection routes — subaccount-scoped.
 * Manages OAuth/API key connections per subaccount.
 * Org-level connection routes live in orgConnections.ts.
 */

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { integrationConnections } from '../db/schema/index.js';
import { authenticate, requireSubaccountPermission, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS, ORG_PERMISSIONS } from '../lib/permissions.js';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { credentialBrokerService } from '../services/credentialBrokerService.js';
import { listConnections, getConnectionUsage, disconnectConnection } from '../services/connectionsService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      .where(and(
        eq(integrationConnections.id, req.params.id),
        eq(integrationConnections.subaccountId, subaccount.id),
      ))
      .returning();
    if (!updated) throw { statusCode: 404, message: 'Connection not found' };
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

    await credentialBrokerService.revoke({
      organisationId: req.orgId!,
      credentialId: req.params.id,
      subaccountId: subaccount.id,
    });

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

// ── Govern surface: unified connections list (org scope) ─────────────────────

router.get(
  '/api/connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const querySchema = z.object({
      scope: z.enum(['workspace', 'org']).optional(),
      subaccountId: z.string().uuid().optional(),
      authMethod: z.enum(['oauth', 'api_key', 'web_login', 'mcp', 'cookie']).optional(),
      status: z.enum(['connected', 'expired', 'failed', 'pending']).optional(),
      q: z.string().trim().min(1).max(200).optional(),
    }).refine(
      (q) => q.scope !== 'workspace' || !!q.subaccountId,
      { message: 'subaccountId is required when scope=workspace', path: ['subaccountId'] },
    );
    const parsed = querySchema.safeParse({
      scope: req.query.scope,
      subaccountId: req.query.subaccountId,
      authMethod: req.query.authMethod,
      status: req.query.status,
      q: req.query.q,
    });
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameter', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const limit = Math.min(Number(req.query.limit) || 50, 50);
    const result = await listConnections({
      organisationId: req.orgId!,
      scope: parsed.data.scope,
      subaccountId: parsed.data.subaccountId,
      provider: req.query.provider as string | undefined,
      authMethod: parsed.data.authMethod,
      status: parsed.data.status,
      q: parsed.data.q,
      cursor: (req.query.cursor as string) || null,
      limit,
      sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
    });
    res.json(result);
  })
);

// GET usage impact for a connection (agents / workflows using it)
router.get(
  '/api/connections/:id/usage',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid connection id' });
      return;
    }
    const usage = await getConnectionUsage(req.params.id, req.orgId!);
    res.json(usage);
  })
);

// POST disconnect a connection — delegates to per-kind revoke/delete per spec §4.10
router.post(
  '/api/connections/:id/disconnect',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid connection id' });
      return;
    }
    const result = await disconnectConnection(req.params.id, req.orgId!);
    if ('notFound' in result) {
      throw { statusCode: 404, message: 'Connection not found' };
    }
    res.status(200).json({ success: true, alreadyDisconnected: result.alreadyDisconnected, kind: result.kind });
  })
);

// POST test a connection — always returns 200 per spec §4.9
router.post(
  '/api/connections/:id/test',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid connection id' });
      return;
    }
    const result = await connectionTokenService.testConnection({
      id: req.params.id,
      organisationId: req.orgId!,
    });
    if ('notFound' in result) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }
    res.status(200).json(result);
  })
);

export default router;

