import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemPnlService } from '../services/systemPnlService.js';
import type { PnlResponse, PnlResponseMeta } from '../../shared/types/systemPnl.js';

// ---------------------------------------------------------------------------
// System P&L admin routes (spec §11.3).
//
// Every endpoint is authenticated + requireSystemAdmin. The service layer
// does cross-organisation reads by design — this is the one admin surface
// that is intentionally cross-tenant.
//
// Response envelope: { data, meta } per §19.9.
// ---------------------------------------------------------------------------

const router = Router();

function defaultMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// Parse and validate `month` query param. Format `YYYY-MM`, month 01–12.
// Invalid values throw a 400 — prevents silent zero-result responses and
// NaN period keys downstream in `previousMonth()`.
function parseMonthParam(raw: unknown): string {
  const month = (typeof raw === 'string' && raw.length > 0) ? raw : defaultMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw { statusCode: 400, errorCode: 'INVALID_MONTH', message: 'month must be YYYY-MM format, month 01–12' };
  }
  return month;
}

function wrap<TData>(data: TData, period: string): PnlResponse<TData> {
  const meta: PnlResponseMeta = {
    period,
    generatedAt: new Date().toISOString(),
  };
  return { data, meta };
}

router.get(
  '/api/admin/llm-pnl/summary',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const month = parseMonthParam(req.query.month);
    const data = await systemPnlService.getPnlSummary({ month });
    res.json(wrap(data, month));
  }),
);

router.get(
  '/api/admin/llm-pnl/by-organisation',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const month = parseMonthParam(req.query.month);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const data = await systemPnlService.getByOrganisation({ month }, limit);
    res.json(wrap(data, month));
  }),
);

router.get(
  '/api/admin/llm-pnl/by-subaccount',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const month = parseMonthParam(req.query.month);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const data = await systemPnlService.getBySubaccount({ month }, limit);
    res.json(wrap(data, month));
  }),
);

router.get(
  '/api/admin/llm-pnl/by-source-type',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const month = parseMonthParam(req.query.month);
    const data = await systemPnlService.getBySourceType({ month });
    res.json(wrap(data, month));
  }),
);

router.get(
  '/api/admin/llm-pnl/by-provider-model',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const month = parseMonthParam(req.query.month);
    const data = await systemPnlService.getByProviderModel({ month });
    res.json(wrap(data, month));
  }),
);

router.get(
  '/api/admin/llm-pnl/trend',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const data = await systemPnlService.getDailyTrend(days);
    res.json(wrap(data, `last-${days}d`));
  }),
);

router.get(
  '/api/admin/llm-pnl/top-calls',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const month = parseMonthParam(req.query.month);
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const data = await systemPnlService.getTopCalls({ month }, limit);
    res.json(wrap(data, month));
  }),
);

router.get(
  '/api/admin/llm-pnl/call/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const detail = await systemPnlService.getCallDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ statusCode: 404, errorCode: 'NOT_FOUND', message: 'LLM call not found' });
      return;
    }
    res.json(wrap(detail, detail.createdAt.slice(0, 7)));
  }),
);

export default router;
