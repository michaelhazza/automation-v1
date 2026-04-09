import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { boardService } from '../services/boardService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

// ─── Org-level board config ──────────────────────────────────────────────────

router.get(
  '/api/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const config = await boardService.getOrgBoardConfig(req.orgId!);
    res.json(config);
  })
);

router.post(
  '/api/board-config/init',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { templateId } = req.body as { templateId?: string };
    if (!templateId) {
      res.status(400).json({ error: 'templateId is required' });
      return;
    }
    const config = await boardService.initOrgBoardFromTemplate(req.orgId!, templateId);
    res.status(201).json(config);
  })
);

router.patch(
  '/api/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { columns } = req.body as { columns?: unknown[] };
    if (!columns || !Array.isArray(columns)) {
      res.status(400).json({ error: 'columns array is required' });
      return;
    }
    const existing = await boardService.getOrgBoardConfig(req.orgId!);
    if (!existing) {
      res.status(404).json({ error: 'Organisation has no board configuration. Initialise first.' });
      return;
    }
    const updated = await boardService.updateBoardConfig(existing.id, req.orgId!, columns as any);
    res.json(updated);
  })
);

router.post(
  '/api/board-config/push-all',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const subIds = await boardService.listActiveSubaccountIds(req.orgId!);

    if (subIds.length === 0) {
      res.json({ pushed: 0, results: [] });
      return;
    }
    const results = await boardService.pushOrgConfigToSubaccounts(req.orgId!, subIds);
    res.json({ pushed: results.length, results });
  })
);

// ─── Subaccount-level board config ───────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/board-config',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const existingConfig = await boardService.getSubaccountBoardConfig(req.orgId!, req.params.subaccountId);
    let config = existingConfig;

    // Auto-initialise from org config if subaccount has no board yet
    if (!config) {
      const initializedConfig = await boardService.initSubaccountBoard(req.orgId!, req.params.subaccountId);
      if (!initializedConfig) {
        res.status(404).json({ error: 'Organisation has no board configuration to copy from' });
        return;
      }
      config = initializedConfig;
    }

    // If config exists but has empty columns, try to re-sync from org config
    if (config && Array.isArray(config.columns) && config.columns.length === 0) {
      const orgConfig = await boardService.getOrgBoardConfig(req.orgId!);
      if (orgConfig && orgConfig.columns.length > 0) {
        config = await boardService.updateBoardConfig(config.id, req.orgId!, orgConfig.columns as any);
      }
    }

    res.json(config);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/board-config/init',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const config = await boardService.initSubaccountBoard(req.orgId!, req.params.subaccountId);
    if (!config) {
      res.status(404).json({ error: 'Organisation has no board configuration to copy from' });
      return;
    }
    res.status(201).json(config);
  })
);

router.patch(
  '/api/subaccounts/:subaccountId/board-config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { columns } = req.body as { columns?: unknown[] };
    if (!columns || !Array.isArray(columns)) {
      res.status(400).json({ error: 'columns array is required' });
      return;
    }
    const existing = await boardService.getSubaccountBoardConfig(req.orgId!, req.params.subaccountId);
    if (!existing) {
      res.status(404).json({ error: 'Subaccount has no board configuration. Initialise first.' });
      return;
    }
    const updated = await boardService.updateBoardConfig(existing.id, req.orgId!, columns as any);
    res.json(updated);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/board-config/push',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const results = await boardService.pushOrgConfigToSubaccounts(req.orgId!, [req.params.subaccountId]);
    res.json(results[0]);
  })
);

export default router;
