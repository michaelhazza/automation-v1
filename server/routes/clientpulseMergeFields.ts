import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { previewMergeFields } from '../services/mergeFieldResolver.js';

const router = Router();

const previewBodySchema = z.object({
  subaccountId: z.string().uuid(),
  template: z.object({
    subject: z.string().max(1_000).optional(),
    body: z.string().max(50_000).optional(),
  }),
  contact: z.record(z.unknown()).optional(),
});

/**
 * POST /api/clientpulse/merge-fields/preview
 *
 * Live-resolve merge-field tokens against the V1 namespace surface
 * (contact, subaccount, signals, org, agency). Contact is optional at preview
 * time — editors pick a contact at submit, not while typing.
 */
router.post(
  '/api/clientpulse/merge-fields/preview',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      throw { statusCode: 400, message: 'Organisation context required' };
    }
    const parsed = previewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }
    const result = await previewMergeFields({
      organisationId: orgId,
      subaccountId: parsed.data.subaccountId,
      template: parsed.data.template,
      contact: parsed.data.contact,
    });
    res.json(result);
  }),
);

export default router;
