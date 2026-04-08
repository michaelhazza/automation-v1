import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scheduledTaskService } from '../services/scheduledTaskService.js';
import { agentService } from '../services/agentService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateBody, validateMultipart } from '../middleware/validate.js';
import { createDataSourceBody, updateDataSourceBody } from '../schemas/agents.js';

const router = Router();

// ─── List scheduled tasks for a subaccount ──────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
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
    const {
      title, description, brief, priority, assignedAgentId,
      rrule, timezone, scheduleTime, retryPolicy, tokenBudgetPerRun,
      endsAt, endsAfterRuns,
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
    const updated = await scheduledTaskService.update(req.params.stId, req.orgId!, req.body);
    res.json(updated);
  })
);

// ─── Delete a scheduled task ────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
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
    // Fire the occurrence immediately (doesn't affect the regular schedule)
    await scheduledTaskService.fireOccurrence(req.params.stId);
    res.json({ success: true, message: 'Scheduled task triggered' });
  })
);

// ─── Reassignment preview (spec §7.6) ───────────────────────────────────────
// Returns the cascade preview — how many data sources would move and which
// would collide with the new agent's existing sources — without making any
// DB changes. Used by the UI confirmation dialog when an operator changes
// the assigned agent on a scheduled task with attached data sources.

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/reassignment-preview',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const newAgentId = req.query.newAgentId;
    if (typeof newAgentId !== 'string' || newAgentId.length === 0) {
      res.status(400).json({ error: 'newAgentId query parameter is required' });
      return;
    }
    const preview = await agentService.previewScheduledTaskReassignment(
      req.params.stId,
      newAgentId,
      req.orgId!,
    );
    res.json(preview);
  })
);

// ─── Scheduled task data sources (spec §9) ──────────────────────────────────

// List data sources for a scheduled task
router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const list = await agentService.listScheduledTaskDataSources(
      req.params.stId,
      req.orgId!,
    );
    res.json(list);
  })
);

// Upload a file as a data source
router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/upload',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateMultipart,
  asyncHandler(async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const result = await agentService.uploadScheduledTaskDataSourceFile(
      req.params.stId,
      req.orgId!,
      files[0],
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
    const {
      name, description, sourceType, sourcePath, sourceHeaders,
      contentType, priority, maxTokenBudget, cacheMinutes, loadingMode,
    } = req.body;
    if (!name || !sourceType || !sourcePath) {
      res.status(400).json({ error: 'Validation failed', details: 'name, sourceType, and sourcePath are required' });
      return;
    }
    const result = await agentService.addScheduledTaskDataSource(
      req.params.stId,
      req.orgId!,
      {
        name, description, sourceType, sourcePath, sourceHeaders,
        contentType, priority, maxTokenBudget, cacheMinutes, loadingMode,
      },
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
    const result = await agentService.updateScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
      req.body,
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
    await agentService.deleteScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
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
    const result = await agentService.testScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
    );
    res.json(result);
  })
);

export default router;
