import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { inboxService } from '../services/inboxService.js';

const router = Router();

/**
 * GET /api/inbox/unified
 * Aggregated inbox across tasks (status='inbox'), review items (pending),
 * failed agent runs, and budget alerts.
 */
router.get(
  '/api/inbox/unified',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.orgId!;

    const tab = (req.query.tab as string) || 'all';
    const search = (req.query.search as string) || undefined;
    const subaccountId = (req.query.subaccountId as string) || undefined;
    const subaccountIds = req.query.subaccountIds ? (req.query.subaccountIds as string).split(',') : undefined;
    const sortBy = (req.query.sortBy as string) || undefined;
    const sortDirection = (req.query.sortDirection as string) || undefined;

    if (!['all', 'tasks', 'reviews', 'failed_runs'].includes(tab)) {
      throw { statusCode: 400, message: 'Invalid tab. Must be one of: all, tasks, reviews, failed_runs' };
    }
    if (sortBy && !['updatedAt', 'priority', 'type', 'subaccount'].includes(sortBy)) {
      throw { statusCode: 400, message: 'Invalid sortBy. Must be one of: updatedAt, priority, type, subaccount' };
    }
    if (sortDirection && !['asc', 'desc'].includes(sortDirection)) {
      throw { statusCode: 400, message: 'Invalid sortDirection. Must be asc or desc' };
    }

    const items = await inboxService.getUnifiedInbox(userId, orgId, {
      tab: tab as 'all' | 'tasks' | 'reviews' | 'failed_runs',
      search,
      subaccountId,
      subaccountIds,
      sortBy: sortBy as any,
      sortDirection: sortDirection as any,
      orgWide: !subaccountId && !subaccountIds, // org-wide when no subaccount filter
    });

    res.json(items);
  })
);

/**
 * POST /api/inbox/mark-read
 * Mark one or more inbox items as read.
 * Body: { items: [{ entityType, entityId }] }
 */
router.post(
  '/api/inbox/mark-read',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    // guard-ignore-next-line: input-validation reason="manual validation enforced: items required, Array.isArray check, non-empty check"
    const { items } = req.body as {
      items?: Array<{ entityType: 'task' | 'review_item' | 'agent_run'; entityId: string }>;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw { statusCode: 400, message: 'items array is required and must not be empty' };
    }

    await inboxService.markRead(userId, req.orgId!, items);
    res.json({ success: true });
  })
);

/**
 * POST /api/inbox/mark-unread
 * Mark one or more inbox items as unread.
 * Body: { items: [{ entityType, entityId }] }
 */
router.post(
  '/api/inbox/mark-unread',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { items } = req.body as {
      items?: Array<{ entityType: 'task' | 'review_item' | 'agent_run'; entityId: string }>;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw { statusCode: 400, message: 'items array is required and must not be empty' };
    }

    await inboxService.markUnread(userId, req.orgId!, items);
    res.json({ success: true });
  })
);

/**
 * POST /api/inbox/archive
 * Archive one or more inbox items.
 * Body: { items: [{ entityType, entityId }] }
 */
router.post(
  '/api/inbox/archive',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { items } = req.body as {
      items?: Array<{ entityType: 'task' | 'review_item' | 'agent_run'; entityId: string }>;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw { statusCode: 400, message: 'items array is required and must not be empty' };
    }

    await inboxService.archiveItems(userId, req.orgId!, items);
    res.json({ success: true });
  })
);

/**
 * GET /api/inbox/counts
 * Unread counts per category for the current user.
 */
router.get(
  '/api/inbox/counts',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.orgId!;

    const subaccountId = (req.query.subaccountId as string) || undefined;
    const subaccountIds = req.query.subaccountIds ? (req.query.subaccountIds as string).split(',') : undefined;
    const counts = await inboxService.getCounts(userId, orgId, {
      subaccountId,
      subaccountIds,
      orgWide: !subaccountId && !subaccountIds,
    });
    res.json(counts);
  })
);

export default router;
