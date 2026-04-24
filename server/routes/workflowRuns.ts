/**
 * Workflow Runs routes — start, query, cancel, submit input, approve.
 *
 * Spec: tasks/Workflows-spec.md §7.3, §7.4.
 *
 * Most state advances delegate to WorkflowRunService → WorkflowEngineService.
 * Routes are thin: validate input, call the service, shape the response.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowRunService } from '../services/workflowRunService.js';

const router = Router();

// ─── Subaccount-scoped: list runs + start run ────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/Workflow-runs',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const status = req.query.status as string | undefined;
    const runs = await WorkflowRunService.listRunsForSubaccount(req.orgId!, subaccountId, {
      status: status as never,
    });
    res.json({ runs });
  })
);

router.post(
  '/api/subaccounts/:subaccountId/Workflow-runs',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_START),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { templateId, systemTemplateSlug, input, runMode, bulkTargets } = req.body as {
      templateId?: string;
      systemTemplateSlug?: string;
      input?: Record<string, unknown>;
      runMode?: string;
      bulkTargets?: string[];
    };
    if (!templateId && !systemTemplateSlug) {
      res.status(400).json({ error: 'templateId or systemTemplateSlug is required' });
      return;
    }
    // Sprint 4 P3.1: validate runMode
    const validModes = ['auto', 'supervised', 'background', 'bulk'];
    const effectiveMode = runMode ?? 'auto';
    if (!validModes.includes(effectiveMode)) {
      res.status(400).json({ error: `runMode must be one of: ${validModes.join(', ')}` });
      return;
    }
    // Bulk mode requires bulkTargets
    if (effectiveMode === 'bulk' && (!bulkTargets || bulkTargets.length === 0)) {
      res.status(400).json({ error: 'bulkTargets is required for bulk run mode' });
      return;
    }
    const result = await WorkflowRunService.startRun({
      organisationId: req.orgId!,
      subaccountId,
      templateId,
      systemTemplateSlug,
      initialInput: input ?? {},
      startedByUserId: req.user!.id,
      runMode: effectiveMode as 'auto' | 'supervised' | 'background' | 'bulk',
      bulkTargets,
    });
    res.status(201).json(result);
  })
);

// ─── Run detail + actions ────────────────────────────────────────────────────

router.get(
  '/api/Workflow-runs/:runId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const result = await WorkflowRunService.getRun(req.orgId!, req.params.runId);
    res.json(result);
  })
);

// §9.2 — single round-trip fetch used by the WorkflowRunPage modal. Returns
// the run row, ordered step-run rows, the resolved template definition, the
// resolved agent id map, and an empty events list (events arrive over WS).
router.get(
  '/api/subaccounts/:subaccountId/Workflow-runs/:runId/envelope',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId, runId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const envelope = await WorkflowRunService.getEnvelope(
      req.orgId!,
      subaccountId,
      runId,
    );
    res.json(envelope);
  })
);

// §9.4 — admin toggles whether a run is shown on the sub-account portal.
router.patch(
  '/api/subaccounts/:subaccountId/Workflow-runs/:runId/portal-visibility',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_START),
  asyncHandler(async (req, res) => {
    const { subaccountId, runId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { isPortalVisible } = req.body as { isPortalVisible?: boolean };
    if (typeof isPortalVisible !== 'boolean') {
      res.status(400).json({ error: 'isPortalVisible (boolean) is required' });
      return;
    }
    const run = await WorkflowRunService.setPortalVisibility(
      req.orgId!,
      subaccountId,
      runId,
      isPortalVisible,
    );
    res.json({ ok: true, run });
  })
);

router.post(
  '/api/Workflow-runs/:runId/cancel',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await WorkflowRunService.cancelRun(req.orgId!, req.params.runId, req.user!.id);
    res.json({ ok: true, status: 'cancelling' });
  })
);

router.post(
  '/api/Workflow-runs/:runId/replay',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { WorkflowEngineService } = await import('../services/workflowEngineService.js');
    const result = await WorkflowEngineService.createReplayRun(
      req.orgId!,
      req.params.runId,
      req.user!.id
    );
    res.status(201).json(result);
  })
);

router.post(
  '/api/Workflow-runs/:runId/steps/:stepRunId/input',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { runId, stepRunId } = req.params;
    const { data, expectedVersion } = req.body as {
      data?: Record<string, unknown>;
      expectedVersion?: number;
    };
    if (!data) {
      res.status(400).json({ error: 'data is required' });
      return;
    }
    await WorkflowRunService.submitStepInput(
      req.orgId!,
      runId,
      stepRunId,
      data,
      req.user!.id,
      expectedVersion
    );
    res.json({ ok: true });
  })
);

router.post(
  '/api/Workflow-runs/:runId/steps/:stepRunId/output',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { runId, stepRunId } = req.params;
    const {
      output,
      confirmReversible,
      confirmIrreversible,
      skipAndReuse,
      expectedVersion,
    } = req.body as {
      output?: Record<string, unknown>;
      confirmReversible?: string[];
      confirmIrreversible?: string[];
      skipAndReuse?: string[];
      expectedVersion?: number;
    };
    if (!output || typeof output !== 'object') {
      res.status(400).json({ error: 'output is required' });
      return;
    }
    const result = await WorkflowRunService.editStepOutput(
      req.orgId!,
      runId,
      stepRunId,
      {
        output,
        confirmReversible,
        confirmIrreversible,
        skipAndReuse,
        expectedVersion,
        userId: req.user!.id,
      }
    );
    if ('ok' in result && !result.ok) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  })
);

router.post(
  '/api/Workflow-runs/:runId/steps/:stepRunId/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { runId, stepRunId } = req.params;
    const { decision, editedOutput, expectedVersion } = req.body as {
      decision?: 'approved' | 'rejected' | 'edited';
      editedOutput?: Record<string, unknown>;
      expectedVersion?: number;
    };
    if (!decision || !['approved', 'rejected', 'edited'].includes(decision)) {
      res.status(400).json({ error: 'decision must be approved | rejected | edited' });
      return;
    }
    if (decision === 'edited' && !editedOutput) {
      res.status(400).json({ error: 'editedOutput is required when decision === "edited"' });
      return;
    }
    const result = await WorkflowRunService.decideApproval(
      req.orgId!,
      runId,
      stepRunId,
      decision,
      editedOutput,
      req.user!.id,
      expectedVersion
    );
    res.json({ ok: true, ...result });
  })
);

export default router;
