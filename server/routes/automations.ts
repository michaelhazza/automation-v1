import { Router } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { automations } from '../db/schema/index.js';
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
  const rows = await db.select()
    .from(automations)
    .where(and(eq(automations.scope, 'system'), eq(automations.status, 'active'), isNull(automations.deletedAt)))
    .orderBy(desc(automations.createdAt));

  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin sees raw fields, org_admin gets sanitized view"
  const isSystemAdmin = req.user!.role === 'system_admin';
  res.json(isSystemAdmin ? rows : rows.map(r => sanitizeSystemProcess(r as Record<string, unknown>)));
}));

// Link a system process to this org.
// Creates a thin org-scoped wrapper that references the system process.
// Org admins see name/description/config — execution internals remain hidden.
router.post('/api/automations/link-system/:systemAutomationId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AUTOMATIONS_CREATE), asyncHandler(async (req, res) => {
  const [systemProcess] = await db.select()
    .from(automations)
    .where(and(
      eq(automations.id, req.params.systemAutomationId),
      eq(automations.scope, 'system'),
      isNull(automations.deletedAt)
    ));

  if (!systemProcess) throw { statusCode: 404, message: 'System process not found' };
  if (systemProcess.status !== 'active') {
    throw { statusCode: 400, message: 'Cannot link an inactive system process' };
  }

  // Prevent duplicate links for the same system process in the same org
  const [existing] = await db.select()
    .from(automations)
    .where(and(
      eq(automations.organisationId, req.orgId!),
      eq(automations.systemAutomationId, systemProcess.id),
      isNull(automations.deletedAt)
    ));
  if (existing) {
    throw { statusCode: 409, message: 'This system process is already linked to your organisation' };
  }

  const { name, description, defaultConfig } = req.body;

  const [linked] = await db.insert(automations).values({
    organisationId: req.orgId!,
    automationEngineId: null,
    name: name || systemProcess.name,
    description: description ?? systemProcess.description,
    // Internal execution fields are intentionally omitted — resolved from systemProcess at runtime
    webhookPath: '', // placeholder; unused for system-managed automations
    scope: 'organisation',
    isEditable: true,
    isSystemManaged: true,
    systemAutomationId: systemProcess.id,
    defaultConfig: defaultConfig ?? null,
    status: 'active', // auto-active since the system process is already active
  }).returning();

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
  const [source] = await db.select()
    .from(automations)
    .where(and(eq(automations.id, req.params.id), isNull(automations.deletedAt)));

  if (!source) throw { statusCode: 404, message: 'Source process not found' };

  // Can only clone system automations or automations from the same org
  if (source.scope !== 'system' && source.organisationId !== req.orgId!) {
    throw { statusCode: 403, message: 'Cannot clone automations from another organisation' };
  }

  const { name } = req.body;

  const [cloned] = await db.insert(automations).values({
    organisationId: req.orgId!,
    automationEngineId: null, // engine resolved at runtime
    name: name || `${source.name} (Clone)`,
    description: source.description,
    webhookPath: source.webhookPath,
    inputSchema: source.inputSchema,
    outputSchema: source.outputSchema,
    configSchema: source.configSchema,
    defaultConfig: source.defaultConfig,
    requiredConnections: source.requiredConnections,
    scope: 'organisation',
    isEditable: true,
    parentAutomationId: source.id,
    status: 'draft',
  }).returning();

  res.status(201).json(cloned);
}));

export default router;
