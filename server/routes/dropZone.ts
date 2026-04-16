/**
 * Drop Zone routes (S9)
 *
 * POST /api/subaccounts/:subaccountId/drop-zone/upload
 * GET  /api/subaccounts/:subaccountId/drop-zone/proposals/:uploadId
 * POST /api/subaccounts/:subaccountId/drop-zone/proposals/:uploadId/confirm
 *
 * Portal-path uploads (uploaderRole='client_contact') must pass the
 * `dropZone` portal-feature gate. Agency-path uploads only require
 * SUBACCOUNTS_EDIT permission.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.5 (S9)
 */

import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { canRenderPortalFeatureForSubaccount } from '../lib/portalGate.js';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import {
  upload as dropZoneUpload,
  confirm as dropZoneConfirm,
  getProposal,
  type UploaderRole,
  type ProposedDestination,
} from '../services/dropZoneService.js';

const router = Router();
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

router.post(
  '/api/subaccounts/:subaccountId/drop-zone/upload',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  uploadMiddleware.single('file'),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { subaccountId } = req.params;

    const [sa] = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.id, subaccountId),
          eq(subaccounts.organisationId, orgId),
          isNull(subaccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!sa) return res.status(404).json({ error: 'Subaccount not found' });

    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const uploaderRole: UploaderRole =
      (req.body?.uploaderRole === 'client_contact' ? 'client_contact' : 'agency_staff');

    // Gate portal-path uploads through portalGate
    if (uploaderRole === 'client_contact') {
      const allowed = await canRenderPortalFeatureForSubaccount(subaccountId, orgId, 'dropZone');
      if (!allowed) return res.status(403).json({ error: 'dropZone not enabled for this subaccount' });
    }

    const proposal = await dropZoneUpload({
      subaccountId,
      organisationId: orgId,
      uploaderUserId: uploaderRole === 'client_contact' ? null : userId,
      uploaderRole,
      artefact: {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      },
    });

    return res.status(201).json(proposal);
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/drop-zone/proposals/:uploadId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const proposal = getProposal(req.params.uploadId);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    return res.json(proposal);
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/drop-zone/proposals/:uploadId/confirm',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { subaccountId, uploadId } = req.params;
    const { selectedDestinations, uploaderRole } = req.body ?? {};

    if (!Array.isArray(selectedDestinations)) {
      return res.status(400).json({ error: 'selectedDestinations must be an array' });
    }

    const role: UploaderRole =
      (uploaderRole === 'client_contact' ? 'client_contact' : 'agency_staff');

    const result = await dropZoneConfirm({
      uploadId,
      subaccountId,
      organisationId: orgId,
      actorUserId: userId,
      uploaderRole: role,
      selectedDestinations: selectedDestinations as ProposedDestination[],
    });

    return res.json(result);
  }),
);

export default router;
