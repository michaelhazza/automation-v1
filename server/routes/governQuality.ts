// server/routes/governQuality.ts
// Govern / Quality tab endpoints.
// Trust & Verification Layer spec §12.4.

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { benchRunService } from '../services/benchRunService.js';

const router = Router();

// ── GET /api/quality/agents ───────────────────────────────────────────────────
// Returns per-agent drift summary: last judge date, average score, pending count.

router.get(
  '/api/quality/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (_req, res) => {
    const agents = await benchRunService.listAgentsDrift();
    res.json({ agents });
  }),
);

// ── GET /api/quality/bench-history ───────────────────────────────────────────
// Returns the 50 most recent bench runs for the org.

router.get(
  '/api/quality/bench-history',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (_req, res) => {
    const benchRuns = await benchRunService.listBenchHistory();
    res.json({ benchRuns });
  }),
);

export default router;
