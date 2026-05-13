import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { homeWidgetService } from '../services/homeWidget/homeWidgetService.js';

const router = Router();

// ─── List home widgets for the authenticated user's personal agents ───────────

router.get(
  '/api/agent-home-widgets',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.HOME_WIDGET_READ),
  asyncHandler(async (req, res) => {
    const widgets = await homeWidgetService.getWidgets({
      userId: req.user!.id,
      subaccountId: '',
      organisationId: req.orgId!,
    });
    res.json({ widgets });
  }),
);

export default router;
