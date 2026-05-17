import { eq, and, asc } from 'drizzle-orm';
import * as fs from 'node:fs';
import { db } from '../../db/index.js';
import { agentDataSources, scheduledTasks } from '../../db/schema/index.js';
import { auditService } from '../auditService.js';
import { connectionTokenService } from '../connectionTokenService.js';
import { getS3Client, getBucketName } from '../../lib/storage.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens } from '../llmService.js';
import { v4 as uuidv4 } from 'uuid';
import { dataSourceCache, lastGoodContentCache, setCachedContent } from './caches.js';
import { dataSyncScheduler } from './scheduler.js';
import { fetchSourceContent, formatContent } from './externalFetchers.js';

/**
 * Helper: load a scheduled task and verify org ownership.
 * Throws 404 if the task does not exist or belongs to a different org.
 */
export async function _getScheduledTaskOrThrow(scheduledTaskId: string, organisationId: string) {
  const [st] = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.id, scheduledTaskId),
        eq(scheduledTasks.organisationId, organisationId),
      )
    );
  if (!st) throw { statusCode: 404, message: 'Scheduled task not found' };
  return st;
}

export async function listScheduledTaskDataSources(scheduledTaskId: string, organisationId: string) {
  await _getScheduledTaskOrThrow(scheduledTaskId, organisationId);
  return db
    .select()
    .from(agentDataSources)
    .where(eq(agentDataSources.scheduledTaskId, scheduledTaskId))
    .orderBy(asc(agentDataSources.priority));
}

