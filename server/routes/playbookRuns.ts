/**
 * Playbook Runs routes — start, query, cancel, submit input, approve.
 *
 * Spec: tasks/playbooks-spec.md §7.3, §7.4.
 *
 * Most state advances delegate to playbookRunService → playbookEngineService.
 * Routes are thin: validate input, call the service, shape the response.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { playbookRunService } from '../services/playbookRunService.js';

const router = Router();

// ─── Subaccount-scoped: list runs + start run ────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/playbook-runs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
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
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { templateId, systemTemplateSlug, input } = req.body as {
      templateId?: string;
      systemTemplateSlug?: string;
      input?: Record<string, unknown>;
    };
    if (!templateId && !systemTemplateSlug) {
      res.status(400).json({ error: 'templateId or systemTemplateSlug is required' });
      return;
    }
    const result = await playbookRunService.startRun({
      organisationId: req.orgId!,
      subaccountId,
      templateId,
      systemTemplateSlug,
      initialInput: input ?? {},
      startedByUserId: req.user!.id,
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
