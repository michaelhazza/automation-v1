/**
 * Portal routes — accessed by subaccount members.
 *
 * These endpoints are scoped to a specific subaccount and require the caller
 * to have been assigned to that subaccount via subaccount_user_assignments.
 * All routes use requireSubaccountPermission to enforce this.
 */
import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { WorkflowRunService } from '../services/workflowRunService.js';
import { agentActivityService } from '../services/agentActivityService.js';
import { automationService } from '../services/automationService.js';
import { executionService } from '../services/executionService.js';
import { permissionSetService } from '../services/permissionSetService.js';
import { getSubaccountsForUser } from '../services/orgSubaccountService.js';
import { scheduledTaskService } from '../services/scheduledTaskService.js';

const router = Router();

// ─── Portal: list my subaccounts ─────────────────────────────────────────────

/**
 * GET /api/portal/my-subaccounts
 * Returns all subaccounts the authenticated user is assigned to (as a member).
 * Used by the portal landing page to let users pick which subaccount to access.
 */
router.get('/api/portal/my-subaccounts', authenticate, asyncHandler(async (req, res) => {
  const rows = await getSubaccountsForUser(req.user!.id);
  res.json(rows);
}));

// ─── Portal: list automations ───────────────────────────────────────────────────

/**
 * GET /api/portal/:subaccountId/automations
 * Returns automations visible to this subaccount member, grouped by category.
 */
router.get(
  '/api/portal/:subaccountId/automations',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AUTOMATIONS_VIEW),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    if (sa.status !== 'active') {
      res.status(403).json({ error: 'This subaccount is not currently active' });
      return;
    }

    const { linkedRows, nativeRows, categories } = await automationService.listPortalAutomations(req.params.subaccountId);

    const catMap = Object.fromEntries(
      categories.map((c) => [c.id, { id: c.id, name: c.name, colour: c.colour }])
    );

    const allProcesses = [
      ...linkedRows.map((row) => ({
        id: row.processId,
        name: row.processName,
        description: row.processDescription,
        inputSchema: row.processInputSchema,
        outputSchema: row.processOutputSchema,
        category: row.subaccountCategoryId ? catMap[row.subaccountCategoryId] : null,
        source: 'linked' as const,
      })),
      ...nativeRows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        category: t.subaccountCategoryId ? catMap[t.subaccountCategoryId] : null,
        source: 'native' as const,
      })),
    ];

    res.json({
      subaccount: { id: sa.id, name: sa.name },
      automations: allProcesses,
      categories,
    });
  })
);

// ─── Portal: execute a process ──────────────────────────────────────────────

/**
 * POST /api/portal/:subaccountId/executions
 * Execute a process as a subaccount member.
 * Body: { processId, inputData?, notifyOnComplete? }
 */
router.post(
  '/api/portal/:subaccountId/executions',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AUTOMATIONS_EXECUTE),
  asyncHandler(async (req, res) => {
    const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    if (sa.status !== 'active') {
      res.status(403).json({ error: 'This subaccount is not currently active' });
      return;
    }

    const { processId, inputData, notifyOnComplete } = req.body as {
      processId?: string;
      inputData?: unknown;
      notifyOnComplete?: boolean;
    };

    if (!processId) {
      res.status(400).json({ error: 'Validation failed', details: 'processId is required' });
      return;
    }

    const accessible = await automationService.isProcessAccessibleToSubaccount(processId, req.params.subaccountId);
    if (!accessible) {
      res.status(404).json({ error: 'Process not found or not accessible in this subaccount' });
      return;
    }

    const result = await executionService.createPortalExecution(
      req.user!.id,
      req.orgId!,
      req.params.subaccountId,
      processId,
      inputData,
      notifyOnComplete,
    );

    res.status(201).json(result);
  })
);

// ─── Portal: list executions ──────────────────────────────────────────────────

/**
 * GET /api/portal/:subaccountId/executions
 * Members with subaccount.executions.view_all see everyone's; others see only their own.
 */
router.get(
  '/api/portal/:subaccountId/executions',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const canViewAll = await permissionSetService.hasSubaccountPermission(
      req.user!.id,
      req.params.subaccountId,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL,
    );

    const { from, to, processId, limit: limitRaw, offset: offsetRaw } = req.query;

    const rows = await executionService.listPortalExecutions(
      req.params.subaccountId,
      req.user!.id,
      canViewAll,
      {
        processId: processId as string | undefined,
        from: from as string | undefined,
        to: to as string | undefined,
        limit: limitRaw ? parseInt(limitRaw as string) : undefined,
        offset: offsetRaw ? parseInt(offsetRaw as string) : undefined,
      },
    );

    res.json(rows);
  })
);

/**
 * GET /api/portal/:subaccountId/executions/:executionId
 * Get a single execution detail.
 */
