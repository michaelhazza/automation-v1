import { eq, and, isNull, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, agentDataSources } from '../db/schema/index.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens } from './llmService.js';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// In-memory data source content cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  content: string;
  fetchedAt: number;
  expiresAt: number;
}

const dataSourceCache = new Map<string, CacheEntry>();

function getCachedContent(sourceId: string): string | null {
  const entry = dataSourceCache.get(sourceId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    dataSourceCache.delete(sourceId);
    return null;
  }
  return entry.content;
}

function setCachedContent(sourceId: string, content: string, cacheMinutes: number): void {
  dataSourceCache.set(sourceId, {
    content,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + cacheMinutes * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Fetch raw content from a data source
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Google Docs helpers
// ---------------------------------------------------------------------------

function extractGoogleDocId(urlOrId: string): string {
  const match = urlOrId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}

interface GoogleDocsContent {
  body?: {
    content?: Array<{
      paragraph?: {
        elements?: Array<{ textRun?: { content?: string } }>;
      };
    }>;
  };
}

function extractGoogleDocText(doc: GoogleDocsContent): string {
  const lines: string[] = [];
  for (const item of doc.body?.content ?? []) {
    if (item.paragraph?.elements) {
      const line = item.paragraph.elements.map((el) => el.textRun?.content ?? '').join('');
      lines.push(line);
    }
  }
  return lines.join('');
}

// ---------------------------------------------------------------------------
// Fetch raw content from a data source
// ---------------------------------------------------------------------------

async function fetchSourceContent(source: typeof agentDataSources.$inferSelect): Promise<string> {
  if (source.sourceType === 'http_url') {
    const headers: Record<string, string> = { Accept: 'text/plain, application/json, text/csv, */*' };
    if (source.sourceHeaders) {
      Object.assign(headers, source.sourceHeaders);
    }
    const response = await fetch(source.sourcePath, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.text();
  }

  if (source.sourceType === 'google_docs') {
    const docId = extractGoogleDocId(source.sourcePath);
    const apiKey = source.sourceHeaders?.['x-google-api-key'];
    if (apiKey) {
      const url = `https://docs.googleapis.com/v1/documents/${docId}?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Google Docs API error ${response.status}: ${response.statusText}. Ensure the API key is valid and the document is accessible.`);
      }
      const doc = await response.json() as GoogleDocsContent;
      return extractGoogleDocText(doc);
    } else {
      const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`Failed to fetch Google Doc (HTTP ${response.status}). Ensure the document is published or shared publicly, or provide a Google Docs API key.`);
      }
      return await response.text();
    }
  }

  // S3 / R2 / file_upload all read from object storage
  const s3 = getS3Client();
  const bucket = getBucketName();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: source.sourcePath });
  const result = await s3.send(cmd);
  const body = result.Body;
  if (!body) throw new Error('Empty response from storage');
  // @ts-expect-error — transformToString exists on S3 Body stream
  return await body.transformToString('utf-8');
}

// ---------------------------------------------------------------------------
// Format content based on contentType (for readability in LLM context)
// ---------------------------------------------------------------------------

