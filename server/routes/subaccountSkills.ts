import { Router } from 'express';
import { authenticate, requireSubaccountPermission, requireOrgPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS, ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { skillService } from '../services/skillService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
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
// Finds the first active subaccount agent link and executes a test run with
// the skill context injected. Returns { runId } so TestPanel can poll.
router.post(
  '/api/subaccounts/:subaccountId/skills/:skillId/test-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, skillId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    checkTestRunRateLimit(req.user!.id);
    const { prompt, inputJson, idempotencyKey } = req.body as {
      prompt?: string;
      inputJson?: Record<string, unknown>;
      idempotencyKey?: string;
    };
    const skill = await skillService.getSubaccountSkill(skillId, req.orgId!, subaccountId);
    const links = await subaccountAgentService.listSubaccountAgents(req.orgId!, subaccountId);
    const activeLink = links.find((l) => l.isActive);
    if (!activeLink) {
      res.status(422).json({ error: 'No active agent linked to this subaccount. Link and activate an agent first.' });
      return;
    }
    const triggerContext: Record<string, unknown> = {
      triggeredBy: req.user!.id,
      source: 'test_panel',
      isTestRun: true,
      skillId: skill.id,
      skillSlug: skill.slug,
    };
    if (prompt) triggerContext.prompt = prompt;
    if (inputJson) triggerContext.inputJson = inputJson;
    const result = await agentExecutionService.executeRun({
      agentId: activeLink.agentId,
      subaccountId,
      subaccountAgentId: activeLink.id,
      organisationId: req.orgId!,
      executionScope: 'subaccount',
      runType: 'manual',
      executionMode: 'api',
      runSource: 'manual',
      isTestRun: true,
      userId: req.user!.id,
      triggerContext,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    res.status(201).json(result);
  })
);

export default router;
