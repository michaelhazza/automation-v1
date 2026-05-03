// ---------------------------------------------------------------------------
// approvalChannels route — CRUD for approval channel tables
//
// Subaccount approval channels:
//   POST   /api/subaccounts/:subaccountId/approval-channels
//   GET    /api/subaccounts/:subaccountId/approval-channels
//   PATCH  /api/subaccounts/:subaccountId/approval-channels/:channelId
//   DELETE /api/subaccounts/:subaccountId/approval-channels/:channelId
//
// Org approval channels:
//   POST   /api/approval-channels
//   GET    /api/approval-channels
//   PATCH  /api/approval-channels/:channelId
//   DELETE /api/approval-channels/:channelId
//
// Org-subaccount channel grants:
//   POST   /api/approval-channels/:channelId/grants
//   DELETE /api/approval-channels/:channelId/grants/:grantId
//
// Spec: tasks/builds/agentic-commerce/spec.md §13, §11.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import {
  createSubaccountChannel,
  listSubaccountChannels,
  updateSubaccountChannel,
  deleteSubaccountChannel,
  createOrgChannel,
  listOrgChannels,
  updateOrgChannel,
  deleteOrgChannel,
  addGrant,
  revokeGrant,
} from '../services/approvalChannelService.js';
import { randomUUID } from 'node:crypto';

const router = Router();

// ===========================================================================
// Subaccount approval channels
// ===========================================================================

router.post(
  '/api/subaccounts/:subaccountId/approval-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { channelType, config = {}, enabled = true } = req.body as {
      channelType: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    const now = new Date();
    const channel = await createSubaccountChannel({
      id: randomUUID(),
      organisationId: req.orgId!,
      subaccountId: subaccount.id,
      channelType,
      config,
      enabled,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json(channel);
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/approval-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const channels = await listSubaccountChannels(subaccount.id, req.orgId!);
    res.json(channels);
  }),
);

router.patch(
  '/api/subaccounts/:subaccountId/approval-channels/:channelId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { channelType, config, enabled } = req.body as {
      channelType?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    const updated = await updateSubaccountChannel(
      req.params.channelId,
      subaccount.id,
      req.orgId!,
      { channelType, config, enabled },
    );

    if (!updated) {
      throw { statusCode: 404, message: 'Approval channel not found.', errorCode: 'not_found' };
    }
    res.json(updated);
  }),
);

router.delete(
  '/api/subaccounts/:subaccountId/approval-channels/:channelId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const deleted = await deleteSubaccountChannel(
      req.params.channelId,
      subaccount.id,
      req.orgId!,
    );

    if (!deleted) {
      throw { statusCode: 404, message: 'Approval channel not found.', errorCode: 'not_found' };
    }
    res.status(204).end();
  }),
);

// ===========================================================================
// Org approval channels
// ===========================================================================

router.post(
  '/api/approval-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const { channelType, config = {}, enabled = true } = req.body as {
      channelType: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    const now = new Date();
    const channel = await createOrgChannel({
      id: randomUUID(),
      organisationId: req.orgId!,
      channelType,
      config,
      enabled,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json(channel);
  }),
);

router.get(
  '/api/approval-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const channels = await listOrgChannels(req.orgId!);
    res.json(channels);
  }),
);

router.patch(
  '/api/approval-channels/:channelId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const { channelType, config, enabled } = req.body as {
      channelType?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    const updated = await updateOrgChannel(
      req.params.channelId,
      req.orgId!,
      { channelType, config, enabled },
    );

    if (!updated) {
      throw { statusCode: 404, message: 'Approval channel not found.', errorCode: 'not_found' };
    }
    res.json(updated);
  }),
);

router.delete(
  '/api/approval-channels/:channelId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const deleted = await deleteOrgChannel(req.params.channelId, req.orgId!);

    if (!deleted) {
      throw { statusCode: 404, message: 'Approval channel not found.', errorCode: 'not_found' };
    }
    res.status(204).end();
  }),
);

// ===========================================================================
// Org-subaccount channel grants
// ===========================================================================

router.post(
  '/api/approval-channels/:channelId/grants',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.body as { subaccountId: string };
    // Reject body-supplied subaccount ids that don't belong to this org;
    // resolveSubaccount enforces tenant ownership (verify-subaccount-resolution.sh).
    const subaccount = await resolveSubaccount(subaccountId, req.orgId!);

    const { grantId } = await addGrant(
      req.params.channelId,
      subaccount.id,
      req.orgId!,
      req.user!.id,
    );

    res.status(201).json({ grantId });
  }),
);

router.delete(
  '/api/approval-channels/:channelId/grants/:grantId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    await revokeGrant(req.params.grantId, req.orgId!, req.user!.id);
    res.status(204).end();
  }),
);

export default router;
