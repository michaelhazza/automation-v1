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
// Triggers an immediate eval run for the caller's CURRENT org (req.orgId).
// System admin only — this makes live LLM calls.
//
// Cross-org eval triggering is intentionally NOT supported via request body —
// to evaluate a different org, system_admin must switch tenant context first
// so the action is auditable as that org's session and the org-scoped tx /
// RLS policies evaluate correctly. Accepting a body-supplied organisationId
// would otherwise allow any system_admin to attribute eval LLM spend and
// pollute eval history of any tenant from any session context.
router.post(
  '/evals/run',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const result = await runOnce(orgId);
    res.json(result);
  }),
);

export default router;