export async function addScheduledTaskDataSource(
  scheduledTaskId: string,
  organisationId: string,
  data: {
    name: string;
    description?: string;
    sourceType: 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload' | 'google_drive';
    sourcePath?: string;
    sourceHeaders?: Record<string, string>;
    contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
    syncMode?: 'lazy' | 'proactive';
    priority?: number;
    maxTokenBudget?: number;
    cacheMinutes?: number;
    connectionId?: string;
  },
  actorUserId?: string
) {
  const st = await _getScheduledTaskOrThrow(scheduledTaskId, organisationId);

  // file_upload is always static — force lazy and ignore any syncMode provided
  const syncMode = data.sourceType === 'file_upload' ? 'lazy' : (data.syncMode ?? 'lazy');

  const [source] = await db
    .insert(agentDataSources)
    .values({
      agentId: st.assignedAgentId,
      scheduledTaskId,
      name: data.name,
      description: data.description,
      sourceType: data.sourceType,
      sourcePath: data.sourcePath ?? '',
      sourceHeaders: data.sourceHeaders ? connectionTokenService.encryptToken(JSON.stringify(data.sourceHeaders)) : undefined,
      contentType: data.contentType ?? 'auto',
      syncMode,
      priority: data.priority ?? 0,
      maxTokenBudget: data.maxTokenBudget ?? 8000,
      cacheMinutes: data.cacheMinutes ?? 60,
      connectionId: data.connectionId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (source.syncMode === 'proactive') {
    dataSyncScheduler.schedule(source.id, source.cacheMinutes * 60 * 1000);
  }

  // Audit event (spec §10.5 / pr-reviewer Blocker 3)
  await auditService.log({
    organisationId,
    actorId: actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    action: 'scheduled_task.data_source.created',
    entityType: 'scheduled_task_data_source',
    entityId: source.id,
    metadata: {
      scheduledTaskId,
      name: source.name,
      sourceType: source.sourceType,
    },
  });

  return source;
}

export async function updateScheduledTaskDataSource(
  sourceId: string,
  scheduledTaskId: string,
  organisationId: string,
  data: Partial<{
    name: string;
    description: string | null;
    sourcePath: string;
    sourceHeaders?: Record<string, string> | null;
    contentType: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
    syncMode: 'lazy' | 'proactive';
    priority: number;
    maxTokenBudget: number;
    cacheMinutes: number;
  }>,
  actorUserId?: string
) {
  await _getScheduledTaskOrThrow(scheduledTaskId, organisationId);

  const [existing] = await db
    .select()
    .from(agentDataSources)
    .where(
      and(
        eq(agentDataSources.id, sourceId),
        eq(agentDataSources.scheduledTaskId, scheduledTaskId),
      )
    );
  if (!existing) throw { statusCode: 404, message: 'Data source not found' };

  // Build the update payload as a properly-typed Drizzle partial.
  // (pr-reviewer Major 1: previously cast to `never` which bypassed
  // Drizzle's column type checking entirely.)
  const update: Partial<typeof agentDataSources.$inferInsert> = { updatedAt: new Date() };
  if (data.name !== undefined) update.name = data.name;
  if (data.description !== undefined) update.description = data.description;
  if (data.sourcePath !== undefined) update.sourcePath = data.sourcePath;
  if (data.sourceHeaders !== undefined) update.sourceHeaders = data.sourceHeaders ? connectionTokenService.encryptToken(JSON.stringify(data.sourceHeaders)) : null;
  if (data.contentType !== undefined) update.contentType = data.contentType;
  if (data.priority !== undefined) update.priority = data.priority;
  if (data.maxTokenBudget !== undefined) update.maxTokenBudget = data.maxTokenBudget;
  if (data.cacheMinutes !== undefined) update.cacheMinutes = data.cacheMinutes;
  if (data.syncMode !== undefined && existing.sourceType !== 'file_upload') {
    update.syncMode = data.syncMode;
  }

  if (data.sourcePath !== undefined) {
    dataSourceCache.delete(sourceId);
    lastGoodContentCache.delete(sourceId);
  }

  const [updated] = await db
    .update(agentDataSources)
    .set(update)
    .where(
      and(
        eq(agentDataSources.id, sourceId),
        // Re-assert the scheduled-task ownership in the UPDATE itself.
        // The earlier select() proved ownership at read time, but a
        // concurrent request targeting the same sourceId could otherwise
        // race past it. The composite WHERE makes the UPDATE a no-op
        // unless the row still belongs to this scheduled task.
        eq(agentDataSources.scheduledTaskId, scheduledTaskId),
      )
    )
    .returning();
  if (!updated) throw { statusCode: 404, message: 'Data source not found' };

  if (updated.syncMode === 'proactive') {
    dataSyncScheduler.schedule(updated.id, updated.cacheMinutes * 60 * 1000);
  } else {
    dataSyncScheduler.cancel(updated.id);
  }

  // Audit event (spec §10.5 / pr-reviewer Blocker 3)
  await auditService.log({
    organisationId,
    actorId: actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    action: 'scheduled_task.data_source.updated',
    entityType: 'scheduled_task_data_source',
    entityId: updated.id,
    metadata: {
      scheduledTaskId,
      name: updated.name,
      changedFields: Object.keys(data),
    },
  });

  return updated;
}

export async function deleteScheduledTaskDataSource(
  sourceId: string,
  scheduledTaskId: string,
  organisationId: string,
  actorUserId?: string
) {
  await _getScheduledTaskOrThrow(scheduledTaskId, organisationId);

  const [existing] = await db
    .select()
    .from(agentDataSources)
    .where(
      and(
        eq(agentDataSources.id, sourceId),
        eq(agentDataSources.scheduledTaskId, scheduledTaskId),
      )
    );
  if (!existing) throw { statusCode: 404, message: 'Data source not found' };

  dataSyncScheduler.cancel(sourceId);
  dataSourceCache.delete(sourceId);
  lastGoodContentCache.delete(sourceId);
  await db
    .delete(agentDataSources)
    .where(
      and(
        eq(agentDataSources.id, sourceId),
        // Reassert scheduled-task ownership in the DELETE statement to
        // close the TOCTOU window between the existence check above and
        // the destructive write below.
        eq(agentDataSources.scheduledTaskId, scheduledTaskId),
      )
    );

  // Audit event (spec §10.5 / pr-reviewer Blocker 3)
  await auditService.log({
    organisationId,
    actorId: actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    action: 'scheduled_task.data_source.deleted',
    entityType: 'scheduled_task_data_source',
    entityId: sourceId,
    metadata: {
      scheduledTaskId,
      name: existing.name,
      sourceType: existing.sourceType,
    },
  });

  return { message: 'Data source removed' };
}

export async function testScheduledTaskDataSource(
  sourceId: string,
  scheduledTaskId: string,
  organisationId: string
) {
  await _getScheduledTaskOrThrow(scheduledTaskId, organisationId);

  const [source] = await db
    .select()
    .from(agentDataSources)
    .where(
      and(
        eq(agentDataSources.id, sourceId),
        eq(agentDataSources.scheduledTaskId, scheduledTaskId),
      )
    );
  if (!source) throw { statusCode: 404, message: 'Data source not found' };

  dataSourceCache.delete(sourceId);

  try {
    const raw = await fetchSourceContent(source);
    const content = formatContent(raw, source.contentType);
    const tokenCount = approxTokens(content);

    lastGoodContentCache.set(sourceId, content);
    setCachedContent(sourceId, content, source.cacheMinutes);
    await db.update(agentDataSources)
      .set({ lastFetchedAt: new Date(), lastFetchStatus: 'ok', lastFetchError: null, updatedAt: new Date() })
      .where(eq(agentDataSources.id, sourceId));

    return {
      ok: true,
      tokenCount,
      preview: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    await db.update(agentDataSources)
      .set({ lastFetchedAt: new Date(), lastFetchStatus: 'error', lastFetchError: errMsg, updatedAt: new Date() })
      .where(eq(agentDataSources.id, sourceId));
    return { ok: false, error: errMsg };
  }
}

/**
 * Upload a file AND create the data source row in a single atomic call.
 * Previously the route called this and then made a second request to
 * `addScheduledTaskDataSource` — if the second request failed, the file
 * would orphan in S3 indefinitely. Combining the two into one service
 * method ensures that if the DB insert fails after the upload, we
 * best-effort clean up the S3 object before propagating the error.
 * (pr-reviewer Major 4.)
 *
 * Caller passes display metadata (name / description / contentType /
 * priority) so the row matches what the operator intended in the upload form.
 */
export async function uploadScheduledTaskDataSourceFile(
  scheduledTaskId: string,
  organisationId: string,
  file: Express.Multer.File,
  metadata: {
    name: string;
    description?: string;
    contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
    priority?: number;
    maxTokenBudget?: number;
  },
  actorUserId?: string
) {
  const st = await _getScheduledTaskOrThrow(scheduledTaskId, organisationId);

  const fileId = uuidv4();
  const storagePath = `scheduled-task-data-sources/${scheduledTaskId}/${fileId}-${file.originalname}`;

  // `validateMultipart` uses `multer.diskStorage` (spec §6.1) so files arrive
  // on disk at `file.path`, not in `file.buffer`. Stream from disk.
  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket: getBucketName(),
    Key: storagePath,
    Body: fs.createReadStream(file.path),
    ContentLength: file.size,
    ContentType: file.mimetype,
  }));

  // From here on, if anything fails we must best-effort delete the
  // uploaded object so it doesn't orphan.
  try {
    const [source] = await db
      .insert(agentDataSources)
      .values({
        agentId: st.assignedAgentId,
        scheduledTaskId,
        name: metadata.name,
        description: metadata.description,
        sourceType: 'file_upload',
        sourcePath: storagePath,
        contentType: metadata.contentType ?? 'auto',
        syncMode: 'lazy', // file_upload is always static
        priority: metadata.priority ?? 0,
        maxTokenBudget: metadata.maxTokenBudget ?? 8000,
        cacheMinutes: 60,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await auditService.log({
      organisationId,
      actorId: actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      action: 'scheduled_task.data_source.created',
      entityType: 'scheduled_task_data_source',
      entityId: source.id,
      metadata: {
        scheduledTaskId,
        name: source.name,
        sourceType: 'file_upload',
        fileName: file.originalname,
        fileSizeBytes: file.size,
      },
    });

    return source;
  } catch (err) {
    // Best-effort cleanup — we don't want to fail the original error if
    // the cleanup itself fails, so swallow any cleanup error and log it.
    try {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: storagePath }));
    } catch (cleanupErr) {
      console.error(
        '[agentService] Failed to clean up orphaned upload after insert error:',
        { storagePath, cleanupErr }
      );
    }
    throw err;
  }
}

export const scheduledTaskDataSourcesMethods = {
  _getScheduledTaskOrThrow,
  listScheduledTaskDataSources,
  addScheduledTaskDataSource,
  updateScheduledTaskDataSource,
  deleteScheduledTaskDataSource,
  testScheduledTaskDataSource,
  uploadScheduledTaskDataSourceFile,
};
