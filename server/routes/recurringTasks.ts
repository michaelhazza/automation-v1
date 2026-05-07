import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recurringTasksService } from '../services/recurringTasksService.js';
import type { RecurringTasksQuery } from '../services/recurringTasksServicePure.js';
import { CursorDecodeError, CursorMismatchError } from '../services/recurringTasksServicePure.js';

const router = Router();

// ── Parse a query param that may be a single string or array of strings ───────
function parseArrayParam(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return [value];
}

// ── GET /api/recurring-tasks ──────────────────────────────────────────────────

router.get(
  '/api/recurring-tasks',
  authenticate,
  asyncHandler(async (req, res) => {
    const sortKey = req.query.sortKey as RecurringTasksQuery['sortKey'] | undefined;
    const sortDir = req.query.sortDir as 'asc' | 'desc' | undefined;

    const validSortKeys = [
      'name', 'fireCondition', 'action', 'scope', 'project',
      'status', 'lastFired', 'fires30d', 'nextFire',
    ] as const;

    if (sortKey && !validSortKeys.includes(sortKey as typeof validSortKeys[number])) {
      res.status(400).json({ error: `Invalid sortKey. Must be one of: ${validSortKeys.join(', ')}` });
      return;
    }

    if (sortDir && sortDir !== 'asc' && sortDir !== 'desc') {
      res.status(400).json({ error: 'sortDir must be "asc" or "desc"' });
      return;
    }

    const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;
    if (limitRaw !== undefined && (isNaN(limitRaw) || limitRaw < 1 || limitRaw > 500)) {
      res.status(400).json({ error: 'limit must be an integer between 1 and 500' });
      return;
    }

    const query: RecurringTasksQuery = {
      scope: req.query.scope as RecurringTasksQuery['scope'] | undefined,
      fireKind: parseArrayParam(req.query.fireKind as string | string[] | undefined) as RecurringTasksQuery['fireKind'] | undefined,
      status: parseArrayParam(req.query.status as string | string[] | undefined) as RecurringTasksQuery['status'] | undefined,
      agent: parseArrayParam(req.query.agent as string | string[] | undefined),
      project: parseArrayParam(req.query.project as string | string[] | undefined),
      q: req.query.q as string | undefined,
      cursor: req.query.cursor as string | undefined,
      limit: limitRaw,
      sortKey,
      sortDir,
    };

    try {
      const result = await recurringTasksService.list(req.orgId!, query);
      res.json(result);
    } catch (err) {
      if (err instanceof CursorDecodeError || err instanceof CursorMismatchError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

export default router;
