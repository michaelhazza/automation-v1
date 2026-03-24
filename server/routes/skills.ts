import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { skillService } from '../services/skillService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── List skills (built-in + org-specific) ───────────────────────────────────

router.get('/api/skills', authenticate, async (req, res) => {
  try {
    const skills = await skillService.listSkills(req.orgId!);
    res.json(skills);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ─── Get single skill ────────────────────────────────────────────────────────

router.get('/api/skills/:id', authenticate, async (req, res) => {
  try {
    const skill = await skillService.getSkill(req.params.id);
    res.json(skill);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ─── Create custom skill (org-level) ─────────────────────────────────────────

router.post('/api/skills', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), async (req, res) => {
  try {
    const { name, slug, description, definition, instructions } = req.body;
    if (!name || !slug || !definition) {
      res.status(400).json({ error: 'name, slug, and definition are required' });
      return;
    }
    const skill = await skillService.createSkill(req.orgId!, { name, slug, description, definition, instructions });
    res.status(201).json(skill);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ─── Update custom skill ─────────────────────────────────────────────────────

router.patch('/api/skills/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const skill = await skillService.updateSkill(req.params.id, req.orgId!, req.body);
    res.json(skill);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ─── Delete custom skill ─────────────────────────────────────────────────────

router.delete('/api/skills/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_DELETE), async (req, res) => {
  try {
    await skillService.deleteSkill(req.params.id, req.orgId!);
    res.json({ message: 'Skill deleted' });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
