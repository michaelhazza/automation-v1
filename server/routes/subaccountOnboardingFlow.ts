/**
 * Memory & Briefings subaccount onboarding routes (S5)
 *
 * POST /api/subaccounts/:subaccountId/onboarding/start
 * GET  /api/subaccounts/:subaccountId/onboarding/next-step
 * POST /api/subaccounts/:subaccountId/onboarding/answer
 * POST /api/subaccounts/:subaccountId/onboarding/mark-ready
 *
 * Distinct from server/routes/onboarding.ts (org-level subscription
 * onboarding) and server/routes/subaccountOnboarding.ts (Phase F playbook
 * onboarding). This file owns the 9-step M&B onboarding arc.
 *
 * Spec: docs/memory-and-briefings-spec.md §8 (S5)
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import {
  startOnboarding,
  getNextStep,
  recordAnswer,
  markReady,
} from '../services/memoryOnboardingFlowService.js';
import type { OnboardingStepId } from '../services/subaccountOnboardingServicePure.js';

const router = Router();

async function resolveSubaccountOrFail(subaccountId: string, orgId: string) {
  const [sa] = await db
    .select({ id: subaccounts.id })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.id, subaccountId),
        eq(subaccounts.organisationId, orgId),
        isNull(subaccounts.deletedAt),
      ),
    )
    .limit(1);
  return sa ?? null;
}

router.post(
  '/api/subaccounts/:subaccountId/onboarding/start',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;
    const sa = await resolveSubaccountOrFail(subaccountId, orgId);
    if (!sa) return res.status(404).json({ error: 'Subaccount not found' });

    const { websiteScrape } = req.body ?? {};
    const status = await startOnboarding({
      subaccountId,
      organisationId: orgId,
      websiteScrape: websiteScrape ?? null,
    });

    return res.json({ status });
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/onboarding/next-step',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;
    const sa = await resolveSubaccountOrFail(subaccountId, orgId);
    if (!sa) return res.status(404).json({ error: 'Subaccount not found' });

    const status = await getNextStep(subaccountId, orgId);
    return res.json({ status });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/onboarding/answer',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;
    const { stepId, answers } = req.body ?? {};

    if (!stepId || typeof stepId !== 'string') {
      return res.status(400).json({ error: 'stepId is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers must be an object' });
    }

    const sa = await resolveSubaccountOrFail(subaccountId, orgId);
    if (!sa) return res.status(404).json({ error: 'Subaccount not found' });

    const status = await recordAnswer({
      subaccountId,
      organisationId: orgId,
      stepId: stepId as OnboardingStepId,
      answers: answers as Record<string, unknown>,
    });
    return res.json({ status });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/onboarding/mark-ready',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;
    const sa = await resolveSubaccountOrFail(subaccountId, orgId);
    if (!sa) return res.status(404).json({ error: 'Subaccount not found' });

    const outcome = await markReady({ subaccountId, organisationId: orgId });

    if (!outcome.markedReady) {
      return res.status(400).json({
        error: outcome.reason ?? 'Cannot mark ready',
        errorCode: 'ONBOARDING_INCOMPLETE',
        missing: outcome.missing,
      });
    }

    return res.json({ markedReady: true });
  }),
);

export default router;
