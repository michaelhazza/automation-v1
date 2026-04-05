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

const router = Router();

// List org-level connections (subaccountId IS NULL)
router.get(
  '/api/org/connections',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.CONNECTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const rows = await integrationConnectionService.listOrgConnections(req.orgId!);
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

export default router;
