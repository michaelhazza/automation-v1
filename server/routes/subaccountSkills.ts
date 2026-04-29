import { Router } from 'express';
import { authenticate, requireSubaccountPermission, requireOrgPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS, ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { skillService } from '../services/skillService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
import { deriveTestRunIdempotencyCandidates } from '../lib/testRunIdempotency.js';
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
    const limitResult = await rateLimitCheck(rateLimitKeys.testRun(req.user!.id), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600);
    if (!limitResult.allowed) {
      setRateLimitDeniedHeaders(res, limitResult.resetAt, limitResult.nowEpochMs);
      res.status(429).json({ error: `Too many test runs (max ${TEST_RUN_RATE_LIMIT_PER_HOUR} per hour). Please try again later.` });
      return;
    }
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
    const [currentKey, previousKey] = deriveTestRunIdempotencyCandidates({
      userId: req.user!.id,
      targetType: 'subaccount-skill',
      targetId: skill.id,
      input: { prompt: prompt ?? null, inputJson: inputJson ?? null, subaccountId },
      clientKeyHint: idempotencyKey,
    });
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
      idempotencyKey: currentKey,
      idempotencyCandidateKeys: [currentKey, previousKey],
    });
    res.status(201).json(result);
  })
);

export default router;
