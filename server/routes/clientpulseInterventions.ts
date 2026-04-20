import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import {
  buildInterventionContext,
  createOperatorProposal,
  INTERVENTION_ACTION_TYPES,
} from '../services/clientPulseInterventionContextService.js';

const router = Router();

// ── GET /api/clientpulse/subaccounts/:subaccountId/intervention-context ──
router.get(
  '/api/clientpulse/subaccounts/:subaccountId/intervention-context',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const context = await buildInterventionContext({
      organisationId: orgId,
      subaccountId: sub.id,
      subaccountName: sub.name,
    });
    res.json(context);
  }),
);

// ── POST /api/clientpulse/subaccounts/:subaccountId/interventions/propose ──
const proposeBodySchema = z
  .object({
    actionType: z.enum(INTERVENTION_ACTION_TYPES),
    payload: z.record(z.unknown()),
    scheduleHint: z.enum(['immediate', 'delay_24h', 'scheduled']).optional(),
    rationale: z.string().min(1).max(5_000),
    templateSlug: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // scheduleHint='scheduled' requires payload.scheduledFor — catch at the
    // request boundary so the editor sees a precise 400 instead of the
    // service layer's later MISSING_SCHEDULE.
    if (val.scheduleHint === 'scheduled') {
      const sf = (val.payload as Record<string, unknown>).scheduledFor;
      if (typeof sf !== 'string' || sf.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payload', 'scheduledFor'],
          message: 'scheduledFor is required when scheduleHint=scheduled',
        });
      }
    }
  });

router.post(
  '/api/clientpulse/subaccounts/:subaccountId/interventions/propose',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);

    const parsed = proposeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }

    const result = await createOperatorProposal({
      organisationId: orgId,
      subaccountId: sub.id,
      actionType: parsed.data.actionType,
      payload: parsed.data.payload,
      rationale: parsed.data.rationale,
      scheduleHint: parsed.data.scheduleHint,
      templateSlug: parsed.data.templateSlug,
    });
    res.json(result);
  }),
);

export default router;
