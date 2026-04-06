import { eq, and, isNull, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/index.js';
import { taskAttachments, tasks } from '../db/schema/index.js';
import { storageService } from '../lib/storageService.js';

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

/** Resolve a task and verify it belongs to the requesting org. Returns the full task row. */
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
// Service
// ---------------------------------------------------------------------------

export const attachmentService = {
  /**
   * Upload a file attachment to a task.
   * Validates MIME type, handles idempotency, stores the file, and creates the DB record.
   */
  async uploadAttachment(
    orgId: string,
    taskId: string,
    file: Express.Multer.File,
    uploadedBy: string | null,
    idempotencyKey?: string,
  ) {
    const task = await resolveTask(taskId, orgId);

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
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
        await fs.unlink(file.path).catch(() => {});
        return { attachment: existing, created: false };
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

    // Create DB record — if insert fails, clean up the stored file to prevent orphans
    let attachment;
    try {
      const [row] = await db
        .insert(taskAttachments)
        .values({
          taskId: task.id,
          organisationId: orgId,
          fileName: file.originalname,
          fileType: file.mimetype,
          fileSizeBytes: file.size,
          storageKey,
          storageProvider: 'local',
          uploadedBy,
          idempotencyKey: idempotencyKey || null,
        })
        .returning();
      attachment = row;
    } catch (err) {
      // Clean up orphaned file on DB failure
      await storageService.delete(storageKey).catch(() => {});
      throw err;
    }

    return { attachment, created: true };
  },

  /**
   * List all non-deleted attachments for a task, newest first.
   */
  async listAttachments(orgId: string, taskId: string) {
    await resolveTask(taskId, orgId);

    return db
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
  },

  /**
   * Get a single attachment by ID.
   * Also returns the parent task so the caller can verify subaccount access.
   */
  async getAttachment(orgId: string, attachmentId: string) {
    const attachment = await resolveAttachment(attachmentId, orgId);
    const task = await resolveTask(attachment.taskId, orgId);
    return { attachment, task };
  },

  /**
   * Soft-delete an attachment.
   */
  async deleteAttachment(orgId: string, attachmentId: string) {
    await resolveAttachment(attachmentId, orgId);

    await db
      .update(taskAttachments)
      .set({ deletedAt: new Date() })
      .where(eq(taskAttachments.id, attachmentId));

    return { success: true };
  },
};
