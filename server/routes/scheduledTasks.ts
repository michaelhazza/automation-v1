import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scheduledTaskService } from '../services/scheduledTaskService.js';
import { agentService } from '../services/agentService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateBody, validateMultipart } from '../middleware/validate.js';
import { createDataSourceBody, updateDataSourceBody } from '../schemas/agents.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

// ─── List scheduled tasks for a subaccount ──────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const list = await scheduledTaskService.list(req.orgId!, req.params.subaccountId);
    res.json(list);
  })
);

// ─── Create a scheduled task ────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const {
      title, description, brief, priority, assignedAgentId,
      rrule, timezone, scheduleTime, retryPolicy, tokenBudgetPerRun,
      endsAt, endsAfterRuns,
      // Phase B2 — SchedulePicker adoption (spec §5.4–§5.6).
      taskSlug, createdByWorkflowSlug, firstRunAt, firstRunAtTz, runNow,
    } = req.body;

    if (!title || !assignedAgentId || !rrule || !scheduleTime) {
      res.status(400).json({ error: 'title, assignedAgentId, rrule, and scheduleTime are required' });
      return;
    }

    const created = await scheduledTaskService.create(
      req.orgId!,
      subaccountId,
      {
        title, description, brief, priority, assignedAgentId,
        rrule, timezone, scheduleTime, retryPolicy, tokenBudgetPerRun,
        endsAt: endsAt ? new Date(endsAt) : undefined,
        endsAfterRuns,
        taskSlug,
        createdByWorkflowSlug,
        firstRunAt: firstRunAt ? new Date(firstRunAt) : undefined,
        firstRunAtTz,
        runNow: runNow === true,
      },
      req.user!.id
    );

    res.status(201).json(created);
  })
);

// ─── Get scheduled task detail ──────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const detail = await scheduledTaskService.getDetail(req.params.stId, req.orgId!);
    res.json(detail);
  })
);

// ─── Update a scheduled task ────────────────────────────────────────────────

router.patch(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    // Match the create route: coerce endsAt string → Date so the driver
    // stores a proper timestamptz. Leaving it as a string can fail the
    // update or persist the wrong value depending on the driver.
    const patch = { ...req.body };
    if (patch.endsAt !== undefined && patch.endsAt !== null && typeof patch.endsAt === 'string') {
      patch.endsAt = new Date(patch.endsAt);
    }
    const updated = await scheduledTaskService.update(req.params.stId, req.orgId!, patch);
    res.json(updated);
  })
);

// ─── Delete a scheduled task ────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await scheduledTaskService.delete(req.params.stId, req.orgId!);
    res.json({ success: true });
  })
);

// ─── Toggle active/paused ───────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/toggle',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive (boolean) is required' });
      return;
    }
    const updated = await scheduledTaskService.toggleActive(req.params.stId, req.orgId!, isActive);
    res.json(updated);
  })
);

// ─── Run now (manual trigger) ───────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/run-now',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    // Fire the occurrence immediately (doesn't affect the regular schedule)
    await scheduledTaskService.fireOccurrence(req.params.stId, req.orgId!);
    res.json({ success: true, message: 'Scheduled task triggered' });
  })
);

// ─── Scheduled task data sources (spec §9) ──────────────────────────────────
//
// NOTE: The cascade preview endpoint and the in-UI agent reassignment flow
// (spec §7.6) are deferred to a follow-up. The backend cascade itself in
// scheduledTaskService.update IS implemented and transactional — agent
// reassignment via API or seed script will still cascade safely. What's
// deferred is exposing it through the detail page edit form with a UI
// confirmation dialog. Tracked for a follow-up that adds an agent picker
// to the edit form. (pr-reviewer Blocker 5.)

// List data sources for a scheduled task
router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const list = await agentService.listScheduledTaskDataSources(
      req.params.stId,
      req.orgId!,
    );
    res.json(list);
  })
);

// Upload a file AND create the data source row in one atomic call.
// Multipart fields: `file` (the upload), `name`, `description?`,
// `contentType?`, `loadingMode?`, `priority?`, `maxTokenBudget?`.
router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/upload',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateMultipart,
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const body = req.body as Record<string, string | undefined>;
    const name = body.name ?? files[0].originalname;
    const result = await agentService.uploadScheduledTaskDataSourceFile(
      req.params.stId,
      req.orgId!,
      files[0],
      {
        name,
        description: body.description,
        contentType: body.contentType as 'json' | 'csv' | 'markdown' | 'text' | 'auto' | undefined,
        loadingMode: body.loadingMode as 'eager' | 'lazy' | undefined,
        priority: body.priority !== undefined ? Number(body.priority) : undefined,
        maxTokenBudget: body.maxTokenBudget !== undefined ? Number(body.maxTokenBudget) : undefined,
      },
      req.user?.id,
    );
    res.status(201).json(result);
  })
);

// Create a data source from a URL or other remote source
router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateBody(createDataSourceBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const {
      name, description, sourceType, sourcePath, sourceHeaders,
      contentType, priority, maxTokenBudget, cacheMinutes, loadingMode,
      connectionId,
    } = req.body;
    if (!name || !sourceType) {
      res.status(400).json({ error: 'Validation failed', details: 'name and sourceType are required' });
      return;
    }
    if (sourceType === 'google_drive') {
      if (!connectionId) {
        res.status(400).json({ error: 'Validation failed', details: 'connectionId is required for google_drive sources' });
        return;
      }
      const { integrationConnectionService } = await import('../services/integrationConnectionService.js');
      const conn = await integrationConnectionService.getOrgConnectionWithToken(connectionId, req.orgId!);
      if (!conn || conn.providerType !== 'google_drive' || conn.connectionStatus !== 'active') {
        res.status(422).json({ error: 'invalid_connection_id' });
        return;
      }
    } else if (!sourcePath) {
      res.status(400).json({ error: 'Validation failed', details: 'sourcePath is required' });
      return;
    }
    const result = await agentService.addScheduledTaskDataSource(
      req.params.stId,
      req.orgId!,
      {
        name, description, sourceType, sourcePath, sourceHeaders,
        contentType, priority, maxTokenBudget, cacheMinutes, loadingMode,
        connectionId,
      },
      req.user?.id,
    );
    res.status(201).json(result);
  })
);

// Update a data source
router.patch(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/:sourceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateBody(updateDataSourceBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const result = await agentService.updateScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
      req.body,
      req.user?.id,
    );
    res.json(result);
  })
);

// Delete a data source
router.delete(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/:sourceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await agentService.deleteScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
      req.user?.id,
    );
    res.json({ success: true });
  })
);

// Test fetch a data source
router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/:sourceId/test',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const result = await agentService.testScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
    );
    res.json(result);
  })
);

export default router;
