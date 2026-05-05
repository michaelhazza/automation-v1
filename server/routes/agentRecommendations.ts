/**
 * server/routes/agentRecommendations.ts
 *
 * HTTP routes for agent_recommendations:
 *   GET  /api/recommendations                       — list open recommendations
 *   POST /api/recommendations/:recId/acknowledge    — acknowledge a recommendation
 *   POST /api/recommendations/:recId/dismiss        — dismiss a recommendation
 *
 * All routes are auth-gated. RLS handles org isolation.
 * Spec: docs/sub-account-optimiser-spec.md §6.5
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { emitOrgUpdate } from '../websocket/emitters.js';
import {
  listRecommendations,
  acknowledgeRecommendation,
  dismissRecommendation,
} from '../services/agentRecommendationsService.js';

const router = Router();

// ── GET /api/recommendations ───────────────────────────────────────────────────

router.get(
  '/api/recommendations',
  authenticate,
  asyncHandler(async (req, res) => {
    const { scopeType, scopeId, includeDescendantSubaccounts, limit } = req.query;

    // Validate scopeType if provided
    if (scopeType !== undefined && scopeType !== 'org' && scopeType !== 'subaccount') {
      res.status(422).json({ error: 'scopeType must be "org" or "subaccount"' });
      return;
    }

    // Validate scopeId if provided
    if (scopeId !== undefined && typeof scopeId !== 'string') {
      res.status(422).json({ error: 'scopeId must be a string UUID' });
      return;
    }

    const parsedLimit = limit !== undefined ? parseInt(String(limit), 10) : 20;
    if (Number.isNaN(parsedLimit) || parsedLimit < 0) {
      res.status(422).json({ error: 'limit must be a non-negative integer' });
      return;
    }
    const clampedLimit = Math.min(parsedLimit, 100);

    const result = await listRecommendations({
      orgId: req.orgId!,
      scopeType: scopeType as 'org' | 'subaccount' | undefined,
      scopeId: scopeId as string | undefined,
      includeDescendantSubaccounts: includeDescendantSubaccounts === 'true',
      limit: clampedLimit,
    });

    res.json(result);
  }),
);

// ── POST /api/recommendations/:recId/acknowledge ──────────────────────────────

router.post(
  '/api/recommendations/:recId/acknowledge',
  authenticate,
  asyncHandler(async (req, res) => {
    const { recId } = req.params;
    const orgId = req.orgId!;

    const result = await acknowledgeRecommendation(recId, orgId);

    if (result === null) {
      res.status(404).json({ error: 'Recommendation not found' });
      return;
    }

    // Emit socket event
    emitOrgUpdate(orgId, 'dashboard.recommendations.changed', {
      recommendation_id: recId,
      change: 'acknowledged',
    });

    res.json(result);
  }),
);

// ── POST /api/recommendations/:recId/dismiss ──────────────────────────────────

router.post(
  '/api/recommendations/:recId/dismiss',
  authenticate,
  asyncHandler(async (req, res) => {
    const { recId } = req.params;
    const orgId = req.orgId!;
    const { reason, cooldown_hours } = req.body as {
      reason?: string;
      cooldown_hours?: number;
    };

    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      res.status(422).json({ error: 'reason is required' });
      return;
    }

    const isAdmin = req.user?.role === 'system_admin';

    const result = await dismissRecommendation(recId, orgId, {
      reason: reason.slice(0, 500),
      cooldownHours: typeof cooldown_hours === 'number' ? cooldown_hours : undefined,
      isAdmin,
    });

    if (result === null) {
      res.status(404).json({ error: 'Recommendation not found' });
      return;
    }

    // Emit socket event
    emitOrgUpdate(orgId, 'dashboard.recommendations.changed', {
      recommendation_id: recId,
      change: 'dismissed',
    });

    res.json(result);
  }),
);

export default router;
