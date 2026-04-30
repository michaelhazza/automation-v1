import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { referenceDocuments, documentBundleAttachments, documentFetchEvents } from '../db/schema/index.js';
import { eq, and, isNull, desc, count } from 'drizzle-orm';
import * as documentBundleService from '../services/documentBundleService.js';
import { integrationConnectionService } from '../services/integrationConnectionService.js';
import {
  EXTERNAL_DOC_MAX_REFS_PER_SUBACCOUNT,
  EXTERNAL_DOC_MAX_REFS_PER_TASK,
} from '../lib/constants.js';
import type { FetchFailurePolicy } from '../db/schema/documentBundleAttachments.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/subaccounts/:subaccountId/tasks/:taskId/external-references
// List all Google Drive references attached to a task
// ---------------------------------------------------------------------------
router.get(
  '/api/subaccounts/:subaccountId/tasks/:taskId/external-references',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;

    const attachments = await documentBundleService.listAttachmentsForSubject({
      organisationId: req.orgId!,
      subjectType: 'task',
      subjectId: taskId,
    });

    if (attachments.length === 0) {
      return res.json([]);
    }

    const bundleId = attachments[0].bundleId;
    const bundleResult = await documentBundleService.getBundleWithMembers(bundleId, req.orgId!);
    if (!bundleResult) {
      return res.json([]);
    }

    const driveDocs = bundleResult.members.filter(
      (m) => m.document.sourceType === 'google_drive' && !m.document.deletedAt,
    );

    const db = getOrgScopedDb('externalDocumentReferences.list');
    const enriched = await Promise.all(
      driveDocs.map(async ({ document }) => {
        const [latestEvent] = await db
          .select()
          .from(documentFetchEvents)
          .where(eq(documentFetchEvents.referenceId, document.id))
          .orderBy(desc(documentFetchEvents.fetchedAt))
          .limit(1);
        return { ...document, latestFetchEvent: latestEvent ?? null };
      }),
    );

    return res.json(enriched);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/subaccounts/:subaccountId/tasks/:taskId/external-references
// Attach a Google Drive file to a task
// ---------------------------------------------------------------------------
router.post(
  '/api/subaccounts/:subaccountId/tasks/:taskId/external-references',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, taskId } = req.params;
    const { connectionId, fileId, fileName, mimeType } = req.body as {
      connectionId?: string;
      fileId?: string;
      fileName?: string;
      mimeType?: string;
    };

    if (!connectionId || !fileId || !fileName || !mimeType) {
      return res.status(400).json({ error: 'connectionId, fileId, fileName, and mimeType are required' });
    }

    // Validate connection belongs to org and is google_drive + active
    const conn = await integrationConnectionService.getOrgConnectionWithToken(connectionId, req.orgId!);
    if (!conn || conn.providerType !== 'google_drive') {
      return res.status(404).json({ error: 'connection_not_found' });
    }
    if (conn.connectionStatus !== 'active') {
      return res.status(422).json({ error: 'connection_not_active' });
    }

    const db = getOrgScopedDb('externalDocumentReferences.create');

    // Per-subaccount quota check
    const [subaccountCount] = await db
      .select({ value: count() })
      .from(referenceDocuments)
      .where(
        and(
          eq(referenceDocuments.organisationId, req.orgId!),
          eq(referenceDocuments.subaccountId, subaccountId),
          eq(referenceDocuments.sourceType, 'google_drive'),
          isNull(referenceDocuments.deletedAt),
        ),
      );

    if ((subaccountCount?.value ?? 0) >= EXTERNAL_DOC_MAX_REFS_PER_SUBACCOUNT) {
      return res.status(422).json({ error: 'subaccount_quota_exceeded' });
    }

    // Per-task quota check
    const attachments = await documentBundleService.listAttachmentsForSubject({
      organisationId: req.orgId!,
      subjectType: 'task',
      subjectId: taskId,
    });

    if (attachments.length > 0) {
      const bundleId = attachments[0].bundleId;
      const bundleResult = await documentBundleService.getBundleWithMembers(bundleId, req.orgId!);
      if (bundleResult) {
        const driveCount = bundleResult.members.filter(
          (m) => m.document.sourceType === 'google_drive' && !m.document.deletedAt,
        ).length;
        if (driveCount >= EXTERNAL_DOC_MAX_REFS_PER_TASK) {
          return res.status(422).json({ error: 'task_quota_exceeded' });
        }
      }
    }

    // Insert reference_documents row
    let newRef;
    try {
      [newRef] = await db
        .insert(referenceDocuments)
        .values({
          organisationId: req.orgId!,
          subaccountId,
          name: fileName,
          sourceType: 'google_drive',
          externalProvider: 'google_drive',
          externalConnectionId: connectionId,
          externalFileId: fileId,
          externalFileName: fileName,
          externalFileMimeType: mimeType,
          attachedByUserId: req.user!.id,
          attachmentState: 'active',
          currentVersion: 0,
        })
        .returning();
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === '23505') {
        return res.status(409).json({ error: 'reference_already_attached' });
      }
      throw err;
    }

    // Attach to bundle
    if (attachments.length > 0) {
      const bundleId = attachments[0].bundleId;
      await documentBundleService.addMember({
        bundleId,
        organisationId: req.orgId!,
        documentId: newRef.id,
      });
    } else {
      const bundle = await documentBundleService.findOrCreateUnnamedBundle({
        organisationId: req.orgId!,
        subaccountId,
        documentIds: [newRef.id],
        createdByUserId: req.user!.id,
      });
      await documentBundleService.attach({
        bundleId: bundle.id,
        subjectType: 'task',
        subjectId: taskId,
        attachedByUserId: req.user!.id,
        organisationId: req.orgId!,
        subaccountId,
      });
    }

    return res.status(201).json(newRef);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/subaccounts/:subaccountId/tasks/:taskId/external-references/:referenceId
