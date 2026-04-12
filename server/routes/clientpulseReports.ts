import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { reportService } from '../services/reportService.js';

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
router.get('/api/clientpulse/high-risk', authenticate, asyncHandler(async (req, res) => {
  // TODO: Derive from latest report metadata or a dedicated health-score table.
  // For now, return empty to unblock the dashboard UI.
  res.json({ clients: [] });
}));

export default router;
