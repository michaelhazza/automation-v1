import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { categoryService } from '../services/categoryService.js';

const router = Router();

router.get('/api/categories', authenticate, async (req, res) => {
  try {
    const result = await categoryService.listCategories(req.user!.organisationId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/categories', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const { name, description, colour } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Validation failed', details: 'name is required' });
      return;
    }
    const result = await categoryService.createCategory(req.user!.organisationId, { name, description, colour });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/categories/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await categoryService.updateCategory(req.params.id, req.user!.organisationId, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/categories/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await categoryService.deleteCategory(req.params.id, req.user!.organisationId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
