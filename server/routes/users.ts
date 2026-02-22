import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userService } from '../services/userService.js';

const router = Router();

// Managers and above can list and manage users within the active org
router.get('/api/users', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const result = await userService.listUsers(req.orgId!, {
      role: req.query.role as string | undefined,
      status: req.query.status as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/users/invite', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { email, role, firstName, lastName } = req.body;
    if (!email || !role) {
      res.status(400).json({ error: 'Validation failed', details: 'email and role are required' });
      return;
    }
    const result = await userService.inviteUser(req.orgId!, req.user!.id, req.user!.role, { email, role, firstName, lastName });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/users/me', authenticate, async (req, res) => {
  try {
    const result = await userService.getCurrentUserProfile(req.user!.id);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/users/me', authenticate, async (req, res) => {
  try {
    const result = await userService.updateCurrentUserProfile(req.user!.id, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/users/:id', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const result = await userService.getUser(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/users/:id', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const result = await userService.updateUser(req.params.id, req.orgId!, req.user!.role, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/users/:id', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const result = await userService.deleteUser(req.params.id, req.orgId!, req.user!.id, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
