import { eq, and, isNull } from 'drizzle-orm';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import { db } from '../db/index.js';
import { taskAttachments } from '../db/schema/index.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { approxTokens } from './llmService.js';
import type { LoadedDataSource } from './agentService.js';

// ---------------------------------------------------------------------------
// Task attachment context loader (spec §6.3)
//
// Task instance attachments have a different shape from agent_data_sources
// — they're general file uploads on a board task with MIME types, storage
// backends, and binary support. This service reads them and converts text-
// readable ones into the same LoadedDataSource shape that the context loader
// expects, so all four scopes (agent / subaccount / scheduled_task /
// task_instance) can be merged uniformly.
//
// Binary attachments are surfaced in the manifest with fetchOk: false so
// the agent knows they exist but can't read them. V1 supports text-readable
// formats only; PDF/DOCX/image parsing is deferred.
// ---------------------------------------------------------------------------

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.csv', '.xml', '.yaml', '.yml', '.log'];

function isTextReadable(mime: string, fileName: string): boolean {
  if (TEXT_MIME_PREFIXES.some(p => mime.startsWith(p))) return true;
  const lower = fileName.toLowerCase();
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function readAttachmentFromStorage(
  att: typeof taskAttachments.$inferSelect
): Promise<string> {
  if (att.storageProvider === 'local') {
    // Local filesystem: storageKey is a filesystem path
    return await readFile(att.storageKey, 'utf-8');
  }
  // s3 / r2 via the shared storage client
  const s3 = getS3Client();
  const bucket = getBucketName();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: att.storageKey });
  const result = await s3.send(cmd);
  const body = result.Body as { transformToString?: (encoding?: string) => Promise<string> } | null;
  if (!body) throw new Error('Empty response from storage');
  if (typeof body.transformToString !== 'function') {
    throw new Error('Storage response body is not readable as text');
  }
  return await body.transformToString('utf-8');
}

/**
 * Fetch the task's non-deleted attachments and convert them into
 * LoadedDataSource entries. Text-readable attachments become eager
 * sources with fetched content. Binary attachments become lazy
 * manifest entries with fetchOk: false (read_data_source will
 * return a structured error if the agent tries to read them).
 *
 * All entries use scope: 'task_instance' — the most specific scope,
 * resolved first in the precedence order defined by loadRunContextData.
 */
export async function loadTaskAttachmentsAsContext(
  taskId: string,
  organisationId: string
): Promise<LoadedDataSource[]> {
  const rows = await db
    .select()
    .from(taskAttachments)
    .where(
      and(
        eq(taskAttachments.taskId, taskId),
        eq(taskAttachments.organisationId, organisationId),
        isNull(taskAttachments.deletedAt),
      )
    );

  const results: LoadedDataSource[] = [];

  for (const att of rows) {
    const readable = isTextReadable(att.fileType, att.fileName);

    if (!readable) {
      // Binary / unreadable: surface in manifest only. fetchOk: false tells
      // the read_data_source skill to refuse the read with a clear error.
      results.push({
        id: `task_attachment:${att.id}`,
        scope: 'task_instance',
        name: att.fileName,
        description: `[${att.fileType}, binary — not readable in v1]`,
        content: '',
        contentType: 'text',
        tokenCount: 0,
        sizeBytes: att.fileSizeBytes,
        loadingMode: 'lazy',
        priority: 0,
        fetchOk: false,
        maxTokenBudget: 0,
      });
      continue;
    }

    // Text-readable: fetch the content now. Wrap in try/catch so a
    // decode failure or storage error marks the entry fetchOk: false
    // rather than crashing the whole loader.
    let content: string;
    let fetchOk = true;
    try {
      content = await readAttachmentFromStorage(att);
    } catch (err) {
      fetchOk = false;
      content = `[Task attachment "${att.fileName}" could not be loaded: ${err instanceof Error ? err.message : String(err)}]`;
    }

    results.push({
      id: `task_attachment:${att.id}`,
      scope: 'task_instance',
      name: att.fileName,
      description: null,
      content,
      contentType: 'text',
      tokenCount: approxTokens(content),
      sizeBytes: att.fileSizeBytes,
      loadingMode: fetchOk ? 'eager' : 'lazy',
      priority: 0,
      fetchOk,
      maxTokenBudget: 8000,
    });
  }

  return results;
}

/**
 * Fetch the full content of a specific task attachment by id. Used by the
 * read_data_source skill handler when the agent requests a task attachment
 * that wasn't eagerly loaded, or re-reads an already-loaded one.
 *
 * Returns null if the attachment does not exist, was deleted, does not
 * belong to the organisation, or is not text-readable. The caller is
 * expected to return a structured error in those cases.
 */
export async function readTaskAttachmentContent(
  attachmentId: string,
  organisationId: string
): Promise<string | null> {
  const [att] = await db
    .select()
    .from(taskAttachments)
    .where(
      and(
        eq(taskAttachments.id, attachmentId),
        eq(taskAttachments.organisationId, organisationId),
        isNull(taskAttachments.deletedAt),
      )
    );
  if (!att) return null;
  if (!isTextReadable(att.fileType, att.fileName)) return null;

  try {
    return await readAttachmentFromStorage(att);
  } catch {
    return null;
  }
}
