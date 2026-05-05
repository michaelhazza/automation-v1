/**
 * Clarifications route — Phase 2 S8
 *
 * GET  /api/subaccounts/:subaccountId/clarifications/pending
 *   List pending clarifications for a subaccount.
 *
 * POST /api/clarifications/:clarificationId/respond
 *   Resolve a pending clarification with an answer. Wakes any paused run.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import {
  listPendingClarifications,
  resolveClarification,
} from '../services/clarificationService.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/clarifications/pending',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;

    const subaccount = await resolveSubaccount(subaccountId, orgId);

    const items = await listPendingClarifications(subaccount.id, orgId);
    return res.json({ items });
  }),
);

router.post(
  '/api/clarifications/:clarificationId/respond',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.user!.id;
    const { clarificationId } = req.params;
    const { answer, answerSource } = req.body ?? {};

    if (typeof answer !== 'string' || answer.trim().length === 0) {
      return res.status(400).json({ error: 'answer is required' });
    }
    if (answer.length > 10_000) {
      return res.status(400).json({ error: 'answer exceeds 10000 characters' });
    }

    const result = await resolveClarification({
      clarificationId,
      organisationId: orgId,
      resolvedByUserId: userId,
      answer: answer.trim(),
      answerSource: typeof answerSource === 'string' ? answerSource : 'free_text',
    });

    return res.json({
      clarificationId: result.clarificationId,
      activeRunId: result.activeRunId,
      stepId: result.stepId,
      resolvedAt: result.resolvedAt.toISOString(),
    });
  }),
);

export default router;
