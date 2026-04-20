import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { resolveActionSlug } from '../config/actionRegistry.js';
import {
  buildInterventionContext,
  createOperatorProposal,
  INTERVENTION_ACTION_TYPES,
} from '../services/clientPulseInterventionContextService.js';
import { crmLiveDataService } from '../services/crmLiveDataService.js';

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

    // Defensive slug normalisation per contract (l) — inbound action-type
    // surfaces run through resolveActionSlug so legacy callers still work
    // after the Session 1 rename.
    const rawBody = req.body as Record<string, unknown> | null | undefined;
    const normalisedBody = rawBody && typeof rawBody.actionType === 'string'
      ? { ...rawBody, actionType: resolveActionSlug(rawBody.actionType) }
      : rawBody;
    const parsed = proposeBodySchema.safeParse(normalisedBody);
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

// ── Live-data pickers — spec §3.2 (Session 2 Chunk 3) ──────────────────────
// Five read-only endpoints backing the intervention editor pickers. Each is
// subaccount-scoped and authenticates via the standard middleware chain.

function sendLiveDataResult<T>(
  res: import('express').Response,
  result:
    | { ok: true; items: T[] }
    | { ok: false; rateLimited: true; retryAfterSeconds: number }
    | { ok: false; error: string },
): void {
  if (result.ok) {
    res.json({ items: result.items });
    return;
  }
  if ('rateLimited' in result) {
    res.status(429).json({
      errorCode: 'RATE_LIMITED',
      retryAfterSeconds: result.retryAfterSeconds,
      message: 'CRM rate-limited — retry after delay',
    });
    return;
  }
  res.status(502).json({ errorCode: 'CRM_UPSTREAM', message: result.error });
}

router.get(
  '/api/clientpulse/subaccounts/:subaccountId/crm/automations',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const result = await crmLiveDataService.listAutomations(sub.id, orgId, q);
    sendLiveDataResult(res, result);
  }),
);

router.get(
  '/api/clientpulse/subaccounts/:subaccountId/crm/contacts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const result = await crmLiveDataService.listContacts(sub.id, orgId, q);
    sendLiveDataResult(res, result);
  }),
);

router.get(
  '/api/clientpulse/subaccounts/:subaccountId/crm/users',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const result = await crmLiveDataService.listUsers(sub.id, orgId, q);
    sendLiveDataResult(res, result);
  }),
);

router.get(
  '/api/clientpulse/subaccounts/:subaccountId/crm/from-addresses',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const result = await crmLiveDataService.listFromAddresses(sub.id, orgId);
    sendLiveDataResult(res, result);
  }),
);

router.get(
  '/api/clientpulse/subaccounts/:subaccountId/crm/from-numbers',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const result = await crmLiveDataService.listFromNumbers(sub.id, orgId);
    sendLiveDataResult(res, result);
  }),
);

export default router;
