/**
 * workspaceHealth.ts — Brain Tree OS adoption P4 routes.
 *
 * Three endpoints:
 *   - POST /api/org/health-audit/run         — run on-demand audit
 *   - GET  /api/org/health-audit/findings    — list active findings
 *   - POST /api/org/health-audit/findings/:id/resolve — mark a finding resolved
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P4
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  runAudit,
  resolveFinding,
  listActiveFindings,
} from '../services/workspaceHealth/workspaceHealthService.js';

const router = Router();

// ─── Run on-demand audit for the calling org ─────────────────────────────────

router.post(
  '/api/org/health-audit/run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.HEALTH_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const result = await runAudit(req.orgId!);
    res.json(result);
  }),
);

// ─── List active findings for the calling org ────────────────────────────────

router.get(
  '/api/org/health-audit/findings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.HEALTH_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const findings = await listActiveFindings(req.orgId!);
    res.json(findings);
  }),
);

// ─── Resolve a single finding manually ───────────────────────────────────────

router.post(
  '/api/org/health-audit/findings/:id/resolve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.HEALTH_AUDIT_RESOLVE),
  asyncHandler(async (req, res) => {
    const ok = await resolveFinding(req.params.id, req.orgId!);
    if (!ok) {
      throw { statusCode: 404, message: 'Finding not found or already resolved' };
    }
    res.json({ resolved: true });
  }),
);

export default router;
