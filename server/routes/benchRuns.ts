// server/routes/benchRuns.ts
// Bench run REST endpoints.
// Trust & Verification Layer spec §12.4.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { benchRunService } from '../services/benchRunService.js';

const router = Router();

// ── Request body schemas ──────────────────────────────────────────────────────

const estimateBody = z.object({
  candidateModelIds: z.array(z.string().min(1)).min(1).max(10),
  judgeModelId: z.string().min(1),
  sampleCount: z.number().int().min(1).max(50),
  targetAgentId: z.string().uuid().optional().nullable(),
  targetSkillSlug: z.string().optional().nullable(),
});

const approveBody = z.object({
  candidateModelId: z.string().min(1),
});

// ── POST /api/bench-runs/estimate ─────────────────────────────────────────────
// Creates a bench_run in 'awaiting_confirm' state with cost estimate.
// M2 judge-swap and M3 cost-cap enforced before persisting.

router.post(
  '/api/bench-runs/estimate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_BENCH_RUN),
  validateBody(estimateBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof estimateBody>;
    const result = await benchRunService.estimate({
      organisationId: req.orgId!,
      triggeredByUserId: req.user!.id,
      candidateModelIds: body.candidateModelIds,
      judgeModelId: body.judgeModelId,
      sampleCount: body.sampleCount,
      targetAgentId: body.targetAgentId ?? null,
      targetSkillSlug: body.targetSkillSlug ?? null,
    });
    res.status(201).json(result);
  }),
);

// ── POST /api/bench-runs/:id/run ──────────────────────────────────────────────
// Confirms the estimate and enqueues the bench execute job.
// Returns 412 if the bench_run is not in 'awaiting_confirm' state.

router.post(
  '/api/bench-runs/:id/run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_BENCH_RUN),
  asyncHandler(async (req, res) => {
    await benchRunService.run(req.params.id!);
    res.status(202).json({ status: 'running' });
  }),
);

// ── GET /api/bench-runs/:id ───────────────────────────────────────────────────
// Returns the full bench_run row including summary.

router.get(
  '/api/bench-runs/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const run = await benchRunService.get(req.params.id!);
    if (!run) {
      res.status(404).json({ error: 'Bench run not found' });
      return;
    }
    res.json(run);
  }),
);

// ── GET /api/bench-runs/:id/results ──────────────────────────────────────────
// Returns per-candidate per-sample results for a bench run.

router.get(
  '/api/bench-runs/:id/results',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const results = await benchRunService.listResults(req.params.id!);
    res.json({ results });
  }),
);

// ── POST /api/bench-runs/:id/approve ─────────────────────────────────────────
// F5 atomic approval: sets approved_model_id + transitions to 'completed'.
// Throws 412 if not in 'awaiting_approval'; 422 if candidateModelId invalid.

router.post(
  '/api/bench-runs/:id/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_BENCH_RUN),
  validateBody(approveBody, 'enforce'),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof approveBody>;
    const result = await benchRunService.approve(req.params.id!, body.candidateModelId);
    res.json(result);
  }),
);

export default router;
