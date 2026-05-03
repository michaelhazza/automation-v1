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
import { assertTaskVisibility } from '../websocket/taskRoom.js';
import { db } from '../db/index.js';
import { tasks } from '../db/schema/tasks.js';
import { eq, and } from 'drizzle-orm';

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

    // ── Visibility check ─────────────────────────────────────────────────
    // TODO(Chunk 10): the assertTaskVisibility call below uses a permissive stub
    // that allows any org member. Replace with the real permission helper
    // (requesterUserId + org admins + subaccount admins) before shipping to prod.
    // Structured log: task_room_visibility_stub_used (searchable in prod logs).
    //
    // org_admin / system_admin bypass fine-grained visibility
    if (userRole !== 'org_admin' && userRole !== 'system_admin') {
      // Verify task belongs to org first
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));

      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const allowed = await assertTaskVisibility(userId, taskId, orgId);
      if (!allowed) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    } else {
      // Admin: still verify org ownership
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));

      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
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
