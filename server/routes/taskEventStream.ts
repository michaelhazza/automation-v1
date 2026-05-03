/**
 * taskEventStream.ts — replay endpoint for task-scoped execution events.
 *
 * GET /api/tasks/:taskId/event-stream/replay?fromSeq=N&fromSubseq=M
 *
 * Returns events with (task_sequence, event_subsequence) > (N, M).
 * Includes gap metadata so the client can detect retention window expiry.
 *
 * Spec: docs/workflows-dev-spec.md §8 replay-on-reconnect protocol.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { TaskEventService } from '../services/taskEventService.js';
import { resolveTaskVisibilityFromContext, loadTaskVisibilityContext } from '../services/taskVisibilityService.js';

const router = Router();

// UUID check — reject malformed IDs early
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * GET /api/tasks/:taskId/event-stream/replay
 *
 * Query params:
 *   fromSeq    — task_sequence cursor (inclusive lower bound exclusive, default 0)
 *   fromSubseq — event_subsequence cursor within fromSeq (default 0)
 *
 * Response:
 *   {
 *     events: TaskEventEnvelope[];
 *     hasGap: boolean;
 *     oldestRetainedSeq: number;
 *     nextCursor: { fromSeq: number; fromSubseq: number } | null;
 *   }
 *
 * When nextCursor is non-null, the caller should fetch again with those cursor
 * values to retrieve the next page. Loop until nextCursor is null.
 */
router.get(
  '/api/tasks/:taskId/event-stream/replay',
  authenticate,
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const orgId = req.orgId!;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    if (!isValidUUID(taskId)) {
      res.status(400).json({ error: 'Invalid taskId' });
      return;
    }

    // ── Visibility check — returns false when task not found ─────────────
    // resolveTaskVisibility also returns false for 404 (not found in org).
    // We distinguish 404 vs 403 by pre-loading context.
    const ctx = await loadTaskVisibilityContext(taskId, orgId);
    if (!ctx) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const allowed = await resolveTaskVisibilityFromContext(userId, userRole, ctx, orgId);
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // ── Parse cursor params ───────────────────────────────────────────────
    const fromSeq = Math.max(0, parseInt(String(req.query['fromSeq'] ?? '0'), 10) || 0);
    const fromSubseq = Math.max(0, parseInt(String(req.query['fromSubseq'] ?? '0'), 10) || 0);

    // ── Fetch events ──────────────────────────────────────────────────────
    const result = await TaskEventService.getEventsForReplay({
      taskId,
      organisationId: orgId,
      fromSeq,
      fromSubseq,
    });

    res.json(result);
  }),
);

export default router;
