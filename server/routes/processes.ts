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

router.get('/api/processes', authenticate, async (req, res) => {
  try {
    const result = await processService.listProcesses(req.user!.id, req.orgId!, req.user!.role, {
      categoryId: req.query.categoryId as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      limit: parsePositiveInt(req.query.limit),
      offset: parsePositiveInt(req.query.offset),
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_CREATE), async (req, res) => {
  try {
    const { name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId } = req.body;
    if (!name || !workflowEngineId || !webhookPath) {
      res.status(400).json({ error: 'Validation failed', details: 'name, workflowEngineId, and webhookPath are required' });
      return;
    }
    const result = await processService.createProcess(req.orgId!, {
      name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/processes/:id', authenticate, async (req, res) => {
  try {
    const result = await processService.getProcess(req.params.id, req.orgId!, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/processes/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_EDIT), async (req, res) => {
  try {
    const result = await processService.updateProcess(req.params.id, req.orgId!, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/processes/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_DELETE), async (req, res) => {
  try {
    const result = await processService.deleteProcess(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_TEST), validateMultipart, async (req, res) => {
  try {
    const inputData = req.body.inputData ? JSON.parse(req.body.inputData) : undefined;
    const result = await processService.testProcess(req.params.id, req.orgId!, req.user!.id, inputData);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_ACTIVATE), async (req, res) => {
  try {
    const result = await processService.activateProcess(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_ACTIVATE), async (req, res) => {
  try {
    const result = await processService.deactivateProcess(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// System process visibility and cloning
// ---------------------------------------------------------------------------

// List system processes available to this org
router.get('/api/processes/system', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_VIEW), asyncHandler(async (req, res) => {
  const rows = await db.select()
    .from(processes)
    .where(and(eq(processes.scope, 'system'), eq(processes.status, 'active'), isNull(processes.deletedAt)))
    .orderBy(desc(processes.createdAt));
  res.json(rows);
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
