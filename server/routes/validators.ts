import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getAllValidatorSummaries } from '../lib/scorecardValidators/registry.js';

const router = Router();

router.get(
  '/api/validators',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const summaries = getAllValidatorSummaries();
    res.json(summaries);
  }),
);

export default router;
