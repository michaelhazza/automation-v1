import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { categoryService } from '../services/categoryService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/api/categories', authenticate, asyncHandler(async (req, res) => {
  const result = await categoryService.listCategories(req.orgId!);
  res.json(result);
}));

router.post('/api/categories', authenticate, requireOrgPermission(ORG_PERMISSIONS.CATEGORIES_MANAGE), asyncHandler(async (req, res) => {
  const { name, description, colour } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Validation failed', details: 'name is required' });
    return;
  }
  const result = await categoryService.createCategory(req.orgId!, { name, description, colour });
  res.status(201).json(result);
}));

router.patch('/api/categories/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.CATEGORIES_MANAGE), asyncHandler(async (req, res) => {
  const result = await categoryService.updateCategory(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/categories/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.CATEGORIES_MANAGE), asyncHandler(async (req, res) => {
  const result = await categoryService.deleteCategory(req.params.id, req.orgId!);
  res.json(result);
}));

export default router;
