/**
 * Credentials routes — subaccount-scoped read-only audit log.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { credentialBrokerService } from '../services/credentialBrokerService.js';

const router = Router();

const auditQuerySchema = z.object({
  sinceTimestamp: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get(
  '/api/subaccounts/:subaccountId/credential-audit',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.CREDENTIALS_AUDIT_READ),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw { statusCode: 400, message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') };
    }

    const { sinceTimestamp, limit } = parsed.data;

    const entries = await credentialBrokerService.audit({
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      sinceTimestamp: sinceTimestamp ? new Date(sinceTimestamp) : undefined,
      limit,
    });

    res.json(entries);
  }),
);

export default router;
