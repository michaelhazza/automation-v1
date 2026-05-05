import { Router } from 'express';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { skillService } from '../services/skillService.js';
import { systemSkillService } from '../services/systemSkillService.js';
import { agentService } from '../services/agentService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
import { deriveTestRunIdempotencyCandidates } from '../lib/testRunIdempotency.js';
import type { SkillTier } from '../lib/skillVisibility.js';

const router = Router();

/**
 * Determine the viewer's tier and manage permission for a skill, used by
 * the visibility decorator (Code Change A / spec v3.4 §3 / T6).
 *
 * - system_admin → 'system' tier with manage permission
 * - org_admin or holders of AGENTS_EDIT → 'organisation' tier with manage
 * - everyone else → 'organisation' tier without manage permission
 *
 * Subaccount-tier viewers are not currently distinguished from org tier in
 * this route file because the route paths themselves are org-scoped. When
 * subaccount-scoped skill routes are added, the tier resolution will need
 * to be re-checked.
 */
async function resolveSkillViewer(req: import('express').Request): Promise<{ tier: SkillTier; hasManagePermission: boolean }> {
  if (req.user?.role === 'system_admin') {
    return { tier: 'system', hasManagePermission: true };
  }
  const hasManage = await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_EDIT);
  return { tier: 'organisation', hasManagePermission: hasManage };
}

// ─── List all skills (custom + opted-in system) for the skills library page ──
// System skills are only included if the system admin has set their cascade
// visibility to 'basic' or 'full'. Org skills are decorated by the same
// visibility logic if the viewer is below the organisation tier (currently
// always organisation, so no-op — but the cascade plumbing is in place for
// when a subaccount-scoped skills route lands).

router.get('/api/skills/all', authenticate, asyncHandler(async (req, res) => {
  const viewer = await resolveSkillViewer(req);
  const [orgSkills, visibleSystemSkills] = await Promise.all([
    skillService.listSkills(req.orgId!),
    systemSkillService.listVisibleSkills(),
  ]);

  // Org-level skills go through the visibility decorator. nulls = invisible.
  const decoratedOrg = orgSkills
    .filter((s: { skillType: string }) => s.skillType !== 'built_in')
    .map(s => skillService.decorateSkillForViewer(s, viewer))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // System skills come from the file-based service. We project them into
  // the same shape the org list uses so the client can render them in one
  // table. Body is stripped when visibility === 'basic'.
  const projectedSystem = visibleSystemSkills.map(s => {
    const stripped = s.visibility === 'full' ? s : systemSkillService.stripBodyForBasic(s);
    return {
      id: stripped.id,
      organisationId: null,
      name: stripped.name,
      slug: stripped.slug,
      description: stripped.description,
      skillType: 'built_in' as const,
      definition: stripped.definition,
      instructions: stripped.instructions,
      isActive: stripped.isActive,
      visibility: stripped.visibility,
      createdAt: null,
      updatedAt: null,
      deletedAt: null,
      canViewContents: stripped.visibility === 'full',
      canManageSkill: false, // org users cannot manage system skills
    };
  });

  res.json([...projectedSystem, ...decoratedOrg]);
}));

// ─── List skills (org-specific custom skills only; built-in skills are now system-level) ──

router.get('/api/skills', authenticate, asyncHandler(async (req, res) => {
  const skills = await skillService.listSkills(req.orgId!);
  // Filter out built-in skills from org listing — they are now managed as system skills
  const orgSkills = skills.filter((s: { skillType: string }) => s.skillType !== 'built_in');
  const viewer = await resolveSkillViewer(req);
  res.json(
    orgSkills
      .map(s => skillService.decorateSkillForViewer(s, viewer))
      .filter((s): s is NonNullable<typeof s> => s !== null),
  );
}));

// ─── Get single skill ────────────────────────────────────────────────────────

router.get('/api/skills/:id', authenticate, asyncHandler(async (req, res) => {
  const skill = await skillService.getSkill(req.params.id, req.orgId!);
  const viewer = await resolveSkillViewer(req);
  const decorated = skillService.decorateSkillForViewer(skill, viewer);
  if (!decorated) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json(decorated);
}));

// ─── Update skill visibility (inline from the list page) ─────────────────────

router.patch(
  '/api/skills/:id/visibility',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { visibility } = req.body;
    const skill = await skillService.updateSkillVisibility(req.params.id, req.orgId!, visibility);
    res.json(skill);
  }),
);

// ─── Create custom skill (org-level) ─────────────────────────────────────────

router.post('/api/skills', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res) => {
  const { name, slug, description, definition, instructions } = req.body;
  if (!name || !slug || !definition) {
    res.status(400).json({ error: 'name, slug, and definition are required' });
    return;
  }
  const skill = await skillService.createSkill(req.orgId!, { name, slug, description, definition, instructions });
  res.status(201).json(skill);
}));

// ─── Update custom skill ─────────────────────────────────────────────────────

router.patch('/api/skills/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const skill = await skillService.updateSkill(req.params.id, req.orgId!, req.body);
  res.json(skill);
}));

// ─── Delete custom skill ─────────────────────────────────────────────────────

router.delete('/api/skills/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_DELETE), asyncHandler(async (req, res) => {
  await skillService.deleteSkill(req.params.id, req.orgId!);
  res.json({ message: 'Skill deleted' });
}));

// ── Feature 2 — org-scoped skill test run ────────────────────────────────────
// Resolves the org subaccount and its first active agent link, then executes a
// test run with allowedToolSlugs=[skill.slug] so the agent actually invokes the
// skill under test rather than its default toolset.
router.post('/api/org/skills/:skillId/test-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
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
    const skill = await skillService.getSkill(req.params.skillId, req.orgId!);

    // Resolve the org subaccount and find an agent link within it.
    const { requireOrgSubaccount } = await import('../services/orgSubaccountService.js');
    const orgSa = await requireOrgSubaccount(req.orgId!);
    const orgAgents = await agentService.listAgents(req.orgId!);
    if (orgAgents.length === 0) {
      res.status(422).json({ error: 'No active agent found to run this skill. Create and activate an agent first.' });
      return;
    }

    // Find the first agent that has a link in the org subaccount.
    let saLink: Awaited<ReturnType<typeof subaccountAgentService.getLinkByAgentInSubaccount>> | null = null;
    for (const agent of orgAgents) {
      saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, orgSa.id, agent.id);
      if (saLink) break;
    }
    if (!saLink) {
      res.status(422).json({ error: 'No agent config found in the organisation workspace. Link an agent to the workspace first.' });
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
      targetType: 'org-skill',
      targetId: skill.id,
      input: { prompt: prompt ?? null, inputJson: inputJson ?? null },
      clientKeyHint: idempotencyKey,
    });
    const result = await agentExecutionService.executeRun({
      agentId: saLink.agentId,
      organisationId: req.orgId!,
      subaccountId: orgSa.id,
      subaccountAgentId: saLink.id,
      executionScope: 'subaccount',
      runType: 'manual',
      executionMode: 'api',
      runSource: 'manual',
      isTestRun: true,
      userId: req.user!.id,
      triggerContext,
      allowedToolSlugs: [skill.slug],
      idempotencyKey: currentKey,
      idempotencyCandidateKeys: [currentKey, previousKey],
    });
    res.status(201).json(result);
  })
);

export default router;
