import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemSkillService } from '../services/systemSkillService.js';
import { isSkillVisibility } from '../lib/skillVisibility.js';

const router = Router();

// ─── System Admin: System Skills (read-only — source of truth is server/skills/*.md) ─

router.get('/api/system/skills', authenticate, requireSystemAdmin, asyncHandler(async (_req, res) => {
  const skills = await systemSkillService.listSkills();
  res.json(skills);
}));

router.get('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const skill = await systemSkillService.getSkill(req.params.id);
  res.json(skill);
}));

// PATCH: only `visibility` is writable (writes back to the .md frontmatter).
// Accepts the three-state cascade enum: 'none' | 'basic' | 'full'.
router.patch('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { visibility } = req.body;
  if (!isSkillVisibility(visibility)) {
    res.status(400).json({ error: 'visibility must be one of: none, basic, full' });
    return;
  }
  const skill = await systemSkillService.updateSkillVisibility(req.params.id, visibility);
  res.json(skill);
}));

// Skills are file-based — create/delete routes are not supported.
const notSupported = (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
  res.status(405).json({ error: 'System skills are managed as files in server/skills/. Use the codebase to add or modify skills.' });
};

router.post('/api/system/skills', authenticate, requireSystemAdmin, notSupported);
router.delete('/api/system/skills/:id', authenticate, requireSystemAdmin, notSupported);

export default router;
