import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemSkillService } from '../services/systemSkillService.js';

const router = Router();

// ─── System Admin: System Skill CRUD ──────────────────────────────────────────

router.get('/api/system/skills', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const skills = await systemSkillService.listSkills();
  res.json(skills);
}));

router.get('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const skill = await systemSkillService.getSkill(req.params.id);
  res.json(skill);
}));

router.post('/api/system/skills', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, definition } = req.body;
  if (!name || !definition) {
    res.status(400).json({ error: 'name and definition are required' });
    return;
  }
  const skill = await systemSkillService.createSkill(req.body);
  res.status(201).json(skill);
}));

router.patch('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const skill = await systemSkillService.updateSkill(req.params.id, req.body);
  res.json(skill);
}));

router.delete('/api/system/skills/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  await systemSkillService.deleteSkill(req.params.id);
  res.json({ message: 'System skill deleted' });
}));

export default router;
