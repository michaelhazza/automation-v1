// ---------------------------------------------------------------------------
// spendingBudgets route — CRUD for spending_budgets
//
// POST   /api/spending-budgets
// GET    /api/spending-budgets
// GET    /api/spending-budgets/:id
// PATCH  /api/spending-budgets/:id
// DELETE /api/spending-budgets/:id  (kill-switch: sets disabled_at)
// POST   /api/spending-budgets/:id/promote-to-live  (stub — HTTP 501 until Chunk 15)
//
// Permission gate convention (spec §11.3):
//   - 'spend_approver' (spec text)         → ORG_PERMISSIONS.SPEND_APPROVER
//   - 'admin'         (spec text)          → ORG_PERMISSIONS.SETTINGS_EDIT
//     (SETTINGS_EDIT is the codebase's canonical org-admin gate; the
//     SPEND_APPROVER permission ships in the same migration and is granted
//     to budget creators atomically — see spendingBudgetService.create.)
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

// ── POST /api/spending-budgets ────────────────────────────────────────────────

router.post(
  '/api/spending-budgets',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const {
      subaccountId = null,
      agentId = null,
      currency,
      name,
      monthlySpendAlertThresholdMinor,
      policy,
    } = req.body as {
      subaccountId?: string | null;
      agentId?: string | null;
      currency: string;
      name: string;
      monthlySpendAlertThresholdMinor?: number | null;
      policy: {
        mode: 'shadow' | 'live';
        perTxnLimitMinor?: number;
        dailyLimitMinor?: number;
        monthlyLimitMinor?: number;
        approvalThresholdMinor?: number;
        merchantAllowlist?: Array<{ id: string | null; descriptor: string; source: 'stripe_id' | 'descriptor' }>;
        approvalExpiresHours?: number;
      };
    };

    const result = await spendingBudgetService.create({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
      agentId: agentId ?? null,
      currency,
      name,
      monthlySpendAlertThresholdMinor: monthlySpendAlertThresholdMinor ?? null,
      policy,
      createdByUserId: req.user!.id,
    });

    res.status(201).json(result);
  }),
);

// ── GET /api/spending-budgets ─────────────────────────────────────────────────

router.get(
  '/api/spending-budgets',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.query as { subaccountId?: string };

    if (subaccountId) {
      const budgets = await spendingBudgetService.listForSubaccount(subaccountId, req.orgId!);
      res.json(budgets);
    } else {
      const budgets = await spendingBudgetService.listForOrg(req.orgId!);
      res.json(budgets);
    }
  }),
);

// ── GET /api/spending-budgets/:id ─────────────────────────────────────────────

router.get(
  '/api/spending-budgets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const budget = await spendingBudgetService.getById(req.params.id, req.orgId!);
    res.json(budget);
  }),
);

// ── PATCH /api/spending-budgets/:id ──────────────────────────────────────────

router.patch(
  '/api/spending-budgets/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const { name, monthlySpendAlertThresholdMinor, disabledAt } = req.body as {
      name?: string;
      monthlySpendAlertThresholdMinor?: number | null;
      disabledAt?: string | null;
    };

    const updated = await spendingBudgetService.update({
      budgetId: req.params.id,
      organisationId: req.orgId!,
      ...(name !== undefined ? { name } : {}),
      ...(monthlySpendAlertThresholdMinor !== undefined ? { monthlySpendAlertThresholdMinor } : {}),
      ...(disabledAt !== undefined ? { disabledAt: disabledAt ? new Date(disabledAt) : null } : {}),
    });

    res.json(updated);
  }),
);

// ── POST /api/spending-budgets/:id/promote-to-live ────────────────────────────

router.post(
  '/api/spending-budgets/:id/promote-to-live',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const result = await spendingBudgetService.requestPromotion(
      req.params.id,
      req.user!.id,
      req.orgId!,
    );

    if (result.outcome === 'promotion_already_pending') {
      res.status(200).json({ outcome: 'promotion_already_pending', actionId: result.actionId });
      return;
    }

    res.status(202).json({ outcome: 'promotion_requested', actionId: result.actionId });
  }),
);

export default router;
