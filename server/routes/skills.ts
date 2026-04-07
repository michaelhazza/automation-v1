import { Router } from 'express';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { skillService } from '../services/skillService.js';
import { systemSkillService } from '../services/systemSkillService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
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

// ─── List all skills (visible built-in + custom) for the skills library page ──
// Built-in skills are only included if the matching system skill has isVisible=true.

router.get('/api/skills/all', authenticate, asyncHandler(async (req, res) => {
  const [skills, visibleSystemSkills] = await Promise.all([
    skillService.listSkills(req.orgId!),
    systemSkillService.listVisibleSkills(),
  ]);
  const visibleSlugs = new Set(visibleSystemSkills.map(s => s.slug));
  const filtered = skills.filter((s: { skillType: string; slug: string }) =>
    s.skillType !== 'built_in' || visibleSlugs.has(s.slug)
  );
  // Decorate with canViewContents / canManageSkill per spec v3.4 §3 / T6.
  // List endpoints always include name + description; the body is stripped
  // for callers without contents access.
  const viewer = await resolveSkillViewer(req);
  res.json(filtered.map(s => skillService.decorateSkillForViewer(s, viewer)));
}));

// ─── List skills (org-specific custom skills only; built-in skills are now system-level) ──

router.get('/api/skills', authenticate, asyncHandler(async (req, res) => {
  const skills = await skillService.listSkills(req.orgId!);
  // Filter out built-in skills from org listing — they are now managed as system skills
  const orgSkills = skills.filter((s: { skillType: string }) => s.skillType !== 'built_in');
  const viewer = await resolveSkillViewer(req);
  res.json(orgSkills.map(s => skillService.decorateSkillForViewer(s, viewer)));
}));

// ─── Get single skill ────────────────────────────────────────────────────────

router.get('/api/skills/:id', authenticate, asyncHandler(async (req, res) => {
  const skill = await skillService.getSkill(req.params.id, req.orgId!);
  const viewer = await resolveSkillViewer(req);
  res.json(skillService.decorateSkillForViewer(skill, viewer));
}));

// ─── Create custom skill (org-level) ─────────────────────────────────────────

router.post('/api/skills', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res) => {
  const { name, slug, description, definition, instructions, methodology } = req.body;
  if (!name || !slug || !definition) {
    res.status(400).json({ error: 'name, slug, and definition are required' });
    return;
  }
  const skill = await skillService.createSkill(req.orgId!, { name, slug, description, definition, instructions, methodology });
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

export default router;
