import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { skillService } from '../services/skillService.js';
import { systemSkillService } from '../services/systemSkillService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── List all skills (visible built-in + custom) for the skills library page ──
// Built-in skills are only included if the matching system skill has isVisible=true.

router.get('/api/skills/all', authenticate, asyncHandler(async (req, res) => {
  const [skills, visibleSystemSkills] = await Promise.all([
    skillService.listSkills(req.orgId!),
    systemSkillService.listVisibleSkills(),
  ]);

  // Start with custom (non-built-in) skills from the DB
  const customSkills = skills.filter((s: { skillType: string }) => s.skillType !== 'built_in');

  // Map visible system skills into the shape the frontend expects,
  // preferring the DB row if one exists (so org-level overrides are preserved)
  const dbSlugSet = new Set(skills.map((s: { slug: string }) => s.slug));
  const systemAsBuiltIn = visibleSystemSkills
    .filter(ss => !dbSlugSet.has(ss.slug))
    .map(ss => ({
      id: ss.id,
      slug: ss.slug,
      name: ss.name,
      description: ss.description,
      skillType: 'built_in' as const,
      isActive: ss.isActive,
      organisationId: null,
      methodology: ss.methodology,
      createdAt: null,
      updatedAt: null,
    }));

  // Also include DB built-in skills that are visible
  const visibleSlugs = new Set(visibleSystemSkills.map(s => s.slug));
  const dbBuiltIn = skills.filter((s: { skillType: string; slug: string }) =>
    s.skillType === 'built_in' && visibleSlugs.has(s.slug)
  );

  res.json([...customSkills, ...dbBuiltIn, ...systemAsBuiltIn]);
}));

// ─── List skills (org-specific custom skills only; built-in skills are now system-level) ──

router.get('/api/skills', authenticate, asyncHandler(async (req, res) => {
  const skills = await skillService.listSkills(req.orgId!);
  // Filter out built-in skills from org listing — they are now managed as system skills
  const orgSkills = skills.filter((s: { skillType: string }) => s.skillType !== 'built_in');
  res.json(orgSkills);
}));

// ─── Get single skill ────────────────────────────────────────────────────────

router.get('/api/skills/:id', authenticate, asyncHandler(async (req, res) => {
  const skill = await skillService.getSkill(req.params.id, req.orgId!);
  res.json(skill);
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
