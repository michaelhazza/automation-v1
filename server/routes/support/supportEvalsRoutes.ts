// supportEvalsRoutes.ts — Admin routes for the Support Agent eval harness.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.5.1, §5.5.4
//
// GET  /api/support/evals/latest — last 5 eval runs for the org
// POST /api/support/evals/run    — trigger an immediate eval run (system admin only)

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { listLatest, runOnce } from '../../services/supportEvalHarness.js';

const router = Router();

// GET /api/support/evals/latest
// Returns the last 5 support_eval_runs rows for the org.
// Permission: support.evals.view
router.get(
  '/evals/latest',
  authenticate,
  requireOrgPermission('support.evals.view'),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    const runs = await listLatest(organisationId, 5);
    res.json({ runs });
  }),
);

// POST /api/support/evals/run
// Triggers an immediate eval run. System admin only — this makes live LLM calls.
router.post(
  '/evals/run',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { organisationId } = req.body as { organisationId?: string };
    const orgId = organisationId ?? req.orgId!;
    const result = await runOnce(orgId);
    res.json(result);
  }),
);

export default router;
