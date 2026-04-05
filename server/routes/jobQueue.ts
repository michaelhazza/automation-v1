import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { jobQueueHealthService } from '../services/jobQueueHealthService.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ─── Queue health summaries (system admin only) ─────────────────────────────

router.get(
  '/api/system/job-queues',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const summaries = await jobQueueHealthService.getQueueSummaries();
    res.json(summaries);
  })
);

// ─── DLQ jobs for a specific queue ──────────────────────────────────────────

router.get(
  '/api/system/job-queues/:queue/dlq',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { queue } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const jobs = await jobQueueHealthService.getDlqJobs(queue, limit, offset);
    res.json(jobs);
  })
);

export default router;
