import { Router } from 'express';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { saveRule } from '../services/ruleCaptureService.js';
import { listRules, patchRule, deprecateRule } from '../services/ruleLibraryService.js';
import type { RuleCaptureRequest, RuleListFilter, RulePatch } from '../../shared/types/briefRules.js';

const router = Router();

// POST /api/rules — save a user-triggered rule
router.post(
  '/',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_WRITE),
  asyncHandler(async (req, res) => {
    const body = req.body as RuleCaptureRequest & { allowConflicts?: boolean };
    const ctx = {
      userId: req.user!.id,
      organisationId: req.orgId!,
    };

    if (body.isAuthoritative) {
      const allowed = await hasOrgPermission(req, ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE);
      if (!allowed) {
        res.status(403).json({ error: 'rules.set_authoritative permission required' });
        return;
      }
    }

    const result = await saveRule(body, ctx, { allowConflicts: body.allowConflicts });
    res.status(result.saved ? 201 : 409).json(result);
  }),
);

// GET /api/rules — list Learned Rules for browsing
router.get(
  '/',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_READ),
  asyncHandler(async (req, res) => {
    const filter: RuleListFilter = {
      scopeType: req.query.scopeType as RuleListFilter['scopeType'],
      scopeId: req.query.scopeId as string | undefined,
      status: req.query.status as RuleListFilter['status'],
      createdByUserId: req.query.createdByUserId as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      cursor: req.query.cursor as string | undefined,
    };

    const result = await listRules(filter, req.orgId!);
    res.json(result);
  }),
);

// PATCH /api/rules/:ruleId — edit / pause / resume
router.patch(
  '/:ruleId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_WRITE),
  asyncHandler(async (req, res) => {
    const patch = req.body as RulePatch;

    if (patch.isAuthoritative !== undefined) {
      const allowed = await hasOrgPermission(req, ORG_PERMISSIONS.RULES_SET_AUTHORITATIVE);
      if (!allowed) {
        res.status(403).json({ error: 'rules.set_authoritative permission required' });
        return;
      }
    }

    const updated = await patchRule(
      req.params.ruleId,
      req.orgId!,
      patch,
      req.user!.id,
    );

    if (!updated) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    res.json(updated);
  }),
);

// DELETE /api/rules/:ruleId — soft-delete (sets deprecated_at)
router.delete(
  '/:ruleId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.RULES_WRITE),
  asyncHandler(async (req, res) => {
    const deleted = await deprecateRule(req.params.ruleId, req.orgId!, 'user_deleted');

    if (!deleted) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    res.status(204).end();
  }),
);

export default router;
