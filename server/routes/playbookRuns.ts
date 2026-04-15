/**
 * Playbook Runs routes — start, query, cancel, submit input, approve.
 *
 * Spec: tasks/playbooks-spec.md §7.3, §7.4.
 *
 * Most state advances delegate to playbookRunService → playbookEngineService.
 * Routes are thin: validate input, call the service, shape the response.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { playbookRunService } from '../services/playbookRunService.js';

const router = Router();

// ─── Subaccount-scoped: list runs + start run ────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/playbook-runs',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const status = req.query.status as string | undefined;
    const runs = await playbookRunService.listRunsForSubaccount(req.orgId!, subaccountId, {
      status: status as never,
    });
    res.json({ runs });
  })
);

router.post(
  '/api/subaccounts/:subaccountId/playbook-runs',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_START),
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
    const result = await playbookRunService.startRun({
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
  '/api/playbook-runs/:runId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const result = await playbookRunService.getRun(req.orgId!, req.params.runId);
    res.json(result);
  })
);

// §9.2 — single round-trip fetch used by the PlaybookRunPage modal. Returns
// the run row, ordered step-run rows, the resolved template definition, the
// resolved agent id map, and an empty events list (events arrive over WS).
router.get(
  '/api/subaccounts/:subaccountId/playbook-runs/:runId/envelope',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId, runId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const envelope = await playbookRunService.getEnvelope(
      req.orgId!,
      subaccountId,
      runId,
    );
    res.json(envelope);
  })
);

// §9.4 — admin toggles whether a run is shown on the sub-account portal.
router.patch(
  '/api/subaccounts/:subaccountId/playbook-runs/:runId/portal-visibility',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_START),
  asyncHandler(async (req, res) => {
    const { subaccountId, runId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { isPortalVisible } = req.body as { isPortalVisible?: boolean };
    if (typeof isPortalVisible !== 'boolean') {
      res.status(400).json({ error: 'isPortalVisible (boolean) is required' });
      return;
    }
    const run = await playbookRunService.setPortalVisibility(
      req.orgId!,
      subaccountId,
      runId,
      isPortalVisible,
    );
    res.json({ ok: true, run });
  })
);

router.post(
  '/api/playbook-runs/:runId/cancel',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await playbookRunService.cancelRun(req.orgId!, req.params.runId, req.user!.id);
    res.json({ ok: true, status: 'cancelling' });
  })
);

router.post(
  '/api/playbook-runs/:runId/replay',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { playbookEngineService } = await import('../services/playbookEngineService.js');
    const result = await playbookEngineService.createReplayRun(
      req.orgId!,
      req.params.runId,
      req.user!.id
    );
    res.status(201).json(result);
  })
);

router.post(
  '/api/playbook-runs/:runId/steps/:stepRunId/input',
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
    await playbookRunService.submitStepInput(
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
  '/api/playbook-runs/:runId/steps/:stepRunId/output',
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
    const result = await playbookRunService.editStepOutput(
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
  '/api/playbook-runs/:runId/steps/:stepRunId/approve',
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
    const result = await playbookRunService.decideApproval(
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
