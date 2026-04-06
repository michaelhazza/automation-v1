import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { taskAttachments, tasks } from '../db/schema/index.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
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
// Allowed MIME types
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a task and verify it belongs to the requesting org. */
async function resolveTask(taskId: string, orgId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId), isNull(tasks.deletedAt)));

  if (!task) throw { statusCode: 404, message: 'Task not found' };
  return task;
}

/** Resolve an attachment and verify org ownership. */
async function resolveAttachment(attachmentId: string, orgId: string) {
  const [attachment] = await db
    .select()
    .from(taskAttachments)
    .where(
      and(
        eq(taskAttachments.id, attachmentId),
        eq(taskAttachments.organisationId, orgId),
        isNull(taskAttachments.deletedAt),
      ),
    );

  if (!attachment) throw { statusCode: 404, message: 'Attachment not found' };
  return attachment;
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:taskId/attachments — upload a file
// ---------------------------------------------------------------------------
router.post(
  '/api/tasks/:taskId/attachments',
  authenticate,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const orgId = req.orgId!;
    const task = await resolveTask(taskId, orgId);

    const file = req.file;
    if (!file) throw { statusCode: 400, message: 'No file provided' };

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      // Clean up temp file
      await fs.unlink(file.path).catch(() => {});
      throw { statusCode: 400, message: `File type '${file.mimetype}' is not allowed` };
    }

    // Reject SVG explicitly (even if mimetype is spoofed)
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.svg') {
      await fs.unlink(file.path).catch(() => {});
      throw { statusCode: 400, message: 'SVG files are not allowed' };
    }

    // Idempotency check
    const idempotencyKey = req.body?.idempotencyKey as string | undefined;
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(taskAttachments)
        .where(
          and(
            eq(taskAttachments.taskId, taskId),
            eq(taskAttachments.idempotencyKey, idempotencyKey),
            isNull(taskAttachments.deletedAt),
          ),
        );

      if (existing) {
        // Clean up temp file and return existing
        await fs.unlink(file.path).catch(() => {});
        res.status(200).json(existing);
        return;
      }
    }

    // Build storage key
    const fileId = randomUUID();
    const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${orgId}/${task.id}/${fileId}-${safeFilename}`;

    // Read temp file, store via storage service, then clean up
    const fileData = await fs.readFile(file.path);
    await storageService.put(storageKey, fileData, file.mimetype);
    await fs.unlink(file.path).catch(() => {});

    // Create DB record
    const [attachment] = await db
      .insert(taskAttachments)
      .values({
        taskId: task.id,
        organisationId: orgId,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSizeBytes: file.size,
        storageKey,
        storageProvider: 'local',
        uploadedBy: req.user?.id ?? null,
        idempotencyKey: idempotencyKey || null,
      })
      .returning();

    res.status(201).json(attachment);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/tasks/:taskId/attachments — list attachments for a task
// ---------------------------------------------------------------------------
router.get(
  '/api/tasks/:taskId/attachments',
  authenticate,
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const orgId = req.orgId!;
    await resolveTask(taskId, orgId);

    const rows = await db
      .select()
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.organisationId, orgId),
          isNull(taskAttachments.deletedAt),
        ),
      )
      .orderBy(desc(taskAttachments.createdAt));

    res.json(rows);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/attachments/:attachmentId/download — download/stream a file
// ---------------------------------------------------------------------------
router.get(
  '/api/attachments/:attachmentId/download',
  authenticate,
  asyncHandler(async (req, res) => {
    const { attachmentId } = req.params;
    const orgId = req.orgId!;
    const attachment = await resolveAttachment(attachmentId, orgId);

    res.setHeader('Content-Type', attachment.fileType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.fileName.replace(/"/g, '\\"')}"`,
    );
    res.setHeader('Content-Length', String(attachment.fileSizeBytes));

    const stream = storageService.getStream(attachment.storageKey);
    stream.pipe(res);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/attachments/:attachmentId — soft-delete an attachment
// ---------------------------------------------------------------------------
router.delete(
  '/api/attachments/:attachmentId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { attachmentId } = req.params;
    const orgId = req.orgId!;
    await resolveAttachment(attachmentId, orgId);

    await db
      .update(taskAttachments)
      .set({ deletedAt: new Date() })
      .where(eq(taskAttachments.id, attachmentId));

    res.json({ success: true });
  }),
);

export default router;
