/**
 * geoAudits.ts — GEO (Generative Engine Optimisation) audit routes.
 *
 * Endpoints:
 *   - GET  /api/org/geo-audits                              — list org-wide audits
 *   - GET  /api/org/geo-audits/url-history                  — trend history for a URL (before :id to avoid param shadowing)
 *   - GET  /api/org/geo-audits/:id                          — get single audit
 *   - POST /api/org/geo-audits                              — persist a completed audit result
 *   - GET  /api/subaccounts/:subaccountId/geo-audits        — list subaccount audits
 *
 * Spec: docs/geo-seo-dev-brief.md
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { geoAuditService, DEFAULT_GEO_WEIGHTS, computeCompositeScore } from '../services/geoAuditService.js';
import type { GeoDimensionScore } from '../db/schema/geoAudits.js';

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

// ─── Trend history for a specific URL ───────────────────────────────────────
// Must be defined before :id to avoid Express matching "url-history" as an id

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

// ─── Persist a completed GEO audit result ───────────────────────────────────
// Called by agents (via post-processing) or external integrations to store
// structured audit results for historical tracking and portfolio dashboards.

router.post(
  '/api/org/geo-audits',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.GEO_AUDIT_RUN),
  asyncHandler(async (req, res) => {
    const { url, pageTitle, subaccountId, dimensionScores, platformReadiness,
            recommendations, agentRunId, auditType, competitorUrls } = req.body;

    if (!url || typeof url !== 'string') {
      throw { statusCode: 400, message: 'url is required' };
    }
    if (!Array.isArray(dimensionScores) || dimensionScores.length === 0) {
      throw { statusCode: 400, message: 'dimensionScores array is required' };
    }

    // Validate subaccount belongs to org if provided
    if (subaccountId) {
      await resolveSubaccount(subaccountId, req.orgId!);
    }

    const weightsSnapshot = { ...DEFAULT_GEO_WEIGHTS };
    const scores = dimensionScores as GeoDimensionScore[];

    // Recompute composite from dimension scores to prevent inconsistency
    const compositeScore = computeCompositeScore(scores);

    const audit = await geoAuditService.saveAudit({
      organisationId: req.orgId!,
      subaccountId: subaccountId || null,
      url,
      pageTitle: pageTitle || null,
      compositeScore,
      dimensionScores: scores,
      platformReadiness: platformReadiness || null,
      recommendations: recommendations || [],
      agentRunId: agentRunId || null,
      auditType: auditType || 'full',
      competitorUrls: competitorUrls || null,
      weightsSnapshot,
    });

    res.status(201).json(audit);
  }),
);

// ─── List audits for a subaccount ───────────────────────────────────────────
// Uses org-level permission — GEO audits are an org-wide feature that
// can be filtered by subaccount, not a subaccount-scoped feature.

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
