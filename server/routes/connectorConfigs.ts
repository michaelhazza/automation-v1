import { Router, NextFunction } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { connectorConfigService } from '../services/connectorConfigService.js';
import { connectorPollingService } from '../services/connectorPollingService.js';
import { adapters } from '../adapters/index.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ── List connector configs ────────────────────────────────────────────────

router.get('/api/org/connectors', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res, _next: NextFunction) => {
  const configs = await connectorConfigService.listByOrg(req.orgId!);
  res.json(configs);
}));

// ── Create connector config ───────────────────────────────────────────────

router.post('/api/org/connectors', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res, _next: NextFunction) => {
  const { connectorType, connectionId, configJson, pollIntervalMinutes, webhookSecret } = req.body;

  if (!connectorType) {
    return res.status(400).json({ message: 'connectorType is required' });
  }

  if (!adapters[connectorType]) {
    return res.status(400).json({ message: `Unknown connector type: ${connectorType}` });
  }

  const config = await connectorConfigService.create(req.orgId!, {
    connectorType,
    connectionId,
    configJson,
    pollIntervalMinutes,
    webhookSecret,
  });

  res.status(201).json(config);
}));

// ── Get single connector config ───────────────────────────────────────────

router.get('/api/org/connectors/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res, _next: NextFunction) => {
  const config = await connectorConfigService.get(req.params.id, req.orgId!);
  res.json(config);
}));

// ── Update connector config ──────────────────────────────────────────────

router.patch('/api/org/connectors/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res, _next: NextFunction) => {
  const { connectionId, configJson, pollIntervalMinutes, webhookSecret } = req.body;
  const config = await connectorConfigService.update(req.params.id, req.orgId!, {
    connectionId,
    configJson,
    pollIntervalMinutes,
    webhookSecret,
  });
  res.json(config);
}));

// ── Delete connector config ──────────────────────────────────────────────

router.delete('/api/org/connectors/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_DELETE), asyncHandler(async (req, res, _next: NextFunction) => {
  await connectorConfigService.delete(req.params.id, req.orgId!);
  res.json({ success: true });
}));

// ── Trigger manual sync ──────────────────────────────────────────────────

router.post('/api/org/connectors/:id/sync', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res, _next: NextFunction) => {
  const config = await connectorConfigService.get(req.params.id, req.orgId!);
  const result = await connectorPollingService.syncConnector(config.id);
  res.json(result);
}));

// ── Validate credentials ─────────────────────────────────────────────────

router.post('/api/org/connectors/:id/validate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res, _next: NextFunction) => {
  const config = await connectorConfigService.get(req.params.id, req.orgId!);
  const adapter = adapters[config.connectorType];

  if (!adapter?.ingestion?.validateCredentials) {
    return res.status(400).json({ message: 'Connector does not support credential validation' });
  }

  // We need to get the actual connection to validate
  if (!config.connectionId) {
    return res.status(400).json({ message: 'No connection linked to this connector' });
  }

  const { integrationConnectionService } = await import('../services/integrationConnectionService.js');
  const connection = await integrationConnectionService.getDecryptedConnection(
    null, // Org-level connector — no subaccountId
    config.connectorType,
    config.organisationId,
    config.connectionId
  );

  const result = await adapter.ingestion.validateCredentials(connection as never);
  res.json(result);
}));

export default router;
