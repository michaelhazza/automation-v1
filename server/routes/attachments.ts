import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { attachmentService } from '../services/attachmentService.js';
import { storageService } from '../lib/storageService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Multer config — temp upload to data/uploads/, cleaned up after storage
// ---------------------------------------------------------------------------
const upload = multer({
  dest: 'data/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitise a filename for use in Content-Disposition headers. */
function sanitiseFileName(raw: string): string {
  // Strip control chars, newlines, and quotes that could enable header injection
  return raw.replace(/[\r\n\0"\\]/g, '_');
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:taskId/attachments — upload a file
// ---------------------------------------------------------------------------
router.post(
  '/api/tasks/:taskId/attachments',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const orgId = req.orgId!;

    const file = req.file;
    if (!file) throw { statusCode: 400, message: 'No file provided' };

    const idempotencyKey = req.body?.idempotencyKey as string | undefined;
    const { attachment, created } = await attachmentService.uploadAttachment(
      orgId,
      taskId,
      file,
      req.user?.id ?? null,
      idempotencyKey,
    );

    res.status(created ? 201 : 200).json(attachment);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/tasks/:taskId/attachments — list attachments for a task
// ---------------------------------------------------------------------------
router.get(
  '/api/tasks/:taskId/attachments',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const orgId = req.orgId!;

    const rows = await attachmentService.listAttachments(orgId, taskId);
    res.json(rows);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/attachments/:attachmentId/download — download/stream a file
// ---------------------------------------------------------------------------
router.get(
  '/api/attachments/:attachmentId/download',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { attachmentId } = req.params;
    const orgId = req.orgId!;

    const { attachment, task } = await attachmentService.getAttachment(orgId, attachmentId);

    // Verify the user has access to the task's subaccount
    await resolveSubaccount(task.subaccountId, orgId);

    const safeName = sanitiseFileName(attachment.fileName);

    res.setHeader('Content-Type', attachment.fileType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    res.setHeader('Content-Length', String(attachment.fileSizeBytes));

    const stream = storageService.getStream(attachment.storageKey);
    stream.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(404).json({ error: 'File not found on storage' });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/attachments/:attachmentId — soft-delete an attachment
// ---------------------------------------------------------------------------
router.delete(
  '/api/attachments/:attachmentId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { attachmentId } = req.params;
    const orgId = req.orgId!;

    const result = await attachmentService.deleteAttachment(orgId, attachmentId);
    res.json(result);
  }),
);

export default router;
