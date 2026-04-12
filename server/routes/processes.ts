import { Router } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { processes } from '../db/schema/index.js';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { processService } from '../services/processService.js';
import { validateMultipart, parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/api/processes', authenticate, asyncHandler(async (req, res) => {
  const result = await processService.listProcesses(req.user!.id, req.orgId!, req.user!.role, {
    categoryId: req.query.categoryId as string | undefined,
    status: req.query.status as string | undefined,
    search: req.query.search as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
  });
  res.json(result);
}));

router.post('/api/processes', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_CREATE), asyncHandler(async (req, res) => {
  const { name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId } = req.body;
  if (!name || !workflowEngineId || !webhookPath) {
    res.status(400).json({ error: 'Validation failed', details: 'name, workflowEngineId, and webhookPath are required' });
    return;
  }
  const result = await processService.createProcess(req.orgId!, {
    name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId,
  });
  res.status(201).json(result);
}));

router.get('/api/processes/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await processService.getProcess(req.params.id, req.orgId!, req.user!.role);
  // For system-managed processes, hide the execution internals from org admins
  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — hides internal fields from non-system-admins"
  if ((result as { isSystemManaged?: boolean }).isSystemManaged && req.user!.role !== 'system_admin') {
    const { webhookPath, inputSchema, outputSchema, configSchema, requiredConnections, workflowEngineId, ...safe } = result as Record<string, unknown>;
    res.json(safe);
    return;
  }
  res.json(result);
}));

router.patch('/api/processes/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_EDIT), asyncHandler(async (req, res) => {
  const result = await processService.updateProcess(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/processes/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_DELETE), asyncHandler(async (req, res) => {
  const result = await processService.deleteProcess(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/processes/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_TEST), validateMultipart, asyncHandler(async (req, res) => {
  let inputData: unknown;
  if (req.body.inputData) {
    try { inputData = JSON.parse(req.body.inputData); } catch { res.status(400).json({ error: 'Invalid JSON in inputData' }); return; }
  }
  const result = await processService.testProcess(req.params.id, req.orgId!, req.user!.id, inputData);
  res.json(result);
}));

router.post('/api/processes/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_ACTIVATE), asyncHandler(async (req, res) => {
  const result = await processService.activateProcess(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/processes/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_ACTIVATE), asyncHandler(async (req, res) => {
  const result = await processService.deactivateProcess(req.params.id, req.orgId!);
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
  const { webhookPath, inputSchema, outputSchema, configSchema, requiredConnections, workflowEngineId, ...safe } = p;
  return safe;
}

// List system processes available to this org (internal config hidden from org admins)
router.get('/api/processes/system', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_VIEW), asyncHandler(async (req, res) => {
  const rows = await db.select()
    .from(processes)
    .where(and(eq(processes.scope, 'system'), eq(processes.status, 'active'), isNull(processes.deletedAt)))
    .orderBy(desc(processes.createdAt));

  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin sees raw fields, org_admin gets sanitized view"
  const isSystemAdmin = req.user!.role === 'system_admin';
  res.json(isSystemAdmin ? rows : rows.map(r => sanitizeSystemProcess(r as Record<string, unknown>)));
}));

// Link a system process to this org.
// Creates a thin org-scoped wrapper that references the system process.
// Org admins see name/description/config — execution internals remain hidden.
router.post('/api/processes/link-system/:systemProcessId', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_CREATE), asyncHandler(async (req, res) => {
  const [systemProcess] = await db.select()
    .from(processes)
    .where(and(
      eq(processes.id, req.params.systemProcessId),
      eq(processes.scope, 'system'),
      isNull(processes.deletedAt)
    ));

  if (!systemProcess) throw { statusCode: 404, message: 'System process not found' };
  if (systemProcess.status !== 'active') {
    throw { statusCode: 400, message: 'Cannot link an inactive system process' };
  }

  // Prevent duplicate links for the same system process in the same org
  const [existing] = await db.select()
    .from(processes)
    .where(and(
      eq(processes.organisationId, req.orgId!),
      eq(processes.systemProcessId, systemProcess.id),
      isNull(processes.deletedAt)
    ));
  if (existing) {
    throw { statusCode: 409, message: 'This system process is already linked to your organisation' };
  }

  const { name, description, defaultConfig } = req.body;

  const [linked] = await db.insert(processes).values({
    organisationId: req.orgId!,
    workflowEngineId: null,
    name: name || systemProcess.name,
    description: description ?? systemProcess.description,
    // Internal execution fields are intentionally omitted — resolved from systemProcess at runtime
    webhookPath: '', // placeholder; unused for system-managed processes
    scope: 'organisation',
    isEditable: true,
    isSystemManaged: true,
    systemProcessId: systemProcess.id,
    defaultConfig: defaultConfig ?? null,
    status: 'active', // auto-active since the system process is already active
  }).returning();

  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin sees raw linked fields, org_admin gets sanitized response"
  const isSystemAdmin = req.user!.role === 'system_admin';
  if (!isSystemAdmin) {
    const { webhookPath: _w, inputSchema: _i, outputSchema: _o, configSchema: _c, requiredConnections: _r, workflowEngineId: _e, ...safe } = linked as Record<string, unknown>;
    res.status(201).json(safe);
    return;
  }
  res.status(201).json(linked);
}));

// Clone a process into this org (from system or same org)
router.post('/api/processes/:id/clone', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_CREATE), asyncHandler(async (req, res) => {
  const [source] = await db.select()
    .from(processes)
    .where(and(eq(processes.id, req.params.id), isNull(processes.deletedAt)));

  if (!source) throw { statusCode: 404, message: 'Source process not found' };

  // Can only clone system processes or processes from the same org
  if (source.scope !== 'system' && source.organisationId !== req.orgId!) {
    throw { statusCode: 403, message: 'Cannot clone processes from another organisation' };
  }

  const { name } = req.body;

  const [cloned] = await db.insert(processes).values({
    organisationId: req.orgId!,
    workflowEngineId: null, // engine resolved at runtime
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
    parentProcessId: source.id,
    status: 'draft',
  }).returning();

  res.status(201).json(cloned);
}));

export default router;
