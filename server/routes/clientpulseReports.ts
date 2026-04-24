import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { reportService } from '../services/reportService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  getPrioritisedClients,
  applyFilters,
  applyPagination,
} from '../services/clientPulseHighRiskService.js';

const router = Router();

/** GET /api/reports — list all reports for the org */
router.get('/api/reports', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json({ reports: [] });
    return;
  }
  const list = await reportService.listReports(orgId);
  res.json({ reports: list });
}));

/** GET /api/reports/latest — get the most recent completed report (MUST be before /:id) */
router.get('/api/reports/latest', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.status(404).json({ error: 'No reports found' });
    return;
  }
  const report = await reportService.getLatestReport(orgId);
  if (!report) {
    res.status(404).json({ error: 'No reports found' });
    return;
  }
  res.json(report);
}));

/** GET /api/reports/:id — get a single report */
router.get('/api/reports/:id', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    throw { statusCode: 400, message: 'Organisation context required' };
  }
  const report = await reportService.getReport(orgId, req.params.id);
  res.json(report);
}));

/** POST /api/reports/:id/resend — resend report email */
router.post('/api/reports/:id/resend', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    throw { statusCode: 400, message: 'Organisation context required' };
  }
  await reportService.resendReport(orgId, req.params.id);
  res.json({ message: 'Report resent to your inbox.' });
}));

// ── ClientPulse dashboard data endpoints ──────────────────────────────────

/** GET /api/clientpulse/health-summary — aggregate health stats for dashboard */
router.get('/api/clientpulse/health-summary', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json(null);
    return;
  }
  // Derive from latest report if available
  const latest = await reportService.getLatestReport(orgId);
  if (!latest) {
    res.json(null);
    return;
  }
  res.json({
    totalClients: latest.totalClients,
    healthy: latest.healthyCount,
    attention: latest.attentionCount,
    atRisk: latest.atRiskCount,
  });
}));

/** GET /api/clientpulse/high-risk — high-risk clients for dashboard widget */
router.get(
  '/api/clientpulse/high-risk',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      throw { statusCode: 400, message: 'Organisation context required' };
    }

    // ── Parse query params ──────────────────────────────────────────────────
    const limitRaw = Number.parseInt(String(req.query.limit ?? '7'), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 7;

    const band = typeof req.query.band === 'string' ? req.query.band : 'all';
    const q    = typeof req.query.q    === 'string' ? req.query.q    : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

    // ── Validate band param ────────────────────────────────────────────────
    const VALID_BANDS = ['all', 'critical', 'at_risk', 'watch', 'healthy'];
    if (!VALID_BANDS.includes(band)) {
      res.status(400).json({ errorCode: 'INVALID_BAND', message: `band must be one of: ${VALID_BANDS.join(', ')}` });
      return;
    }

    // ── Fetch + filter + paginate ──────────────────────────────────────────
    const allRows = await getPrioritisedClients(orgId);
    const filtered = applyFilters(allRows, { band, q });
    const { rows: page, nextCursor, hasMore, cursorError } = applyPagination(filtered, { limit, cursor, orgId });

    if (cursorError) {
      res.status(400).json({ errorCode: 'INVALID_CURSOR', message: 'The provided cursor is invalid or has been tampered with.' });
      return;
    }

    // ── Shape response ─────────────────────────────────────────────────────
    const response = {
      clients: page,
      hasMore,
      nextCursor,
    };

    res.json(response);
  }),
);

export default router;
