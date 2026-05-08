import { Router } from 'express';
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { fileService } from '../services/fileService.js';
import { validateMultipart } from '../middleware/validate.js';
import { systemSettingsService } from '../services/systemSettingsService.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { documentPromotionAudit, executionFiles, executions } from '../db/schema/index.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// Allowlist of MIME types accepted for execution file uploads
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/tiff',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text / data
  'text/plain', 'text/csv', 'text/html', 'text/xml',
  'application/json', 'application/xml',
  // Archives
  'application/zip', 'application/x-zip-compressed',
  'application/gzip', 'application/x-tar',
  // Audio / video
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'video/mp4', 'video/webm', 'video/ogg',
]);

router.post('/api/files/upload', authenticate, validateMultipart, asyncHandler(async (req, res) => {
  const { executionId } = req.body;
  if (!executionId) {
    res.status(400).json({ error: 'Validation failed', details: 'executionId is required' });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No file provided' });
    return;
  }

  const file = files[0];

  // Reject disallowed file types
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    res.status(415).json({ error: 'Unsupported file type. Please upload a document, image, spreadsheet, archive, or media file.' });
    return;
  }

  // Enforce the configurable max upload size from system settings
  const maxBytes = await systemSettingsService.getMaxUploadSizeBytes();
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    res.status(413).json({ error: `File too large. Maximum allowed size is ${maxMb} MB.` });
    return;
  }

  const result = await fileService.uploadFile(executionId, req.user!.id, req.orgId!, file);
  res.status(201).json(result);
}));

router.get('/api/files/:fileId/download', authenticate, asyncHandler(async (req, res) => {
  const result = await fileService.downloadFile(req.params.fileId, req.user!.id, req.orgId!, req.user!.role);
  res.json(result);
}));

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

router.get(
  '/api/files',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REFERENCE_DOCUMENTS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId, linkedToKnowledge, cursor, limit: limitParam } = req.query as Record<string, string | undefined>;
    const rawLimit = parseInt(limitParam ?? String(DEFAULT_LIMIT), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

    const conditions = [
      eq(executions.organisationId, req.orgId!),
    ];

    if (subaccountId) {
      conditions.push(eq(executions.subaccountId, subaccountId));
    }

    if (cursor) {
      const cursorDate = new Date(cursor);
      if (isNaN(cursorDate.getTime())) {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
      conditions.push(lt(executionFiles.createdAt, cursorDate));
    }

    const promotionConditions = [
      eq(documentPromotionAudit.fileId, executionFiles.id),
      eq(documentPromotionAudit.organisationId, req.orgId!),
      isNull(documentPromotionAudit.deletedAt),
    ];

    const rows = await db
      .select({
        id: executionFiles.id,
        fileName: executionFiles.fileName,
        fileType: executionFiles.fileType,
        mimeType: executionFiles.mimeType,
        fileSizeBytes: executionFiles.fileSizeBytes,
        expiresAt: executionFiles.expiresAt,
        createdAt: executionFiles.createdAt,
        executionId: executionFiles.executionId,
        subaccountId: executions.subaccountId,
        promotedDocumentId: documentPromotionAudit.documentId,
      })
      .from(executionFiles)
      .innerJoin(executions, eq(executionFiles.executionId, executions.id))
      .leftJoin(documentPromotionAudit, and(...promotionConditions))
      .where(
        linkedToKnowledge === 'true'
          ? and(...conditions, isNotNull(documentPromotionAudit.id))
          : linkedToKnowledge === 'false'
            ? and(...conditions, isNull(documentPromotionAudit.id))
            : and(...conditions),
      )
      .orderBy(desc(executionFiles.createdAt), desc(executionFiles.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const files = rows.slice(0, limit).map((r) => ({
      ...r,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      promotedDocumentId: r.promotedDocumentId ?? null,
    }));

    res.json({ files, hasMore });
  }),
);

export default router;
