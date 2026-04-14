import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { skillService } from '../services/skillService.js';
import {
  createSubaccountSkillBody,
  updateSubaccountSkillBody,
  updateSkillVisibilityBody,
} from '../schemas/subaccountSkills.js';

const router = Router();

// GET /api/subaccounts/:subaccountId/skills
router.get(
  '/api/subaccounts/:subaccountId/skills',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILLS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await skillService.listSubaccountSkills(req.orgId!, subaccount.id);
    res.json(rows);
  }),
);

// GET /api/subaccounts/:subaccountId/skills/:id
router.get(
  '/api/subaccounts/:subaccountId/skills/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILLS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const skill = await skillService.getSubaccountSkill(req.params.id, req.orgId!, subaccount.id);
    res.json(skill);
  }),
);

// POST /api/subaccounts/:subaccountId/skills
router.post(
  '/api/subaccounts/:subaccountId/skills',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const data = createSubaccountSkillBody.parse(req.body);
    const skill = await skillService.createSubaccountSkill(
      req.orgId!,
      subaccount.id,
      data,
      req.user?.id,
    );
    res.status(201).json(skill);
  }),
);

// PATCH /api/subaccounts/:subaccountId/skills/:id
router.patch(
  '/api/subaccounts/:subaccountId/skills/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const data = updateSubaccountSkillBody.parse(req.body);
    const skill = await skillService.updateSubaccountSkill(
      req.params.id,
      req.orgId!,
      subaccount.id,
      data,
      req.user?.id,
    );
    res.json(skill);
  }),
);

// DELETE /api/subaccounts/:subaccountId/skills/:id
router.delete(
  '/api/subaccounts/:subaccountId/skills/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const result = await skillService.deleteSubaccountSkill(
      req.params.id,
      req.orgId!,
      subaccount.id,
    );
    res.json(result);
  }),
);

// PATCH /api/subaccounts/:subaccountId/skills/:id/visibility
router.patch(
  '/api/subaccounts/:subaccountId/skills/:id/visibility',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILLS_MANAGE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { visibility } = updateSkillVisibilityBody.parse(req.body);
    const skill = await skillService.updateSubaccountSkill(
      req.params.id,
      req.orgId!,
      subaccount.id,
      { visibility },
      req.user?.id,
    );
    res.json(skill);
  }),
);

export default router;
