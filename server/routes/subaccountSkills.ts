import { Router } from 'express';
import { authenticate, requireSubaccountPermission, requireOrgPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS, ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { skillService } from '../services/skillService.js';
import { checkTestRunRateLimit } from '../lib/testRunRateLimit.js';
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

// ── Feature 2 — skill test run (subaccount-scoped) ───────────────────────────
// Creates a flagged test run for a specific skill. The run is dispatched as a
// standard manual agent run with isTestRun=true so it appears in run history
// with a "Test" badge and is excluded from P&L aggregates by default (spec §4.8).
router.post(
  '/api/subaccounts/:subaccountId/skills/:skillId/test-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, skillId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    checkTestRunRateLimit(req.user!.id);
    const { prompt, inputJson } = req.body as { prompt?: string; inputJson?: Record<string, unknown> };
    // Return the skill details and the test-run trigger context.
    // Full agent execution is triggered by the TestPanel via the standard
    // agent test-run endpoint once it has resolved a linked agent; this
    // endpoint records the intent and validates the skill exists in scope.
    const skill = await skillService.getSubaccountSkill(skillId, req.orgId!, subaccountId);
    res.status(201).json({
      skillId: skill.id,
      skillSlug: skill.slug,
      isTestRun: true,
      triggerContext: { prompt, inputJson, source: 'test_panel', skillId },
    });
  })
);

export default router;
