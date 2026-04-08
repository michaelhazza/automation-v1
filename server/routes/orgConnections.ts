/**
 * Org-level integration connection routes.
 * Manages OAuth/API key connections scoped to the organisation (not a specific subaccount).
 * Org-level connections can be used as fallbacks when no subaccount-specific connection exists.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { integrationConnectionService } from '../services/integrationConnectionService.js';
import { createConnectionBody, updateConnectionBody } from '../schemas/connections.js';
import { connectionTokenService } from '../services/connectionTokenService.js';

const router = Router();

// List org-level connections (subaccountId IS NULL), optionally filtered by ?provider=X
router.get(
  '/api/org/connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const rows = await integrationConnectionService.listOrgConnections(req.orgId!, provider);
    res.json(rows);
  })
);

// Create org-level connection
router.post(
  '/api/org/connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  validateBody(createConnectionBody),
  asyncHandler(async (req, res) => {
    const connection = await integrationConnectionService.createOrgConnection(req.orgId!, req.body);
    res.status(201).json(connection);
  })
);

// Get single org-level connection
router.get(
  '/api/org/connections/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const connection = await integrationConnectionService.getOrgConnection(req.params.id, req.orgId!);
    if (!connection) throw { statusCode: 404, message: 'Connection not found' };
    res.json(connection);
  })
);

// Update org-level connection (label, status, tokens)
router.patch(
  '/api/org/connections/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  validateBody(updateConnectionBody),
  asyncHandler(async (req, res) => {
    const updated = await integrationConnectionService.updateOrgConnection(req.params.id, req.orgId!, req.body);
    if (!updated) throw { statusCode: 404, message: 'Connection not found' };
    res.json(updated);
  })
);

// Revoke org-level connection
router.delete(
  '/api/org/connections/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_MANAGE),
  asyncHandler(async (req, res) => {
    const revoked = await integrationConnectionService.revokeOrgConnection(req.params.id, req.orgId!);
    if (!revoked) throw { statusCode: 404, message: 'Connection not found' };
    res.json({ success: true });
  })
);

// Fetch Slack channel list for an org-level connection
router.get(
  '/api/org/connections/:id/slack-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const conn = await integrationConnectionService.getOrgConnectionWithToken(req.params.id, req.orgId!);
    if (!conn) throw { statusCode: 404, message: 'Slack connection not found' };
    if (conn.providerType !== 'slack') throw { statusCode: 404, message: 'Slack connection not found' };
    if (!conn.accessToken) throw { statusCode: 422, message: 'Slack connection has no token — reconnect first' };

    const token = connectionTokenService.decryptToken(conn.accessToken);
    const channels: { id: string; name: string }[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ types: 'public_channel', exclude_archived: 'true', limit: '200' });
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
      if (!data.ok) throw { statusCode: 502, message: `Slack API error: ${data.error ?? 'unknown'}` };
      for (const ch of data.channels ?? []) channels.push({ id: ch.id, name: ch.name });
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor && channels.length < 500);
    channels.sort((a, b) => a.name.localeCompare(b.name));
    res.json(channels);
  })
);

export default router;
