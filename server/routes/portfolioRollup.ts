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
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

const router = Router();

router.get(
  '/api/organisations/portfolio-rollup/settings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;

    const [orgSub] = await db
      .select({
        id: subaccounts.id,
        settings: subaccounts.settings,
      })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.organisationId, orgId),
          eq(subaccounts.isOrgSubaccount, true),
          isNull(subaccounts.deletedAt),
        ),
      )
      .limit(1);

    if (!orgSub) {
      return res.status(404).json({ error: 'Org subaccount not found' });
    }

    const settings = (orgSub.settings as Record<string, unknown> | null) ?? {};
    const portfolioConfig =
      (settings.portfolioRollup as { optIn?: boolean; deliveryChannels?: unknown } | undefined) ?? {};

    return res.json({
      orgSubaccountId: orgSub.id,
      optIn: portfolioConfig.optIn ?? true,
      deliveryChannels: portfolioConfig.deliveryChannels ?? {
        email: true,
        portal: false,
        slack: false,
      },
    });
  }),
);

router.patch(
  '/api/organisations/portfolio-rollup/settings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { optIn, deliveryChannels } = req.body ?? {};

    const [orgSub] = await db
      .select({ id: subaccounts.id, settings: subaccounts.settings })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.organisationId, orgId),
          eq(subaccounts.isOrgSubaccount, true),
          isNull(subaccounts.deletedAt),
        ),
      )
      .limit(1);

    if (!orgSub) return res.status(404).json({ error: 'Org subaccount not found' });

    const existingSettings = (orgSub.settings as Record<string, unknown> | null) ?? {};
    const nextSettings = {
      ...existingSettings,
      portfolioRollup: {
        optIn: optIn === undefined ? true : Boolean(optIn),
        deliveryChannels: deliveryChannels ?? { email: true, portal: false, slack: false },
      },
    };

    await db
      .update(subaccounts)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(subaccounts.id, orgSub.id));

    return res.json({
      orgSubaccountId: orgSub.id,
      ...nextSettings.portfolioRollup,
    });
  }),
);

export default router;
