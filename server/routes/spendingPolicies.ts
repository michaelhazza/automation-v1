// ---------------------------------------------------------------------------
// spendingPolicies route — GET/PATCH for spending_policies
//
// GET   /api/spending-budgets/:budgetId/policy
// PATCH /api/spending-budgets/:budgetId/policy
//
// PATCH increments version and writes an audit-event row.
//
// Spec: tasks/builds/agentic-commerce/spec.md §11.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { spendingBudgetService } from '../services/spendingBudgetService.js';

const router = Router();

// ── GET /api/spending-budgets/:budgetId/policy ────────────────────────────────

router.get(
  '/api/spending-budgets/:budgetId/policy',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const policy = await spendingBudgetService.getPolicyByBudgetId(
      req.params.budgetId,
      req.orgId!,
    );
    res.json(policy);
  }),
);

// ── PATCH /api/spending-budgets/:budgetId/policy ──────────────────────────────

router.patch(
  '/api/spending-budgets/:budgetId/policy',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const {
      mode,
      perTxnLimitMinor,
      dailyLimitMinor,
      monthlyLimitMinor,
      approvalThresholdMinor,
      merchantAllowlist,
      approvalExpiresHours,
    } = req.body as {
      mode?: 'shadow' | 'live';
      perTxnLimitMinor?: number;
      dailyLimitMinor?: number;
      monthlyLimitMinor?: number;
      approvalThresholdMinor?: number;
      merchantAllowlist?: Array<{ id: string | null; descriptor: string; source: 'stripe_id' | 'descriptor' }>;
      approvalExpiresHours?: number;
    };

    const updated = await spendingBudgetService.updatePolicy({
      budgetId: req.params.budgetId,
      organisationId: req.orgId!,
      updatedByUserId: req.user!.id,
      ...(mode !== undefined ? { mode } : {}),
      ...(perTxnLimitMinor !== undefined ? { perTxnLimitMinor } : {}),
      ...(dailyLimitMinor !== undefined ? { dailyLimitMinor } : {}),
      ...(monthlyLimitMinor !== undefined ? { monthlyLimitMinor } : {}),
      ...(approvalThresholdMinor !== undefined ? { approvalThresholdMinor } : {}),
      ...(merchantAllowlist !== undefined ? { merchantAllowlist } : {}),
      ...(approvalExpiresHours !== undefined ? { approvalExpiresHours } : {}),
    });

    res.json(updated);
  }),
);

export default router;
