import { eq, and, isNull } from 'drizzle-orm';
import * as fs from 'node:fs';
import { db } from '../../db/index.js';
import { agents, agentDataSources } from '../../db/schema/index.js';
import { configHistoryService } from '../configHistoryService.js';
import { connectionTokenService } from '../connectionTokenService.js';
import { buildTree } from '../hierarchyService.js';
import { getS3Client, getBucketName } from '../../lib/storage.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens } from '../llmService.js';
import { v4 as uuidv4 } from 'uuid';
import { dataSourceCache, lastGoodContentCache, setCachedContent } from './caches.js';
import { dataSyncScheduler } from './scheduler.js';
import { fetchSourceContent, formatContent } from './externalFetchers.js';

export async function uploadDataSourceFile(
  agentId: string,
  organisationId: string,
  file: Express.Multer.File
) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!agent) throw { statusCode: 404, message: 'Agent not found' };

  const fileId = uuidv4();
  const storagePath = `agent-data-sources/${agentId}/${fileId}-${file.originalname}`;

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

  return { storagePath, fileName: file.originalname, mimeType: file.mimetype, fileSizeBytes: file.size };
}

export async function addDataSource(
  agentId: string,
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
  }
) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!agent) throw { statusCode: 404, message: 'Agent not found' };

  // file_upload is always static — force lazy and ignore any syncMode provided
  const syncMode = data.sourceType === 'file_upload' ? 'lazy' : (data.syncMode ?? 'lazy');

  const [source] = await db
    .insert(agentDataSources)
    .values({
      agentId,
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

  await configHistoryService.recordHistory({
    entityType: 'agent_data_source',
    entityId: source.id,
    organisationId,
    snapshot: source as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  if (source.syncMode === 'proactive') {
    dataSyncScheduler.schedule(source.id, source.cacheMinutes * 60 * 1000);
  }

  return source;
}

export async function updateDataSource(
  sourceId: string,
  agentId: string,
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
  }>
) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!agent) throw { statusCode: 404, message: 'Agent not found' };

  const [existing] = await db
    .select()
    .from(agentDataSources)
    .where(and(eq(agentDataSources.id, sourceId), eq(agentDataSources.agentId, agentId)));
  if (!existing) throw { statusCode: 404, message: 'Data source not found' };

  await configHistoryService.recordHistory({
    entityType: 'agent_data_source',
    entityId: sourceId,
    organisationId,
    snapshot: existing as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) update.name = data.name;
  if (data.description !== undefined) update.description = data.description;
  if (data.sourcePath !== undefined) update.sourcePath = data.sourcePath;
  if (data.sourceHeaders !== undefined) update.sourceHeaders = data.sourceHeaders ? connectionTokenService.encryptToken(JSON.stringify(data.sourceHeaders)) : null;
  if (data.contentType !== undefined) update.contentType = data.contentType;
  if (data.priority !== undefined) update.priority = data.priority;
  if (data.maxTokenBudget !== undefined) update.maxTokenBudget = data.maxTokenBudget;
  if (data.cacheMinutes !== undefined) update.cacheMinutes = data.cacheMinutes;
  // file_upload is always static
  if (data.syncMode !== undefined && existing.sourceType !== 'file_upload') {
    update.syncMode = data.syncMode;
  }

  // Invalidate hot cache on path change
  if (data.sourcePath !== undefined) {
    dataSourceCache.delete(sourceId);
    lastGoodContentCache.delete(sourceId);
  }

  const [updated] = await db
    .update(agentDataSources)
    .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
    .where(eq(agentDataSources.id, sourceId))
    .returning();

  // Reschedule or cancel based on new sync mode / interval
  if (updated.syncMode === 'proactive') {
    dataSyncScheduler.schedule(updated.id, updated.cacheMinutes * 60 * 1000);
  } else {
    dataSyncScheduler.cancel(updated.id);
  }

  return updated;
}

export async function deleteDataSource(sourceId: string, agentId: string, organisationId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!agent) throw { statusCode: 404, message: 'Agent not found' };

  const [existing] = await db
    .select()
    .from(agentDataSources)
    .where(and(eq(agentDataSources.id, sourceId), eq(agentDataSources.agentId, agentId)));
  if (!existing) throw { statusCode: 404, message: 'Data source not found' };

  await configHistoryService.recordHistory({
    entityType: 'agent_data_source',
    entityId: sourceId,
    organisationId,
    snapshot: existing as unknown as Record<string, unknown>,
    changedBy: null,
    changeSource: 'api',
    sessionId: null,
    changeSummary: null,
  });

  dataSyncScheduler.cancel(sourceId);
  dataSourceCache.delete(sourceId);
  lastGoodContentCache.delete(sourceId);
  await db.delete(agentDataSources).where(eq(agentDataSources.id, sourceId));
  return { message: 'Data source removed' };
}

export async function testDataSource(sourceId: string, agentId: string, organisationId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
  if (!agent) throw { statusCode: 404, message: 'Agent not found' };

  const [source] = await db
    .select()
    .from(agentDataSources)
    .where(and(eq(agentDataSources.id, sourceId), eq(agentDataSources.agentId, agentId)));
  if (!source) throw { statusCode: 404, message: 'Data source not found' };

  // Force re-fetch
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

export async function scheduleAllProactiveSources(): Promise<void> {
  const proactiveSources = await db
    .select()
    .from(agentDataSources)
    .where(eq(agentDataSources.syncMode, 'proactive'));

  for (const source of proactiveSources) {
    dataSyncScheduler.schedule(source.id, source.cacheMinutes * 60 * 1000);
  }

  if (proactiveSources.length > 0) {
    console.log(`[SYNC] Scheduled ${proactiveSources.length} proactive data source(s) for background sync`);
  }
}

/**
 * Return org agents as a nested tree structure.
 */
export async function getTree(organisationId: string) {
  const allAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.organisationId, organisationId), isNull(agents.deletedAt)))
    .orderBy(agents.name);

  return buildTree(
    allAgents.map(a => ({ ...a, sortOrder: 0 })),
    (a) => a.parentAgentId
  );
}

export const agentDataSourcesMethods = {
  uploadDataSourceFile,
  addDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSource,
  scheduleAllProactiveSources,
  getTree,
};
