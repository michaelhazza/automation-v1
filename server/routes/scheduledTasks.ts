import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { scheduledTaskService } from '../services/scheduledTaskService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── List scheduled tasks for a subaccount ──────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  async (req, res) => {
    try {
      const list = await scheduledTaskService.list(req.orgId!, req.params.subaccountId);
      res.json(list);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Create a scheduled task ────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      const { subaccountId } = req.params;
      const {
        title, description, brief, priority, assignedAgentId,
        rrule, timezone, scheduleTime, retryPolicy, tokenBudgetPerRun,
        endsAt, endsAfterRuns,
      } = req.body;

      if (!title || !assignedAgentId || !rrule || !scheduleTime) {
        res.status(400).json({ error: 'title, assignedAgentId, rrule, and scheduleTime are required' });
        return;
      }

      const created = await scheduledTaskService.create(
        req.orgId!,
        subaccountId,
        {
          title, description, brief, priority, assignedAgentId,
          rrule, timezone, scheduleTime, retryPolicy, tokenBudgetPerRun,
          endsAt: endsAt ? new Date(endsAt) : undefined,
          endsAfterRuns,
        },
        req.user!.id
      );

      res.status(201).json(created);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Get scheduled task detail ──────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  async (req, res) => {
    try {
      const detail = await scheduledTaskService.getDetail(req.params.stId, req.orgId!);
      res.json(detail);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Update a scheduled task ────────────────────────────────────────────────

router.patch(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      const updated = await scheduledTaskService.update(req.params.stId, req.orgId!, req.body);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Delete a scheduled task ────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      await scheduledTaskService.delete(req.params.stId, req.orgId!);
      res.json({ success: true });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Toggle active/paused ───────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/toggle',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      const { isActive } = req.body;
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ error: 'isActive (boolean) is required' });
        return;
      }
      const updated = await scheduledTaskService.toggleActive(req.params.stId, req.orgId!, isActive);
      res.json(updated);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Run now (manual trigger) ───────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/run-now',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  async (req, res) => {
    try {
      // Fire the occurrence immediately (doesn't affect the regular schedule)
      await scheduledTaskService.fireOccurrence(req.params.stId);
      res.json({ success: true, message: 'Scheduled task triggered' });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
