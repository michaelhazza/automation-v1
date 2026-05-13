import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { parsePositiveInt } from '../middleware/validate.js';
import { executionService } from '../services/executionService.js';

const router = Router();

/**
 * GET /api/system/executions
 * System-admin-only: list executions across ALL organisations with diagnostic fields.
 */
router.get('/api/system/executions', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const {
    organisationId,
    status,
    engineType,
    from,
    to,
    limit: limitRaw,
    offset: offsetRaw,
  } = req.query;

  const rows = await executionService.listSystemExecutions({
    organisationId: organisationId as string | undefined,
    status: status as string | undefined,
    engineType: engineType as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
    limit: parsePositiveInt(limitRaw) ?? 50,
    offset: parsePositiveInt(offsetRaw) ?? 0,
  });

  res.json(rows);
}));

/**
 * GET /api/system/executions/:id
 * System-admin-only: full diagnostic detail for a single execution.
 */
router.get('/api/system/executions/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const row = await executionService.getSystemExecution(req.params.id);

  if (!row) {
    res.status(404).json({ error: 'Execution not found' });
    return;
  }

  res.json(row);
}));

export default router;
