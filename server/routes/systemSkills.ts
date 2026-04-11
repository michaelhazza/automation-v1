import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemSkillService } from '../services/systemSkillService.js';
import { isSkillVisibility } from '../lib/skillVisibility.js';

const router = Router();

// ─── System Admin: System Skills ─
// As of Phase 0 of skill-analyzer-v2, system skills are DB-backed. The
// markdown files under server/skills/*.md are a seed source only — runtime
// reads and writes go through systemSkillService → the system_skills table.
// See docs/skill-analyzer-v2-spec.md §10 Phase 0.

router.get('/api/system/skills', authenticate, requireSystemAdmin, asyncHandler(async (_req, res) => {
  const skills = await systemSkillService.listSkills();
  res.json(skills);
}));

// GET-by-slug. The URL :id parameter has historically been the skill slug
// (e.g. 'web_search') because the file-based service keyed ids by slug.
// Preserving the slug-keyed route contract for frontend compatibility — the
// new DB-backed getSkill(id) is strictly UUID-keyed, so this route calls
// getSkillBySlug instead. Frontend migration to UUID lookups is a follow-on
// concern.
router.get('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const skill = await systemSkillService.getSkillBySlug(req.params.id);
  if (!skill) {
    res.status(404).json({ error: 'System skill not found' });
    return;
  }
  res.json(skill);
}));

// PATCH visibility. The URL :id parameter is the slug, matching the GET route
// above. Writes through to the system_skills DB row.
router.patch('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { visibility } = req.body;
  if (!isSkillVisibility(visibility)) {
    res.status(400).json({ error: 'visibility must be one of: none, basic, full' });
    return;
  }
  const skill = await systemSkillService.updateSkillVisibility(req.params.id, visibility);
  res.json(skill);
}));

// POST: create a new system skill via the analyzer-approve or the system-admin
// CRUD flow. Every new row must have handlerKey = slug, and the slug must
// already exist as a key in SKILL_HANDLERS (server/services/skillExecutor.ts);
// createSystemSkill enforces both invariants and throws with a clear 400 on
// violation. See spec §5.5 and §10 Phase 0.
router.post('/api/system/skills', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const body = req.body as {
    slug?: string;
    name?: string;
    description?: string;
    definition?: unknown;
    instructions?: string | null;
    visibility?: unknown;
    isActive?: boolean;
  };
  if (typeof body.slug !== 'string' || body.slug.length === 0) {
    res.status(400).json({ error: 'slug is required' });
    return;
  }
  if (typeof body.name !== 'string' || body.name.length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof body.description !== 'string') {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  const skill = await systemSkillService.createSystemSkill({
    slug: body.slug,
    handlerKey: body.slug,
    name: body.name,
    description: body.description,
    // The service's assertValidDefinition enforces the tool-definition shape
    // before any DB write, so we hand the value straight through.
    definition: body.definition as never,
    instructions: body.instructions ?? null,
    visibility: isSkillVisibility(body.visibility) ? body.visibility : undefined,
    isActive: body.isActive,
  });
  res.status(201).json(skill);
}));

// DELETE stays unsupported — deletion would strand any system_agent rows
// that reference the skill in their defaultSystemSkillSlugs array. If
// retirement is needed, set isActive = false via a PATCH or via a follow-on
// admin flow.
router.delete('/api/system/skills/:id', authenticate, requireSystemAdmin, (_req, res) => {
  res.status(405).json({ error: 'System skill delete is not supported. Set isActive = false to retire a skill.' });
});

export default router;
