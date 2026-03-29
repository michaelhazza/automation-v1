import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { reviewService } from '../services/reviewService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── Get review queue for a subaccount ────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/review-queue',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  async (req, res) => {
    try {
      const items = await reviewService.getReviewQueue(req.orgId!, req.params.subaccountId);
      res.json(items);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Get review queue count (lightweight, for nav badge) ──────────────────────

router.get(
  '/api/subaccounts/:subaccountId/review-queue/count',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  async (req, res) => {
    try {
      const count = await reviewService.getReviewQueueCount(req.orgId!, req.params.subaccountId);
      res.json({ count });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Get single review item ──────────────────────────────────────────────────

router.get(
  '/api/review-items/:id',
  authenticate,
  async (req, res) => {
    try {
      const item = await reviewService.getReviewItem(req.params.id, req.orgId!);
      res.json(item);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Approve a review item ───────────────────────────────────────────────────

router.post(
  '/api/review-items/:id/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  async (req, res) => {
    try {
      const { edits } = req.body;
      const result = await reviewService.approveItem(req.params.id, req.orgId!, req.userId!, edits);
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Reject a review item ───────────────────────────────────────────────────

router.post(
  '/api/review-items/:id/reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  async (req, res) => {
    try {
      const result = await reviewService.rejectItem(req.params.id, req.orgId!, req.userId!);
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Bulk approve ─────────────────────────────────────────────────────────────

router.post(
  '/api/review-items/bulk-approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids (array) is required' });
        return;
      }
      const result = await reviewService.bulkApprove(ids, req.orgId!, req.userId!);
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Bulk reject ──────────────────────────────────────────────────────────────

router.post(
  '/api/review-items/bulk-reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE),
  async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids (array) is required' });
        return;
      }
      const result = await reviewService.bulkReject(ids, req.orgId!, req.userId!);
      res.json(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
