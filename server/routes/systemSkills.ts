import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemSkillService, UpdateSystemSkillPatch } from '../services/systemSkillService.js';
import { isSkillVisibility } from '../lib/skillVisibility.js';

const router = Router();

// ─── System Admin: System Skills ─
// As of Phase 0 of skill-analyzer-v2, system skills are DB-backed. The
// markdown files under server/skills/*.md are a seed source only — runtime
// reads and writes go through systemSkillService → the system_skills table.
// See docs/skill-analyzer-v2-spec.md §10 Phase 0.

// UUID detection — the frontend now navigates by DB UUID (skill.id from
// listSkills). Legacy slug-keyed links are still supported as a fallback.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/api/system/skills', authenticate, requireSystemAdmin, asyncHandler(async (_req, res) => {
  const skills = await systemSkillService.listSkills();
  res.json(skills);
}));

// GET-by-id-or-slug. The frontend now navigates by UUID (skill.id), so we
// route UUID params to the UUID-keyed getSkill() and fall back to the
// slug-keyed getSkillBySlugIncludingInactive() for any legacy links.
router.get('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  let skill;
  if (UUID_RE.test(id)) {
    try {
      skill = await systemSkillService.getSkill(id);
    } catch {
      skill = null;
    }
  } else {
    skill = await systemSkillService.getSkillBySlugIncludingInactive(id);
  }
  if (!skill) {
    res.status(404).json({ error: 'System skill not found' });
    return;
  }
  res.json(skill);
}));

// PATCH — two call sites with the same :id param (now UUID from the frontend):
//   1. List page: { visibility } only (toggle cascade visibility)
//   2. Edit page: { name, description, instructions, definition, isActive } (full save)
// Both are routed through updateSystemSkill which handles partial patches.
// Legacy slug-based callers fall back to updateSkillVisibility for visibility-only patches.
router.patch('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = req.body as {
    visibility?: unknown;
    name?: string;
    description?: string;
    instructions?: string | null;
    definition?: unknown;
    isActive?: boolean;
  };

  if (UUID_RE.test(id)) {
    // Validate visibility if present
    if (body.visibility !== undefined && !isSkillVisibility(body.visibility)) {
      res.status(400).json({ error: 'visibility must be one of: none, basic, full' });
      return;
    }
    const patch: UpdateSystemSkillPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.instructions !== undefined) patch.instructions = body.instructions;
    if (body.definition !== undefined) patch.definition = body.definition as UpdateSystemSkillPatch['definition'];
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.visibility !== undefined) patch.visibility = body.visibility as UpdateSystemSkillPatch['visibility'];
    const skill = await systemSkillService.updateSystemSkill(id, patch);
    res.json(skill);
  } else {
    // Legacy slug-based path: visibility-only patch
    if (!isSkillVisibility(body.visibility)) {
      res.status(400).json({ error: 'visibility must be one of: none, basic, full' });
      return;
    }
    const skill = await systemSkillService.updateSkillVisibility(id, body.visibility);
    res.json(skill);
  }
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
  // visibility is optional on create (defaults to 'none' in the service),
  // but if the caller supplies a value it must be a valid cascade enum —
  // silently coercing an unrecognised string to undefined hides typos.
  if (body.visibility !== undefined && !isSkillVisibility(body.visibility)) {
    res.status(400).json({ error: 'visibility must be one of: none, basic, full' });
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
    visibility: body.visibility,
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
