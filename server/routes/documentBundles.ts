import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as documentBundleService from '../services/documentBundleService.js';
import type { AttachmentSubjectType } from '../services/documentBundleService.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/document-bundles/bundles — list named bundles (is_auto_created=false)
// ---------------------------------------------------------------------------
router.get(
  '/api/document-bundles/bundles',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.query as Record<string, string | undefined>;
    const bundles = await documentBundleService.listBundles(req.orgId!, {
      subaccountId: subaccountId ?? undefined,
    });
    res.json(bundles);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/document-bundles/admin/all — list ALL bundles (admin only)
// ---------------------------------------------------------------------------
router.get(
  '/api/document-bundles/admin/all',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.query as Record<string, string | undefined>;
    const bundles = await documentBundleService.listAllBundles(req.orgId!, {
      subaccountId: subaccountId ?? undefined,
    });
    res.json(bundles);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/document-bundles/suggest-bundle — bundle-save suggestion lookup
// ---------------------------------------------------------------------------
router.get(
  '/api/document-bundles/suggest-bundle',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
  asyncHandler(async (req, res) => {
    const { documentIds: rawIds, excludeSubjectType, excludeSubjectId, subaccountId } = req.query as Record<string, string | undefined>;
    const documentIds = rawIds ? rawIds.split(',').map((s) => s.trim()).filter(Boolean) : [];

    const result = await documentBundleService.suggestBundle({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
      userId: req.user!.id,
      documentIds,
      excludeSubjectId:
        excludeSubjectType && excludeSubjectId
          ? { subjectType: excludeSubjectType as AttachmentSubjectType, subjectId: excludeSubjectId }
          : undefined,
    });

    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/document-bundles/attach-documents — attach-by-document-set (Flow A)
// ---------------------------------------------------------------------------
router.post(
  '/api/document-bundles/attach-documents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_ATTACH),
  asyncHandler(async (req, res) => {
    const { documentIds, subjectType, subjectId, subaccountId } = req.body as {
      documentIds?: string[];
      subjectType?: AttachmentSubjectType;
      subjectId?: string;
      subaccountId?: string;
    };

    if (!documentIds || documentIds.length === 0 || !subjectType || !subjectId) {
      res.status(400).json({ error: 'documentIds, subjectType, and subjectId are required' });
      return;
    }

    const bundle = await documentBundleService.findOrCreateUnnamedBundle({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
      documentIds,
      createdByUserId: req.user!.id,
    });

    const attachment = await documentBundleService.attach({
      bundleId: bundle.id,
      subjectType,
      subjectId,
      attachedByUserId: req.user!.id,
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
    });

    res.json({
      bundleId: bundle.id,
      bundleIsAutoCreated: bundle.isAutoCreated,
      attachmentId: attachment.id,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/document-bundles/:id — get bundle with members
// ---------------------------------------------------------------------------
router.get(
  '/api/document-bundles/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
  asyncHandler(async (req, res) => {
    const result = await documentBundleService.getBundleWithMembers(req.params.id, req.orgId!);
    if (!result) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/document-bundles/admin/:id/utilization — utilization JSONB (admin)
// ---------------------------------------------------------------------------
router.get(
  '/api/document-bundles/admin/:id/utilization',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
  asyncHandler(async (req, res) => {
    const result = await documentBundleService.getBundleWithMembers(req.params.id, req.orgId!);
    if (!result) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }
    res.json({ bundleId: result.bundle.id, utilizationByModelFamily: result.bundle.utilizationByModelFamily ?? null });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/document-bundles/:id — rename + description (named bundles only)
// ---------------------------------------------------------------------------
router.patch(
  '/api/document-bundles/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_WRITE),
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    // Only allow renaming named bundles
    const existing = await documentBundleService.getBundleWithMembers(req.params.id, req.orgId!);
    if (!existing) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }
    if (existing.bundle.isAutoCreated) {
      res.status(409).json({ error: 'Cannot rename an unnamed bundle', code: documentBundleService.CACHED_CONTEXT_BUNDLE_ALREADY_NAMED });
      return;
    }
    // Re-promote with the new name (update name)
    const updated = await documentBundleService.promoteToNamedBundle({
      bundleId: req.params.id,
      organisationId: req.orgId!,
      name,
      userId: req.user!.id,
    }).catch((e: { code?: string }) => {
      if (e?.code === documentBundleService.CACHED_CONTEXT_BUNDLE_ALREADY_NAMED) {
        // Already named — just do a direct update via the existing promote path won't work
        // since it checks is_auto_created=true. Throw a different error.
        throw { statusCode: 409, code: e.code, message: 'Bundle already named; use a different endpoint to rename' };
      }
      throw e;
    });
    res.json(updated);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/document-bundles/:id/promote — promote unnamed → named
// ---------------------------------------------------------------------------
router.post(
  '/api/document-bundles/:id/promote',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_WRITE),
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const bundle = await documentBundleService.promoteToNamedBundle({
      bundleId: req.params.id,
      organisationId: req.orgId!,
      name,
      userId: req.user!.id,
    });
    res.json({ bundleId: bundle.id, name: bundle.name, isAutoCreated: bundle.isAutoCreated });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/document-bundles/:id/members — addMember
// ---------------------------------------------------------------------------
router.post(
  '/api/document-bundles/:id/members',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_WRITE),
  asyncHandler(async (req, res) => {
    const { documentId } = req.body as { documentId?: string };
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    const member = await documentBundleService.addMember({ bundleId: req.params.id, organisationId: req.orgId!, documentId });
    res.status(201).json(member);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/document-bundles/:id/members/:docId — removeMember
// ---------------------------------------------------------------------------
router.delete(
  '/api/document-bundles/:id/members/:docId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_WRITE),
  asyncHandler(async (req, res) => {
    await documentBundleService.removeMember({ bundleId: req.params.id, organisationId: req.orgId!, documentId: req.params.docId });
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// POST /api/document-bundles/:id/attach — attach bundle to a subject
// ---------------------------------------------------------------------------
router.post(
  '/api/document-bundles/:id/attach',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_ATTACH),
  asyncHandler(async (req, res) => {
    const { subjectType, subjectId, subaccountId } = req.body as {
      subjectType?: AttachmentSubjectType;
      subjectId?: string;
      subaccountId?: string;
    };
    if (!subjectType || !subjectId) {
      res.status(400).json({ error: 'subjectType and subjectId are required' });
      return;
    }
    const attachment = await documentBundleService.attach({
      bundleId: req.params.id,
      subjectType,
      subjectId,
      attachedByUserId: req.user!.id,
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
    });
    res.status(201).json(attachment);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/document-bundles/:id/attach/:subjectType/:subjectId — detach
// ---------------------------------------------------------------------------
router.delete(
  '/api/document-bundles/:id/attach/:subjectType/:subjectId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_ATTACH),
  asyncHandler(async (req, res) => {
    await documentBundleService.detach({
      bundleId: req.params.id,
      organisationId: req.orgId!,
      subjectType: req.params.subjectType as AttachmentSubjectType,
      subjectId: req.params.subjectId,
    });
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/document-bundles/:id — soft delete
// ---------------------------------------------------------------------------
router.delete(
  '/api/document-bundles/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_WRITE),
  asyncHandler(async (req, res) => {
    await documentBundleService.softDelete(req.params.id, req.orgId!);
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// POST /api/bundle-suggestion-dismissals — record a dismissal
// ---------------------------------------------------------------------------
router.post(
  '/api/bundle-suggestion-dismissals',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
  asyncHandler(async (req, res) => {
    const { documentIds, subaccountId } = req.body as { documentIds?: string[]; subaccountId?: string };
    if (!documentIds || documentIds.length === 0) {
      res.status(400).json({ error: 'documentIds are required' });
      return;
    }
    const dismissal = await documentBundleService.dismissBundleSuggestion({
      organisationId: req.orgId!,
      subaccountId: subaccountId ?? null,
      userId: req.user!.id,
      documentIds,
    });
    res.status(201).json(dismissal);
  }),
);

// ---------------------------------------------------------------------------
// Subject attachment listing routes
// GET /api/agents/:id/attached-bundles
// GET /api/tasks/:id/attached-bundles
// GET /api/scheduled-tasks/:id/attached-bundles
// ---------------------------------------------------------------------------
for (const [path, subjectType] of [
  ['/api/agents/:id/attached-bundles', 'agent'],
  ['/api/tasks/:id/attached-bundles', 'task'],
  ['/api/scheduled-tasks/:id/attached-bundles', 'scheduled_task'],
] as const) {
  router.get(
    path,
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.DOCUMENT_BUNDLES_READ),
    asyncHandler(async (req, res) => {
      const attachments = await documentBundleService.listAttachmentsForSubject({
        organisationId: req.orgId!,
        subjectType,
        subjectId: req.params.id,
      });
      res.json({ attachments });
    }),
  );
}

export default router;
