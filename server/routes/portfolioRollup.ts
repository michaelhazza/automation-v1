/**
 * Portfolio Rollup routes (S23)
 *
 * GET  /api/organisations/portfolio-rollup/settings
 * PATCH /api/organisations/portfolio-rollup/settings
 *
 * Persists DeliveryChannels config to the org subaccount row.
 *
 * Spec: docs/memory-and-briefings-spec.md §11 (S23)
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  getPortfolioRollupSettings,
  updatePortfolioRollupSettings,
} from '../services/portfolioRollupService.js';

const router = Router();

router.get(
  '/api/organisations/portfolio-rollup/settings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const result = await getPortfolioRollupSettings(req.orgId!);
    if (!result) return res.status(404).json({ error: 'Org subaccount not found' });
    return res.json(result);
  }),
);

router.patch(
  '/api/organisations/portfolio-rollup/settings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const { optIn, deliveryChannels } = req.body ?? {};
    const result = await updatePortfolioRollupSettings(req.orgId!, { optIn, deliveryChannels });
    if (!result) return res.status(404).json({ error: 'Org subaccount not found' });
    return res.json(result);
  }),
);

export default router;
