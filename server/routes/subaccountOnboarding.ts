/**
 * Sub-account onboarding routes — Phase F (spec §10.3 / §9.3).
 *
 * Drives the admin Onboarding tab (`AdminSubaccountDetailPage`):
 *   - GET  /api/subaccounts/:id/onboarding/owed     → list owed playbook slugs + latest-run status
 *   - POST /api/subaccounts/:id/onboarding/start    → start an owed playbook (idempotent per slug)
 */

import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { subaccountOnboardingService } from '../services/subaccountOnboardingService.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/onboarding/owed',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const owed = await subaccountOnboardingService.listOwedOnboardingPlaybooks(
      req.orgId!,
      subaccountId,
    );
    res.json({ owed });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/onboarding/start',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_START),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { slug, runMode, initialInput } = req.body as {
      slug?: string;
      runMode?: 'auto' | 'supervised';
      initialInput?: Record<string, unknown>;
    };
    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ error: 'slug (string) is required' });
      return;
    }
    if (runMode && !['auto', 'supervised'].includes(runMode)) {
      res.status(400).json({ error: 'runMode must be auto or supervised' });
      return;
    }
    const { runId } = await subaccountOnboardingService.startOwedOnboardingPlaybook({
      organisationId: req.orgId!,
      subaccountId,
      slug,
      startedByUserId: req.user!.id,
      runMode,
      initialInput,
    });
    res.status(201).json({ runId });
  }),
);

export default router;
