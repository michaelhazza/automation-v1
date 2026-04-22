import { Router } from 'express';
import { and, desc, gte, lte, eq } from 'drizzle-orm';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemPnlService } from '../services/systemPnlService.js';
import * as llmInflightRegistry from '../services/llmInflightRegistry.js';
import * as llmInflightPayloadStore from '../services/llmInflightPayloadStore.js';
import { INFLIGHT_SNAPSHOT_HARD_CAP } from '../config/limits.js';
import { db } from '../db/index.js';
import { llmInflightHistory } from '../db/schema/llmInflightHistory.js';
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

// ── LLM in-flight snapshot (spec tasks/llm-inflight-realtime-tracker-spec.md §5) ──
// First-paint + reconnect resync for the In-Flight tab. The socket room
// `system:llm-inflight` carries live add/remove events; this endpoint is
// the authoritative read used on mount and after a Redis partition.
//
// This endpoint deliberately does NOT use the `wrap()` helper that the
// other /api/admin/llm-pnl/* routes use. Spec §5 pins the in-flight
// response shape as its own envelope — `{ entries, generatedAt, capped }`
// — with `generatedAt` inline rather than in a nested `meta` block. That
// shape is what `InFlightSnapshotResponse` exports for the client.
router.get(
  '/api/admin/llm-pnl/in-flight',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, INFLIGHT_SNAPSHOT_HARD_CAP)
      : INFLIGHT_SNAPSHOT_HARD_CAP;
    const snapshot = llmInflightRegistry.snapshot(limit);
    res.json(snapshot);
  }),
);

// ── Live payload snapshot (deferred-items brief §7) ──────────────────────
// System-admin only. Returns the captured prompt/system/tools for an
// in-flight call by runtimeKey. 410 Gone when the entry has already
// completed or was evicted from the in-memory store.
router.get(
  '/api/admin/llm-pnl/in-flight/:runtimeKey/payload',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const runtimeKey = String(req.params.runtimeKey ?? '');
    if (!runtimeKey) {
      throw { statusCode: 400, errorCode: 'INVALID_RUNTIME_KEY', message: 'runtimeKey required' };
    }
    const snapshot = llmInflightPayloadStore.get(runtimeKey);
    if (!snapshot) {
      res.status(410).json({
        statusCode: 410,
        errorCode: 'PAYLOAD_GONE',
        message: 'Payload snapshot is no longer available — the call completed or was evicted from the in-memory store.',
      });
      return;
    }
    res.json({
      runtimeKey,
      payload:     snapshot,
      generatedAt: new Date().toISOString(),
    });
  }),
);

// ── In-flight historical archive (deferred-items brief §6) ────────────────
// System-admin only. Returns add/remove events from the llm_inflight_history
// table within the requested time window. Capped at 1000 rows — narrow
// the window rather than paginating to avoid long scans under load.
const INFLIGHT_HISTORY_HARD_CAP = 1_000;

router.get(
  '/api/admin/llm-pnl/in-flight/history',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { from, to, runtimeKey, idempotencyKey } = req.query;
    const fromDate = typeof from === 'string' ? new Date(from) : null;
    const toDate   = typeof to   === 'string' ? new Date(to)   : null;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw { statusCode: 400, errorCode: 'INVALID_FROM', message: 'from must be ISO 8601' };
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw { statusCode: 400, errorCode: 'INVALID_TO', message: 'to must be ISO 8601' };
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, INFLIGHT_HISTORY_HARD_CAP)
      : 200;

    const conditions = [];
    if (fromDate) conditions.push(gte(llmInflightHistory.createdAt, fromDate));
    if (toDate)   conditions.push(lte(llmInflightHistory.createdAt, toDate));
    if (typeof runtimeKey === 'string' && runtimeKey.length > 0) {
      conditions.push(eq(llmInflightHistory.runtimeKey, runtimeKey));
    }
    if (typeof idempotencyKey === 'string' && idempotencyKey.length > 0) {
      conditions.push(eq(llmInflightHistory.idempotencyKey, idempotencyKey));
    }

    const rows = await db
      .select()
      .from(llmInflightHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(llmInflightHistory.createdAt))
      .limit(limit);

    res.json({
      events: rows.map((r) => ({
        id:             r.id,
        runtimeKey:     r.runtimeKey,
        idempotencyKey: r.idempotencyKey,
        organisationId: r.organisationId,
        subaccountId:   r.subaccountId,
        eventKind:      r.eventKind,
        eventPayload:   r.eventPayload,
        terminalStatus: r.terminalStatus,
        createdAt:      r.createdAt,
      })),
      generatedAt: new Date().toISOString(),
      capped:      rows.length >= limit,
    });
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