router.get(
  '/api/portal/:subaccountId/executions/:executionId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const canViewAll = await permissionSetService.hasSubaccountPermission(
      req.user!.id,
      req.params.subaccountId,
      SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL,
    );

    const execution = await executionService.getPortalExecution(
      req.params.executionId,
      req.params.subaccountId,
      req.user!.id,
      canViewAll,
    );

    res.json(execution);
  })
);

// ─── Portal: agent activity for a subaccount ────────────────────────────────

router.get(
  '/api/portal/:subaccountId/agent-activity',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const { agentId, status, limit, offset } = req.query;

    const runs = await agentActivityService.listRuns({
      subaccountId: req.params.subaccountId,
      agentId: agentId as string | undefined,
      status: status as string | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json(runs);
  })
);

router.get(
  '/api/portal/:subaccountId/agent-activity/stats',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const { sinceDays } = req.query;
    const stats = await agentActivityService.getStats({
      subaccountId: req.params.subaccountId,
      sinceDays: sinceDays ? Number(sinceDays) : undefined,
    });

    res.json(stats);
  })
);

// ─── Portal: portal-visible Workflow runs (spec §9.4) ────────────────────────

/**
 * GET /api/portal/:subaccountId/workflow-runs
 *
 * Returns runs where `isPortalVisible = true` for this subaccount, ordered by
 * most-recently started.  Each entry includes the portalPresentation metadata
 * from the locked template version's definition so the UI can render the card
 * title and headline extraction path without a second round-trip.
 */
router.get(
  '/api/portal/:subaccountId/workflow-runs',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const sa = await resolveSubaccount(subaccountId, req.orgId!);

    const enriched = await WorkflowRunService.listPortalRuns(sa.organisationId, subaccountId);

    res.json({ runs: enriched });
  }),
);

// ─── Portal: Intelligence Briefing card (spec §G10.4, renamed in S18) ─────

/**
 * GET /api/portal/:subaccountId/intelligence-briefing-card
 *
 * Drives the dedicated Intelligence Briefing hero card on the portal dashboard.
 * Per spec §G10.4, the card shows iff the subaccount has BOTH a completed
 * Intelligence Briefing run AND a currently-active scheduled task producing
 * briefings. Returning { active: false } from either side keeps the card off
 * the dashboard so stale schedules don't advertise a broken card.
 *
 * Memory & Briefings S18: renamed from /daily-brief-card. The old path is
 * 301-redirected below for existing external consumers.
 *
 * Response shape:
 *   {
 *     active: boolean,
 *     latestRun: { id, completedAt } | null,
 *     nextRunAt: string | null,
 *     scheduledTaskId: string | null,
 *   }
 */
router.get(
  '/api/portal/:subaccountId/intelligence-briefing-card',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const sa = await resolveSubaccount(subaccountId, req.orgId!);

    const DAILY_BRIEF_SLUG = 'intelligence-briefing';

    const latestRun = await WorkflowRunService.getLatestCompletedRunBySlug(
      sa.organisationId,
      subaccountId,
      DAILY_BRIEF_SLUG,
    );

    const activeSchedule = await scheduledTaskService.findActiveSubaccountScheduleByWorkflowSlug(
      subaccountId,
      DAILY_BRIEF_SLUG,
    );

    const active = Boolean(latestRun && activeSchedule);

    res.json({
      active,
      latestRun: latestRun
        ? { id: latestRun.id, completedAt: latestRun.completedAt }
        : null,
      nextRunAt: activeSchedule?.nextRunAt ?? null,
      scheduledTaskId: activeSchedule?.id ?? null,
    });
  }),
);

// Memory & Briefings S18 — 301 tombstone for the pre-rename path so external
// consumers (bookmarks, API clients) stop on the new canonical route.
router.get('/api/portal/:subaccountId/daily-brief-card', (req, res) => {
  res.redirect(301, `/api/portal/${req.params.subaccountId}/intelligence-briefing-card`);
});

/**
 * POST /api/portal/:subaccountId/workflow-runs/:runId/run-now
 *
 * Starts a fresh run of the same Workflow template as `runId` (spec §9.4
 * "Run now" button). Idempotent via the §10.5.1 DB-level unique guard.
 * Returns the new runId (or the existing active runId if one is in flight).
 */
router.post(
  '/api/portal/:subaccountId/workflow-runs/:runId/run-now',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_START),
  asyncHandler(async (req, res) => {
    const { subaccountId, runId } = req.params;
    const sa = await resolveSubaccount(subaccountId, req.orgId!);

    const result = await WorkflowRunService.replayPortalRun(
      sa.organisationId,
      subaccountId,
      runId,
      req.user!.id,
    );

    res.status(201).json(result);
  }),
);

export default router;
