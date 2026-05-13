// subaccountOperatorSettings.ts — GET + PATCH for subaccount operator settings.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.16, §6.3, §6.5
//
// GET:  authenticate + AGENTS_VIEW + resolveSubaccount
// PATCH: authenticate + SUBACCOUNT_OPERATOR_SETTINGS_WRITE + resolveSubaccount
//        Uses If-Match ETag (settings_version); 409 on mismatch.
//
// R2-F2: both routes use dual-GUC via subaccountOperatorSettingsService (which calls
// setOrgAndSubaccountGUC inside its transactions). No plain setOrgGUC call here.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { subaccountOperatorSettingsService } from '../services/subaccountOperatorSettingsService.js';
import { auditService } from '../services/auditService.js';

const router = Router();

const patchBodySchema = z.object({
  sessionSoftCapMinutes: z.number().int().min(30).max(240).optional(),
  autoExtendGraceMinutes: z.number().int().min(0).max(60).optional(),
  maxChainLength: z.number().int().min(1).max(500).optional(),
  maxWallClockPerTaskDays: z.number().int().min(1).max(365).optional(),
  perTaskBudgetCapMinutes: z.number().int().min(60).max(60000).optional(),
  concurrentOperatorSessionsCap: z.number().int().min(1).max(25).optional(),
});

// GET /api/subaccounts/:subaccountId/operator-settings
// Auth: authenticate + AGENTS_VIEW (managers and above can view)
router.get(
  '/api/subaccounts/:subaccountId/operator-settings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const orgId = req.orgId!;

    await resolveSubaccount(subaccountId, orgId);

    const settings = await subaccountOperatorSettingsService.getEffectiveSettings(orgId, subaccountId);

    res.setHeader('ETag', `"${settings.etag}"`);
    res.json({
      sessionSoftCapMinutes: settings.session_soft_cap_minutes,
      autoExtendGraceMinutes: settings.auto_extend_grace_minutes,
      maxChainLength: settings.max_chain_length,
      maxWallClockPerTaskDays: settings.max_wall_clock_per_task_days,
      perTaskBudgetCapMinutes: settings.per_task_budget_cap_minutes,
      concurrentOperatorSessionsCap: settings.concurrent_operator_sessions_cap,
      settingsVersion: settings.settingsVersion,
      updatedAt: null,
      updatedByUserId: null,
    });
  }),
);

// PATCH /api/subaccounts/:subaccountId/operator-settings
// Auth: authenticate + SUBACCOUNT_OPERATOR_SETTINGS_WRITE (org_admin only)
// Requires If-Match header with the current settings_version ETag.
router.patch(
  '/api/subaccounts/:subaccountId/operator-settings',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SETTINGS_WRITE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const orgId = req.orgId!;
    const actorUserId = req.user!.id;

    await resolveSubaccount(subaccountId, orgId);

    const ifMatch = req.headers['if-match'];
    const ifMatchETag = typeof ifMatch === 'string'
      ? ifMatch.replace(/^"|"$/g, '')
      : undefined;

    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw {
        statusCode: 400,
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const body = parsed.data;

    const { row, etag } = await subaccountOperatorSettingsService.updateSettings({
      orgId,
      subaccountId,
      patch: {
        session_soft_cap_minutes: body.sessionSoftCapMinutes,
        auto_extend_grace_minutes: body.autoExtendGraceMinutes,
        max_chain_length: body.maxChainLength,
        max_wall_clock_per_task_days: body.maxWallClockPerTaskDays,
        per_task_budget_cap_minutes: body.perTaskBudgetCapMinutes,
        concurrent_operator_sessions_cap: body.concurrentOperatorSessionsCap,
      },
      updatedByUserId: actorUserId,
      ifMatchETag,
    });

    void auditService.log({
      organisationId: orgId,
      actorId: actorUserId,
      actorType: 'user',
      action: 'subaccount.operator_settings.updated',
      entityType: 'subaccount_operator_settings',
      entityId: subaccountId,
      metadata: {
        after: body,
        source: 'ui',
        request_id: req.correlationId,
      },
    });

    res.setHeader('ETag', `"${etag}"`);
    res.json({
      sessionSoftCapMinutes: row.sessionSoftCapMinutes,
      autoExtendGraceMinutes: row.autoExtendGraceMinutes,
      maxChainLength: row.maxChainLength,
      maxWallClockPerTaskDays: row.maxWallClockPerTaskDays,
      perTaskBudgetCapMinutes: row.perTaskBudgetCapMinutes,
      concurrentOperatorSessionsCap: row.concurrentOperatorSessionsCap,
      settingsVersion: row.settingsVersion,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      updatedByUserId: row.updatedByUserId ?? null,
    });
  }),
);

export default router;
