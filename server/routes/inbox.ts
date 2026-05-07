import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { inboxService } from '../services/inboxService.js';

const router = Router();

const VALID_INBOX_KINDS = ['review_item', 'approval', 'task', 'agent_run'] as const;

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

/**
 * GET /api/inbox
 * Band-filtered inbox list (spec §4.2 InboxListResponse).
 * Query params:
 *   band        — 'high' | 'needs_action' | 'previous' (omit for all)
 *   q           — full-text search on item title
 *   subaccountId — scope to a single subaccount
 */
router.get(
  '/api/inbox',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.orgId!;

    const band = (req.query.band as string) || undefined;
    const q = (req.query.q as string) || undefined;
    const subaccountId = (req.query.subaccountId as string) || undefined;

    const VALID_BANDS = ['high', 'needs_action', 'previous'];
    if (band && !VALID_BANDS.includes(band)) {
      throw { statusCode: 400, message: `Invalid band. Must be one of: ${VALID_BANDS.join(', ')}` };
    }

    const items = await inboxService.listInboxByBand(userId, orgId, {
      band: band as 'high' | 'needs_action' | 'previous' | undefined,
      q,
      subaccountId,
    });

    res.json({ band: band ?? null, items, nextCursor: null });
  })
);

// ---------------------------------------------------------------------------
// Action endpoints (spec §4.2 + §6 idempotency)
// ---------------------------------------------------------------------------

/**
 * POST /api/inbox/:id/approve
 * Approve a review_item or approval-kind inbox item.
 * Body: { kind: 'review_item' | 'approval' }
 * Returns 200 { ok: true, alreadyApplied: boolean }
 * Returns 400 { errorCode: 'inbox_action_not_applicable' } for agent_run/task kinds.
 */
router.post(
  '/api/inbox/:id/approve',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.orgId!;
    const entityId = req.params.id;
    // guard-ignore-next-line: input-validation reason="kind validated against allowlist below"
    const { kind } = req.body as { kind?: string };

    if (!kind || !VALID_INBOX_KINDS.includes(kind as any)) {
      throw { statusCode: 400, message: `kind is required. Must be one of: ${VALID_INBOX_KINDS.join(', ')}` };
    }

    const result = await inboxService.approveItem(orgId, userId, {
      kind: kind as 'review_item' | 'approval' | 'task' | 'agent_run',
      entityId,
    });

    if (result.notApplicable) {
      throw { statusCode: 400, errorCode: 'inbox_action_not_applicable', message: 'Approve is not applicable to this item kind' };
    }

    res.json({ ok: result.ok, alreadyApplied: result.alreadyApplied });
  })
);

/**
 * POST /api/inbox/:id/reject
 * Reject a review_item or approval-kind inbox item.
 * Body: { kind: 'review_item' | 'approval', reason?: string }
 * Returns 200 { ok: true, alreadyApplied: boolean }
 * Returns 400 { errorCode: 'inbox_action_not_applicable' } for agent_run/task kinds.
 */
router.post(
  '/api/inbox/:id/reject',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.orgId!;
    const entityId = req.params.id;
    // guard-ignore-next-line: input-validation reason="kind validated against allowlist; reason length capped at 2000 chars below"
    const { kind, reason } = req.body as { kind?: string; reason?: string };

    if (!kind || !VALID_INBOX_KINDS.includes(kind as any)) {
      throw { statusCode: 400, message: `kind is required. Must be one of: ${VALID_INBOX_KINDS.join(', ')}` };
    }

    if (reason && reason.length > 2000) {
      throw { statusCode: 400, message: 'reason must not exceed 2000 characters' };
    }

    const result = await inboxService.rejectItem(orgId, userId, {
      kind: kind as 'review_item' | 'approval' | 'task' | 'agent_run',
      entityId,
    }, reason);

    if (result.notApplicable) {
      throw { statusCode: 400, errorCode: 'inbox_action_not_applicable', message: 'Reject is not applicable to this item kind' };
    }

    res.json({ ok: result.ok, alreadyApplied: result.alreadyApplied });
  })
);

/**
 * POST /api/inbox/:id/archive
 * Archive a single inbox item (all kinds supported).
 * Body: { kind: 'review_item' | 'approval' | 'task' | 'agent_run' }
 * Returns 200 { ok: true, alreadyApplied: false }
 */
router.post(
  '/api/inbox/:id/archive',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.orgId!;
    const entityId = req.params.id;
    // guard-ignore-next-line: input-validation reason="kind validated against allowlist below"
    const { kind } = req.body as { kind?: string };

    if (!kind || !VALID_INBOX_KINDS.includes(kind as any)) {
      throw { statusCode: 400, message: `kind is required. Must be one of: ${VALID_INBOX_KINDS.join(', ')}` };
    }

    const result = await inboxService.archiveItem(userId, orgId, {
      kind: kind as 'review_item' | 'approval' | 'task' | 'agent_run',
      entityId,
    });

    res.json({ ok: result.ok, alreadyApplied: result.alreadyApplied });
  })
);

export default router;
