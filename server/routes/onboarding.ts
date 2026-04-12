import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { onboardingService } from '../services/onboardingService.js';
import { subscriptionService } from '../services/subscriptionService.js';

const router = Router();

/** GET /api/onboarding/status — derive wizard step from existing DB state */
router.get('/api/onboarding/status', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json({ ghlConnected: false, agentsProvisioned: false, firstRunComplete: false });
    return;
  }
  const status = await onboardingService.getOnboardingStatus(orgId);
  res.json(status);
}));

/** GET /api/onboarding/sync-status — poll sync progress */
router.get('/api/onboarding/sync-status', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json({ phase: 'idle', totalAccounts: 0, completedAccounts: 0, accounts: [] });
    return;
  }
  const status = await onboardingService.getSyncStatus(orgId);
  res.json(status);
}));

/** POST /api/onboarding/confirm-locations — confirm selected GHL locations for monitoring */
router.post('/api/onboarding/confirm-locations', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    throw { statusCode: 400, message: 'Organisation context required' };
  }
  const { locationIds } = req.body;
  if (!Array.isArray(locationIds) || locationIds.length === 0) {
    throw { statusCode: 400, message: 'locationIds must be a non-empty array' };
  }

  // Server-side subaccount limit enforcement
  const sub = await subscriptionService.getOrgSubscription(orgId);
  const limit = sub?.subscription?.subaccountLimit ?? null;
  if (limit !== null && locationIds.length > limit) {
    throw { statusCode: 400, message: `Your plan allows up to ${limit} monitored accounts. You selected ${locationIds.length}.` };
  }

  // TODO: Wire to GHL connector service — create subaccounts for each location,
  // trigger initial sync via connectorPollingService.
  // For now, return success to unblock the onboarding UI.
  res.json({ confirmed: locationIds.length, message: 'Locations confirmed — sync starting.' });
}));

/** POST /api/onboarding/notify-on-complete — store "email me when ready" preference */
router.post('/api/onboarding/notify-on-complete', authenticate, asyncHandler(async (req, res) => {
  // TODO: Store preference on org or user record. On sync complete, check flag and send email.
  res.json({ registered: true });
}));

export default router;
