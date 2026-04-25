import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { automationService } from '../services/automationService.js';
import { validateMultipart, parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/api/automations', authenticate, asyncHandler(async (req, res) => {
  const result = await automationService.listProcesses(req.user!.id, req.orgId!, req.user!.role, {
    categoryId: req.query.categoryId as string | undefined,
    status: req.query.status as string | undefined,
    search: req.query.search as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
  });
  res.json(result);
}));

router.post('/api/automations', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_CREATE), asyncHandler(async (req, res) => {
  const { name, description, automationEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId } = req.body;
  if (!name || !automationEngineId || !webhookPath) {
    res.status(400).json({ error: 'Validation failed', details: 'name, automationEngineId, and webhookPath are required' });
    return;
  }
  const result = await automationService.createProcess(req.orgId!, {
    name, description, automationEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId,
  });
  res.status(201).json(result);
}));

router.get('/api/automations/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await automationService.getProcess(req.params.id, req.orgId!, req.user!.role);
  // For system-managed automations, hide the execution internals from org admins
  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — hides internal fields from non-system-admins"
  if ((result as { isSystemManaged?: boolean }).isSystemManaged && req.user!.role !== 'system_admin') {
    const { webhookPath, inputSchema, outputSchema, configSchema, requiredConnections, automationEngineId, ...safe } = result as Record<string, unknown>;
    res.json(safe);
    return;
  }
  res.json(result);
}));

router.patch('/api/automations/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_EDIT), asyncHandler(async (req, res) => {
  const result = await automationService.updateProcess(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/automations/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_DELETE), asyncHandler(async (req, res) => {
  const result = await automationService.deleteProcess(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/automations/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_TEST), validateMultipart, asyncHandler(async (req, res) => {
  let inputData: unknown;
  if (req.body.inputData) {
    try { inputData = JSON.parse(req.body.inputData); } catch { res.status(400).json({ error: 'Invalid JSON in inputData' }); return; }
  }
  const result = await automationService.testProcess(req.params.id, req.orgId!, req.user!.id, inputData);
  res.json(result);
}));

router.post('/api/automations/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_ACTIVATE), asyncHandler(async (req, res) => {
  const result = await automationService.activateProcess(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/automations/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_ACTIVATE), asyncHandler(async (req, res) => {
  const result = await automationService.deactivateProcess(req.params.id, req.orgId!);
  res.json(result);
}));

// ---------------------------------------------------------------------------
// System process visibility and linking
// ---------------------------------------------------------------------------

/**
 * Strip internal execution fields from a system process before returning to
 * org admins. Only system admins should see webhookPath, requiredConnections,
 * inputSchema, outputSchema, and configSchema.
 */
function sanitizeSystemProcess(p: Record<string, unknown>): Record<string, unknown> {
  const { webhookPath, inputSchema, outputSchema, configSchema, requiredConnections, automationEngineId, ...safe } = p;
  return safe;
}

// List system automations available to this org (internal config hidden from org admins)
router.get('/api/automations/system', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_VIEW), asyncHandler(async (req, res) => {
  const rows = await automationService.listSystemAutomations();

  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin sees raw fields, org_admin gets sanitized view"
  const isSystemAdmin = req.user!.role === 'system_admin';
  res.json(isSystemAdmin ? rows : rows.map(r => sanitizeSystemProcess(r as Record<string, unknown>)));
}));

// Link a system process to this org.
// Creates a thin org-scoped wrapper that references the system process.
// Org admins see name/description/config — execution internals remain hidden.
router.post('/api/automations/link-system/:systemAutomationId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_CREATE), asyncHandler(async (req, res) => {
  const { name, description, defaultConfig } = req.body;
  const linked = await automationService.linkSystemAutomation(req.orgId!, req.params.systemAutomationId, { name, description, defaultConfig });

  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin sees raw linked fields, org_admin gets sanitized response"
  const isSystemAdmin = req.user!.role === 'system_admin';
  if (!isSystemAdmin) {
    const { webhookPath: _w, inputSchema: _i, outputSchema: _o, configSchema: _c, requiredConnections: _r, automationEngineId: _e, ...safe } = linked as Record<string, unknown>;
    res.status(201).json(safe);
    return;
  }
  res.status(201).json(linked);
}));

// Clone a process into this org (from system or same org)
router.post('/api/automations/:id/clone', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_CREATE), asyncHandler(async (req, res) => {
  const cloned = await automationService.cloneProcess(req.params.id, req.orgId!, req.body?.name);
  res.status(201).json(cloned);
}));

export default router;
