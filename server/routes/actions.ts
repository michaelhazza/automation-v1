import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { actionService } from '../services/actionService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── List actions for a subaccount ────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/actions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  async (req, res) => {
    try {
      const { status } = req.query;
      const items = await actionService.listActions(
        req.orgId!,
        req.params.subaccountId,
        typeof status === 'string' ? status : undefined
      );
      res.json(items);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Get action events (audit trail) ──────────────────────────────────────────

router.get(
  '/api/actions/:id/events',
  authenticate,
  async (req, res) => {
    try {
      const events = await actionService.getActionEvents(req.params.id, req.orgId!);
      res.json(events);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Get single action ───────────────────────────────────────────────────────

router.get(
  '/api/actions/:id',
  authenticate,
  async (req, res) => {
    try {
      const action = await actionService.getAction(req.params.id, req.orgId!);
      res.json(action);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