// Remove a Drive reference from a task
// ---------------------------------------------------------------------------
router.delete(
  '/api/subaccounts/:subaccountId/tasks/:taskId/external-references/:referenceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, taskId, referenceId } = req.params;
    const db = getOrgScopedDb('externalDocumentReferences.delete');

    // Verify reference belongs to this org + subaccount + is google_drive
    const [ref] = await db
      .select()
      .from(referenceDocuments)
      .where(
        and(
          eq(referenceDocuments.id, referenceId),
          eq(referenceDocuments.organisationId, req.orgId!),
          eq(referenceDocuments.subaccountId, subaccountId),
          eq(referenceDocuments.sourceType, 'google_drive'),
          isNull(referenceDocuments.deletedAt),
        ),
      )
      .limit(1);

    if (!ref) {
      return res.status(404).json({ error: 'reference_not_found' });
    }

    // Find the bundle attachment for this task
    const attachments = await documentBundleService.listAttachmentsForSubject({
      organisationId: req.orgId!,
      subjectType: 'task',
      subjectId: taskId,
    });

    if (attachments.length > 0) {
      const bundleId = attachments[0].bundleId;
      await documentBundleService.removeMember({
        bundleId,
        organisationId: req.orgId!,
        documentId: referenceId,
      });
    }

    // Soft-delete the reference_documents row
    await db
      .update(referenceDocuments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(referenceDocuments.id, referenceId),
          eq(referenceDocuments.organisationId, req.orgId!),
        ),
      );

    return res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/subaccounts/:subaccountId/tasks/:taskId/external-references/:referenceId
// Re-bind a reference to a new connection
// ---------------------------------------------------------------------------
router.patch(
  '/api/subaccounts/:subaccountId/tasks/:taskId/external-references/:referenceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, referenceId } = req.params;
    const { connectionId } = req.body as { connectionId?: string };

    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId is required' });
    }

    // Validate new connection
    const conn = await integrationConnectionService.getOrgConnectionWithToken(connectionId, req.orgId!);
    if (!conn || conn.providerType !== 'google_drive') {
      return res.status(404).json({ error: 'connection_not_found' });
    }
    if (conn.connectionStatus !== 'active') {
      return res.status(422).json({ error: 'connection_not_active' });
    }

    const db = getOrgScopedDb('externalDocumentReferences.rebind');

    const [updated] = await db
      .update(referenceDocuments)
      .set({
        externalConnectionId: connectionId,
        attachmentState: 'active',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(referenceDocuments.id, referenceId),
          eq(referenceDocuments.organisationId, req.orgId!),
          eq(referenceDocuments.subaccountId, subaccountId),
          eq(referenceDocuments.sourceType, 'google_drive'),
          isNull(referenceDocuments.deletedAt),
        ),
      )
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'reference_not_found' });
    }

    return res.json(updated);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/subaccounts/:subaccountId/tasks/:taskId/bundle-attachment
// Update fetch_failure_policy for the task's bundle attachment
// ---------------------------------------------------------------------------
router.patch(
  '/api/subaccounts/:subaccountId/tasks/:taskId/bundle-attachment',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const { fetchFailurePolicy } = req.body as { fetchFailurePolicy?: FetchFailurePolicy };

    const validPolicies: FetchFailurePolicy[] = ['tolerant', 'strict', 'best_effort'];
    if (!fetchFailurePolicy || !validPolicies.includes(fetchFailurePolicy)) {
      return res.status(400).json({ error: 'fetchFailurePolicy must be one of: tolerant, strict, best_effort' });
    }

    const attachments = await documentBundleService.listAttachmentsForSubject({
      organisationId: req.orgId!,
      subjectType: 'task',
      subjectId: taskId,
    });

    if (attachments.length === 0) {
      return res.status(404).json({ error: 'no_bundle_attachment_found' });
    }

    const db = getOrgScopedDb('externalDocumentReferences.updatePolicy');
    await db
      .update(documentBundleAttachments)
      .set({ fetchFailurePolicy })
      .where(
        and(
          eq(documentBundleAttachments.id, attachments[0].id),
          eq(documentBundleAttachments.organisationId, req.orgId!),
          isNull(documentBundleAttachments.deletedAt),
        ),
      );

    return res.status(204).send();
  }),
);

export default router;
