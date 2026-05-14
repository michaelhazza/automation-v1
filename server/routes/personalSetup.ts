import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { provisionEA } from '../services/eaProvisioningService.js';

const router = Router();

const SetupBodySchema = z.object({
  displayName: z.string().max(120).optional(),
  voiceProfileOptIn: z.boolean(),
  briefingDeliveryTarget: z.enum(['slack_dm', 'email']),
  briefingTimeUtc: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
});

router.post(
  '/api/personal/setup',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EA_PROVISION),
  asyncHandler(async (req, res) => {
    const body = SetupBodySchema.parse(req.body);

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const result = await provisionEA(body, {
      userId: req.user.id,
      organisationId: req.orgId!,
    });

    res.status(201).json(result);
  }),
);

export default router;
