import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { skillAmendmentService } from '../services/skillAmendmentService.js';
import { computeMetrics } from '../services/stackHealthMetricsService.js';
import type { RejectReason, RetirementReason, IncidentSeverity } from '../../shared/types/skillAmendments.js';

const router = Router();

// GET /api/subaccounts/:subaccountId/skill-amendments
router.get(
  '/api/subaccounts/:subaccountId/skill-amendments',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const items = await skillAmendmentService.listPendingAmendments(req.orgId!, req.params.subaccountId);
    res.json(items);
  }),
);

// GET /api/subaccounts/:subaccountId/skill-amendments/:id
router.get(
  '/api/subaccounts/:subaccountId/skill-amendments/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const item = await skillAmendmentService.getAmendment(req.params.id, req.orgId!);
    res.json(item);
  }),
);

// POST /api/subaccounts/:subaccountId/skill-amendments/:id/accept
router.post(
  '/api/subaccounts/:subaccountId/skill-amendments/:id/accept',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const result = await skillAmendmentService.accept(
      req.params.id,
      req.user!.id,
      req.user!.role,
      req.orgId!,
      req.params.subaccountId,
    );
    res.json(result);
  }),
);

// POST /api/subaccounts/:subaccountId/skill-amendments/:id/accept-after-edit
router.post(
  '/api/subaccounts/:subaccountId/skill-amendments/:id/accept-after-edit',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    // guard-ignore: input-validation reason="body field destructured + type-guarded with 400 on invalid"
    const { body } = req.body as { body?: string };
    if (!body || typeof body !== 'string') {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    const result = await skillAmendmentService.acceptAfterEdit(
      req.params.id,
      body,
      req.user!.id,
      req.user!.role,
      req.orgId!,
      req.params.subaccountId,
    );
    res.json(result);
  }),
);

// POST /api/subaccounts/:subaccountId/skill-amendments/:id/reject
router.post(
  '/api/subaccounts/:subaccountId/skill-amendments/:id/reject',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { rejectReason } = req.body as { rejectReason?: RejectReason };
    if (!rejectReason) {
      res.status(400).json({ error: 'rejectReason is required' });
      return;
    }
    const result = await skillAmendmentService.reject(
      req.params.id,
      rejectReason,
      req.user!.id,
      req.user!.role,
      req.orgId!,
    );
    res.json(result);
  }),
);

// POST /api/subaccounts/:subaccountId/skill-amendments/:id/retire
router.post(
  '/api/subaccounts/:subaccountId/skill-amendments/:id/retire',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { retirementReason, incidentSeverity } = req.body as { retirementReason?: RetirementReason; incidentSeverity?: IncidentSeverity };
    if (!retirementReason) {
      res.status(400).json({ error: 'retirementReason is required' });
      return;
    }
    const result = await skillAmendmentService.retire(
      req.params.id,
      retirementReason,
      req.orgId!,
      incidentSeverity,
    );
    res.json(result);
  }),
);

// GET /api/subaccounts/:subaccountId/skills/:skillId/amendments
router.get(
  '/api/subaccounts/:subaccountId/skills/:skillId/amendments',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const items = await skillAmendmentService.listAmendmentsForSkill(
      req.params.skillId,
      req.orgId!,
      req.params.subaccountId,
    );
    res.json(items);
  }),
);

// GET /api/subaccounts/:subaccountId/skills/:skillId/stack-health
router.get(
  '/api/subaccounts/:subaccountId/skills/:skillId/stack-health',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const metrics = await computeMetrics({
      orgId: req.orgId!,
      subaccountId: req.params.subaccountId,
      skillId: req.params.skillId,
    });
    res.json(metrics);
  }),
);

export default router;
