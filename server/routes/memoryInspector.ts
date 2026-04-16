/**
 * Memory Inspector route (S13)
 *
 * POST /api/subaccounts/:subaccountId/memory-inspector/ask
 *
 * Audience is resolved from the caller's role:
 *   - Agency staff with SUBACCOUNTS_VIEW → 'agency'
 *   - Client portal users (via portal auth) → 'client_portal', gated by
 *     canRenderPortalFeatureForSubaccount(subaccountId, 'memoryInspector')
 *
 * Spec: docs/memory-and-briefings-spec.md §5.9 (S13)
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { canRenderPortalFeatureForSubaccount } from '../lib/portalGate.js';
import { askInspector } from '../services/memoryInspectorService.js';

const router = Router();

router.post(
  '/api/subaccounts/:subaccountId/memory-inspector/ask',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { subaccountId } = req.params;
    const { question, runId, audience } = req.body ?? {};

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'question is required' });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: 'question exceeds 2000 characters' });
    }

    const resolvedAudience: 'agency' | 'client_portal' =
      audience === 'client_portal' ? 'client_portal' : 'agency';

    // Portal audience passes through portalGate
    if (resolvedAudience === 'client_portal') {
      const allowed = await canRenderPortalFeatureForSubaccount(
        subaccountId,
        orgId,
        'memoryInspector',
      );
      if (!allowed) {
        return res.status(403).json({ error: 'memoryInspector not enabled for this subaccount' });
      }
    }

    const result = await askInspector({
      subaccountId,
      organisationId: orgId,
      userId,
      question: question.trim(),
      runId: typeof runId === 'string' ? runId : undefined,
      audience: resolvedAudience,
      correlationId: req.correlationId ?? randomUUID(),
    });

    return res.json(result);
  }),
);

export default router;