function formatContent(raw: string, contentType: string): string {
  if (contentType === 'json' || contentType === 'auto') {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Fetch all data sources for an agent, with caching
// ---------------------------------------------------------------------------

export async function fetchAgentDataSources(
  agentId: string
): Promise<Array<{
  id: string;
  name: string;
  description: string | null;
  content: string;
  contentType: string;
  tokenCount: number;
  maxTokenBudget: number;
  priority: number;
}>> {
  const sources = await db
    .select()
    .from(agentDataSources)
    .where(eq(agentDataSources.agentId, agentId))
    .orderBy(asc(agentDataSources.priority));

  const results = [];

  for (const source of sources) {
    let content = getCachedContent(source.id);
    let fetchOk = true;

    if (!content) {
      try {
        const raw = await fetchSourceContent(source);
        content = formatContent(raw, source.contentType);
        setCachedContent(source.id, content, source.cacheMinutes);

        // Update last fetch status in DB (fire and forget)
        db.update(agentDataSources)
          .set({ lastFetchedAt: new Date(), lastFetchStatus: 'ok', lastFetchError: null, updatedAt: new Date() })
          .where(eq(agentDataSources.id, source.id))
          .catch(() => {});
      } catch (err) {
        fetchOk = false;
        const errMsg = err instanceof Error ? err.message : 'Unknown fetch error';
        db.update(agentDataSources)
          .set({ lastFetchedAt: new Date(), lastFetchStatus: 'error', lastFetchError: errMsg, updatedAt: new Date() })
          .where(eq(agentDataSources.id, source.id))
          .catch(() => {});
        content = `[Data source "${source.name}" could not be loaded: ${errMsg}]`;
      }
    }

    const tokenCount = approxTokens(content);
    results.push({
      id: source.id,
      name: source.name,
      description: source.description,
      content,
      contentType: source.contentType,
      tokenCount,
      maxTokenBudget: source.maxTokenBudget,
      priority: source.priority,
      fetchOk,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Agent CRUD
// ---------------------------------------------------------------------------

function makeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const agentService = {
  async listAgents(organisationId: string, includeInactive = false) {
    const rows = await db
      .select()
      .from(agents)
      .where(and(
        eq(agents.organisationId, organisationId),
        isNull(agents.deletedAt),
        includeInactive ? undefined : eq(agents.status, 'active'),
      ));

    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      modelProvider: a.modelProvider,
      modelId: a.modelId,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  },

  async listAllAgents(organisationId: string) {
    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      modelProvider: a.modelProvider,
      modelId: a.modelId,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  },

  async getAgent(id: string, organisationId: string) {
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const sources = await db
      .select()
      .from(agentDataSources)
      .where(eq(agentDataSources.agentId, id))
      .orderBy(asc(agentDataSources.priority));

    return {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      masterPrompt: agent.masterPrompt,
      modelProvider: agent.modelProvider,
      modelId: agent.modelId,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      status: agent.status,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      dataSources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        sourceType: s.sourceType,
        sourcePath: s.sourcePath,
        contentType: s.contentType,
        priority: s.priority,
        maxTokenBudget: s.maxTokenBudget,
        cacheMinutes: s.cacheMinutes,
        lastFetchedAt: s.lastFetchedAt,
        lastFetchStatus: s.lastFetchStatus,
        lastFetchError: s.lastFetchError,
      })),
    };
  },

  async createAgent(
    organisationId: string,
    data: {
      name: string;
      description?: string;
      masterPrompt: string;
      modelProvider?: string;
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ) {
    const slug = makeSlug(data.name);
    const [agent] = await db
      .insert(agents)
      .values({
        organisationId,
        name: data.name,
        slug,
        description: data.description,
        masterPrompt: data.masterPrompt,
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { id: agent.id, name: agent.name, status: agent.status };
  },

  async updateAgent(
    id: string,
    organisationId: string,
    data: Partial<{
      name: string;
      description: string | null;
      masterPrompt: string;
      modelProvider: string;
      modelId: string;
      temperature: number;
      maxTokens: number;
    }>
  ) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Agent not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) { update.name = data.name; update.slug = makeSlug(data.name); }
    if (data.description !== undefined) update.description = data.description;
    if (data.masterPrompt !== undefined) update.masterPrompt = data.masterPrompt;
    if (data.modelProvider !== undefined) update.modelProvider = data.modelProvider;
    if (data.modelId !== undefined) update.modelId = data.modelId;
    if (data.temperature !== undefined) update.temperature = data.temperature;
    if (data.maxTokens !== undefined) update.maxTokens = data.maxTokens;

    const [updated] = await db
      .update(agents)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(agents.id, id))
      .returning();

    return { id: updated.id, name: updated.name, status: updated.status };
  },

  async activateAgent(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'Agent not found' };

    const [updated] = await db
      .update(agents)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();

    return { id: updated.id, status: updated.status };
  },

  async deactivateAgent(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'Agent not found' };

    const [updated] = await db
      .update(agents)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();

    return { id: updated.id, status: updated.status };
  },

  async deleteAgent(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    if (!existing) throw { statusCode: 404, message: 'Agent not found' };

    const now = new Date();
    await db.update(agents).set({ deletedAt: now, updatedAt: now }).where(eq(agents.id, id));
    return { message: 'Agent deleted successfully' };
  },

  // ── Data Source CRUD ───────────────────────────────────────────────────

  async uploadDataSourceFile(
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

    const s3 = getS3Client();
    await s3.send(new PutObjectCommand({
      Bucket: getBucketName(),
      Key: storagePath,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));

    return { storagePath, fileName: file.originalname, mimeType: file.mimetype, fileSizeBytes: file.size };
  },

  async addDataSource(
    agentId: string,
    organisationId: string,
    data: {
      name: string;
      description?: string;
      sourceType: 'r2' | 's3' | 'http_url' | 'google_docs' | 'file_upload';
      sourcePath: string;
      sourceHeaders?: Record<string, string>;
      contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      priority?: number;
      maxTokenBudget?: number;
      cacheMinutes?: number;
    }
  ) {
    // Verify agent belongs to org
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const [source] = await db
      .insert(agentDataSources)
      .values({
        agentId,
        name: data.name,
        description: data.description,
        sourceType: data.sourceType,
        sourcePath: data.sourcePath,
        sourceHeaders: data.sourceHeaders,
        contentType: data.contentType ?? 'auto',
        priority: data.priority ?? 0,
        maxTokenBudget: data.maxTokenBudget ?? 8000,
        cacheMinutes: data.cacheMinutes ?? 60,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return source;
  },

  async updateDataSource(
    sourceId: string,
    agentId: string,
    organisationId: string,
    data: Partial<{
      name: string;
      description: string | null;
      sourcePath: string;
      sourceHeaders: Record<string, string> | null;
      contentType: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      priority: number;
      maxTokenBudget: number;
      cacheMinutes: number;
    }>
  ) {
    // Verify agent belongs to org
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

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.sourcePath !== undefined) update.sourcePath = data.sourcePath;
    if (data.sourceHeaders !== undefined) update.sourceHeaders = data.sourceHeaders;
    if (data.contentType !== undefined) update.contentType = data.contentType;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.maxTokenBudget !== undefined) update.maxTokenBudget = data.maxTokenBudget;
    if (data.cacheMinutes !== undefined) update.cacheMinutes = data.cacheMinutes;

    // Invalidate cache on path change
    if (data.sourcePath !== undefined) {
      dataSourceCache.delete(sourceId);
    }

    const [updated] = await db
      .update(agentDataSources)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(agentDataSources.id, sourceId))
      .returning();

    return updated;
  },

  async deleteDataSource(sourceId: string, agentId: string, organisationId: string) {
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

    dataSourceCache.delete(sourceId);
    await db.delete(agentDataSources).where(eq(agentDataSources.id, sourceId));
    return { message: 'Data source removed' };
  },

  async testDataSource(sourceId: string, agentId: string, organisationId: string) {
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

    // Force re-fetch (invalidate cache)
    dataSourceCache.delete(sourceId);

    try {
      const raw = await fetchSourceContent(source);
      const content = formatContent(raw, source.contentType);
      const tokenCount = approxTokens(content);

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
  },

  fetchAgentDataSources,
};
