import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { permissionGroupService } from '../services/permissionGroupService.js';

const router = Router();

router.get('/api/permission-groups', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await permissionGroupService.listPermissionGroups(req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/permission-groups', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Validation failed', details: 'name is required' });
      return;
    }
    const result = await permissionGroupService.createPermissionGroup(req.orgId!, { name, description });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/permission-groups/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await permissionGroupService.getPermissionGroup(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/permission-groups/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await permissionGroupService.updatePermissionGroup(req.params.id, req.orgId!, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/permission-groups/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await permissionGroupService.deletePermissionGroup(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/permission-groups/:id/members', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'Validation failed', details: 'userId is required' });
      return;
    }
    const result = await permissionGroupService.addMember(req.params.id, req.orgId!, userId);
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/permission-groups/:id/members/:userId', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await permissionGroupService.removeMember(req.params.id, req.orgId!, req.params.userId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/permission-groups/:id/categories', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) {
      res.status(400).json({ error: 'Validation failed', details: 'categoryId is required' });
      return;
    }
    const result = await permissionGroupService.addCategory(req.params.id, req.orgId!, categoryId);
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/permission-groups/:id/categories/:categoryId', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await permissionGroupService.removeCategory(req.params.id, req.orgId!, req.params.categoryId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
