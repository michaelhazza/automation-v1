/**
 * geoAudits.ts — GEO (Generative Engine Optimisation) audit routes.
 *
 * Endpoints:
 *   - GET  /api/org/geo-audits                              — list org-wide audits
 *   - GET  /api/org/geo-audits/:id                          — get single audit
 *   - GET  /api/subaccounts/:subaccountId/geo-audits        — list subaccount audits
 *   - GET  /api/org/geo-audits/url-history                  — trend history for a URL
 *
 * Spec: docs/geo-seo-dev-brief.md
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { geoAuditService } from '../services/geoAuditService.js';

const router = Router();

// ─── List audits for the calling org (portfolio view) ───────────────────────

router.get(
  '/api/org/geo-audits',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.GEO_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const audits = await geoAuditService.listByOrg(req.orgId!, { limit, offset });
    res.json(audits);
  }),
);

// ─── Get a single audit by ID ───────────────────────────────────────────────

router.get(
  '/api/org/geo-audits/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.GEO_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const audit = await geoAuditService.getAudit(req.params.id, req.orgId!);
    res.json(audit);
  }),
);

// ─── Trend history for a specific URL ───────────────────────────────────────

router.get(
  '/api/org/geo-audits/url-history',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.GEO_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const url = req.query.url as string;
    if (!url) throw { statusCode: 400, message: 'url query parameter is required' };
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const audits = await geoAuditService.listByUrl(req.orgId!, url, { limit });
    res.json(audits);
  }),
);

// ─── List audits for a subaccount ───────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/geo-audits',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.GEO_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const audits = await geoAuditService.listBySubaccount(
      req.orgId!,
      req.params.subaccountId,
      { limit, offset },
    );
    res.json(audits);
  }),
);

export default router;
