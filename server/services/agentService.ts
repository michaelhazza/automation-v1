import { eq, and, isNull, asc, max, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, agentDataSources, users, agentPromptRevisions } from '../db/schema/index.js';
import crypto from 'crypto';
import { auditService } from './auditService.js';
import { validateHierarchy, buildTree } from './hierarchyService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens, resolveTemperature, resolveMaxTokens } from './llmService.js';
import { emailService } from './emailService.js';
import { env } from '../lib/env.js';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------------------

interface CacheEntry {
  content: string;
  fetchedAt: number;
  expiresAt: number;
}

// Expiring hot cache — populated on fetch, expired per cacheMinutes
const dataSourceCache = new Map<string, CacheEntry>();

// Last-good-content fallback — never expires, overwritten only on successful fetch
// Served silently when a live fetch fails so end users are unaffected
const lastGoodContentCache = new Map<string, string>();

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
// Proactive sync scheduler
// ---------------------------------------------------------------------------

class DataSyncScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  schedule(sourceId: string, intervalMs: number): void {
    this.cancel(sourceId);
    const timer = setInterval(() => void runProactiveSync(sourceId), intervalMs);
    this.timers.set(sourceId, timer);
  }

  cancel(sourceId: string): void {
    const timer = this.timers.get(sourceId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(sourceId);
    }
  }

  activeCount(): number {
    return this.timers.size;
  }
}

export const dataSyncScheduler = new DataSyncScheduler();

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
      const decrypted = connectionTokenService.decryptToken(source.sourceHeaders);
      Object.assign(headers, JSON.parse(decrypted));
    }
    const response = await fetch(source.sourcePath, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.text();
  }

  if (source.sourceType === 'google_docs') {
    const docId = extractGoogleDocId(source.sourcePath);
    const parsedHeaders: Record<string, string> = source.sourceHeaders
      ? JSON.parse(connectionTokenService.decryptToken(source.sourceHeaders))
      : {};
    const apiKey = parsedHeaders['x-google-api-key'];
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

  if (source.sourceType === 'dropbox') {
    // Convert Dropbox share URL to a direct-download URL by ensuring dl=1
    let url = source.sourcePath;
    if (url.includes('dl=0')) {
      url = url.replace('dl=0', 'dl=1');
    } else if (!url.includes('dl=1')) {
      url = url.includes('?') ? `${url}&dl=1` : `${url}?dl=1`;
    }
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Failed to fetch Dropbox file (HTTP ${response.status}). Ensure the link is a public share URL.`);
    }
    return await response.text();
  }

  // S3 / R2 / file_upload — all read from object storage
  const s3 = getS3Client();
  const bucket = getBucketName();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: source.sourcePath });
  const result = await s3.send(cmd);
  const body = result.Body;
  if (!body) throw new Error('Empty response from storage');
  if (typeof (body as { transformToString?: unknown }).transformToString === 'function') {
    return await (body as { transformToString: (encoding?: string) => Promise<string> }).transformToString('utf-8');
  }
  throw new Error('Storage response body is not readable as text');
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
// Admin alert helpers (failure notification with 1-hour cooldown)
// ---------------------------------------------------------------------------

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

async function getOrgAdminEmails(organisationId: string): Promise<string[]> {
  const orgUsers = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.organisationId, organisationId), eq(users.status, 'active'), isNull(users.deletedAt)));
  return orgUsers.map((u) => u.email);
}

async function maybeSendDataSourceAlert(
  source: typeof agentDataSources.$inferSelect,
  errorMsg: string
): Promise<void> {
  const now = new Date();
  if (source.lastAlertSentAt && now.getTime() - source.lastAlertSentAt.getTime() < ALERT_COOLDOWN_MS) {
    return; // Still within cooldown — suppress
  }

  const [agent] = await db
    .select({ id: agents.id, name: agents.name, organisationId: agents.organisationId })
    .from(agents)
    .where(eq(agents.id, source.agentId));
  if (!agent) return;

  const emails = await getOrgAdminEmails(agent.organisationId);
  const agentEditUrl = `${env.APP_BASE_URL}/admin/agents/${agent.id}`;

  for (const email of emails) {
    await emailService.sendDataSourceSyncAlert(email, agent.name, source.name, errorMsg, agentEditUrl).catch((err) => console.error('[AgentService] Failed to send sync alert email:', err));
  }

  // Record alert time to enforce cooldown
  await db
    .update(agentDataSources)
    .set({ lastAlertSentAt: now, updatedAt: now })
    .where(eq(agentDataSources.id, source.id))
    .catch((err) => console.error('[AgentService] Failed to update alert timestamp:', err));
}

async function maybeSendDataSourceRecovery(
  source: typeof agentDataSources.$inferSelect,
  wasError: boolean
): Promise<void> {
  if (!wasError) return;

  const [agent] = await db
    .select({ id: agents.id, name: agents.name, organisationId: agents.organisationId })
    .from(agents)
    .where(eq(agents.id, source.agentId));
  if (!agent) return;

  const emails = await getOrgAdminEmails(agent.organisationId);
  const agentEditUrl = `${env.APP_BASE_URL}/admin/agents/${agent.id}`;

  for (const email of emails) {
    await emailService.sendDataSourceSyncRecovery(email, agent.name, source.name, agentEditUrl).catch((err) => console.error('[AgentService] Failed to send recovery email:', err));
  }
}

// ---------------------------------------------------------------------------
// Proactive sync — runs on the scheduler interval
// ---------------------------------------------------------------------------

async function runProactiveSync(sourceId: string): Promise<void> {
  const [source] = await db
    .select()
    .from(agentDataSources)
    .where(eq(agentDataSources.id, sourceId));

  // Source deleted or switched back to lazy — self-cancel
  if (!source || source.syncMode !== 'proactive') {
    dataSyncScheduler.cancel(sourceId);
    return;
  }

  const wasError = source.lastFetchStatus === 'error';

  try {
    const raw = await fetchSourceContent(source);
    const content = formatContent(raw, source.contentType);

    // Update both caches
    lastGoodContentCache.set(sourceId, content);
    setCachedContent(sourceId, content, source.cacheMinutes);

    await db
      .update(agentDataSources)
      .set({ lastFetchedAt: new Date(), lastFetchStatus: 'ok', lastFetchError: null, updatedAt: new Date() })
      .where(eq(agentDataSources.id, sourceId))
      .catch((err) => console.error('[AgentService] Failed to update data source status (ok):', err));

    // Recovery email if this was previously in error
    await maybeSendDataSourceRecovery(source, wasError);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown sync error';

    await db
      .update(agentDataSources)
      .set({ lastFetchedAt: new Date(), lastFetchStatus: 'error', lastFetchError: errMsg, updatedAt: new Date() })
      .where(eq(agentDataSources.id, sourceId))
      .catch((err2) => console.error('[AgentService] Failed to update data source status (error):', err2));

    // Re-warm hot cache with last good content so lazy fetches still serve stale data
    const fallback = lastGoodContentCache.get(sourceId);
    if (fallback) {
      setCachedContent(sourceId, fallback, source.cacheMinutes);
    }

    // Alert admins (rate-limited by ALERT_COOLDOWN_MS)
    // Re-fetch source to get current lastAlertSentAt before deciding
    const [fresh] = await db.select().from(agentDataSources).where(eq(agentDataSources.id, sourceId)).catch((err2) => { console.error('[AgentService] Failed to re-fetch data source for alert:', err2); return [undefined]; });
    if (fresh) await maybeSendDataSourceAlert(fresh, errMsg);
  }
}

// ---------------------------------------------------------------------------
// Fetch all data sources for an agent (used by LLM context builder)
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
  fetchOk: boolean;
}>> {
  const sources = await db
    .select()
    .from(agentDataSources)
    .where(eq(agentDataSources.agentId, agentId))
    .orderBy(asc(agentDataSources.priority));

  const results = [];

  for (const source of sources) {
    // file_upload is always read from storage — no expiry logic needed
    const isStatic = source.sourceType === 'file_upload';

    let content = isStatic ? null : getCachedContent(source.id);
    let fetchOk = true;

    if (!content) {
      try {
        const raw = await fetchSourceContent(source);
        content = formatContent(raw, source.contentType);

        // Update both caches for live sources
        if (!isStatic) {
          lastGoodContentCache.set(source.id, content);
          setCachedContent(source.id, content, source.cacheMinutes);
        }

        db.update(agentDataSources)
          .set({ lastFetchedAt: new Date(), lastFetchStatus: 'ok', lastFetchError: null, updatedAt: new Date() })
          .where(eq(agentDataSources.id, source.id))
          .catch((err) => console.error('[AgentService] Failed to update data source fetch status (ok):', err));
      } catch (err) {
        fetchOk = false;
        const errMsg = err instanceof Error ? err.message : 'Unknown fetch error';

        db.update(agentDataSources)
          .set({ lastFetchedAt: new Date(), lastFetchStatus: 'error', lastFetchError: errMsg, updatedAt: new Date() })
          .where(eq(agentDataSources.id, source.id))
          .catch((err2) => console.error('[AgentService] Failed to update data source fetch status (error):', err2));

        // Use last good content as silent fallback (end users see no disruption)
        const fallback = lastGoodContentCache.get(source.id);
        if (fallback) {
          content = fallback;
        } else {
          content = `[Data source "${source.name}" could not be loaded: ${errMsg}]`;
        }

        // Alert admins for lazy sources that fail (proactive sources alert via runProactiveSync)
        if (source.syncMode === 'lazy') {
          db.select().from(agentDataSources).where(eq(agentDataSources.id, source.id))
            .then(([fresh]) => { if (fresh) return maybeSendDataSourceAlert(fresh, errMsg); })
            .catch((err2) => console.error('[AgentService] Failed to fetch data source for lazy alert:', err2));
        }
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
      systemAgentId: a.systemAgentId,
      isSystemManaged: a.isSystemManaged,
      heartbeatEnabled: a.heartbeatEnabled,
      heartbeatIntervalHours: a.heartbeatIntervalHours,
      heartbeatOffsetHours: a.heartbeatOffsetHours,
      parentAgentId: a.parentAgentId,
      agentRole: a.agentRole,
      agentTitle: a.agentTitle,
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
      systemAgentId: a.systemAgentId,
      isSystemManaged: a.isSystemManaged,
      heartbeatEnabled: a.heartbeatEnabled,
      heartbeatIntervalHours: a.heartbeatIntervalHours,
      heartbeatOffsetHours: a.heartbeatOffsetHours,
      parentAgentId: a.parentAgentId,
      agentRole: a.agentRole,
      agentTitle: a.agentTitle,
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
      additionalPrompt: agent.additionalPrompt,
      modelProvider: agent.modelProvider,
      modelId: agent.modelId,
      // Effective values derived from presets (used by execution services)
      temperature: resolveTemperature(agent.responseMode, agent.temperature),
      maxTokens: resolveMaxTokens(agent.outputSize, agent.maxTokens),
      // Preset fields (used by the UI)
      responseMode: agent.responseMode,
      outputSize: agent.outputSize,
      allowModelOverride: agent.allowModelOverride,
      status: agent.status,
      systemAgentId: agent.systemAgentId,
      isSystemManaged: agent.isSystemManaged,
      heartbeatEnabled: agent.heartbeatEnabled,
      heartbeatIntervalHours: agent.heartbeatIntervalHours,
      heartbeatOffsetHours: agent.heartbeatOffsetHours,
      parentAgentId: agent.parentAgentId,
      agentRole: agent.agentRole,
      agentTitle: agent.agentTitle,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      dataSources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        sourceType: s.sourceType,
        sourcePath: s.sourcePath,
        contentType: s.contentType,
        syncMode: s.syncMode,
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
      responseMode?: string;
      outputSize?: string;
      allowModelOverride?: boolean;
      defaultSkillSlugs?: string[];
      icon?: string;
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
        icon: data.icon ?? null,
        masterPrompt: data.masterPrompt,
        modelProvider: data.modelProvider ?? 'anthropic',
        modelId: data.modelId ?? 'claude-sonnet-4-6',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 4096,
        responseMode: (data.responseMode as 'balanced' | 'precise' | 'expressive' | 'highly_creative') ?? 'balanced',
        outputSize: (data.outputSize as 'standard' | 'extended' | 'maximum') ?? 'standard',
        allowModelOverride: data.allowModelOverride ?? true,
        defaultSkillSlugs: data.defaultSkillSlugs ?? null,
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
      additionalPrompt: string;
      modelProvider: string;
      modelId: string;
      temperature: number;
      maxTokens: number;
      responseMode: string;
      outputSize: string;
      allowModelOverride: boolean;
      defaultSkillSlugs: string[];
      icon: string;
      agentRole: string | null;
      agentTitle: string | null;
      parentAgentId: string | null;
      heartbeatEnabled: boolean;
      heartbeatIntervalHours: number | null;
      heartbeatOffsetHours: number;
      concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
      catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
      catchUpCap: number;
      maxConcurrentRuns: number;
    }>
  ) {
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Agent not found' };

    // System-managed agents: block editing the masterPrompt (that's the system layer)
    if (existing.isSystemManaged && data.masterPrompt !== undefined) {
      throw { statusCode: 400, message: 'Cannot edit master prompt on system-managed agents. Use additionalPrompt instead.' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) { update.name = data.name; update.slug = makeSlug(data.name); }
    if (data.description !== undefined) update.description = data.description;
    if (!existing.isSystemManaged && data.masterPrompt !== undefined) update.masterPrompt = data.masterPrompt;
    if (data.additionalPrompt !== undefined) update.additionalPrompt = data.additionalPrompt;
    if (data.modelProvider !== undefined) update.modelProvider = data.modelProvider;
    if (data.modelId !== undefined) update.modelId = data.modelId;
    if (data.temperature !== undefined) update.temperature = data.temperature;
    if (data.maxTokens !== undefined) update.maxTokens = data.maxTokens;
    if (data.responseMode !== undefined) update.responseMode = data.responseMode;
    if (data.outputSize !== undefined) update.outputSize = data.outputSize;
    if (data.allowModelOverride !== undefined) update.allowModelOverride = data.allowModelOverride;
    if (data.defaultSkillSlugs !== undefined) update.defaultSkillSlugs = data.defaultSkillSlugs;
    if (data.icon !== undefined) update.icon = data.icon;
    if (data.heartbeatEnabled !== undefined) update.heartbeatEnabled = data.heartbeatEnabled;
    if (data.heartbeatIntervalHours !== undefined) update.heartbeatIntervalHours = data.heartbeatIntervalHours;
    if (data.heartbeatOffsetHours !== undefined) update.heartbeatOffsetHours = data.heartbeatOffsetHours;
    if (data.concurrencyPolicy !== undefined) update.concurrencyPolicy = data.concurrencyPolicy;
    if (data.catchUpPolicy !== undefined) update.catchUpPolicy = data.catchUpPolicy;
    if (data.catchUpCap !== undefined) update.catchUpCap = data.catchUpCap;
    if (data.maxConcurrentRuns !== undefined) update.maxConcurrentRuns = data.maxConcurrentRuns;
    if (data.agentRole !== undefined) update.agentRole = data.agentRole;
    if (data.agentTitle !== undefined) update.agentTitle = data.agentTitle;

    // Handle parentAgentId with hierarchy validation
    if ('parentAgentId' in data) {
      const parentId = (data as { parentAgentId?: string | null }).parentAgentId;
      if (parentId) {
        const validation = await validateHierarchy('agents', id, parentId);
        if (!validation.valid) throw { statusCode: 400, message: validation.error };
      }
      update.parentAgentId = parentId ?? null;
    }

    // ── Prompt revision tracking ────────────────────────────────────────
    const promptChanged =
      (data.masterPrompt !== undefined && data.masterPrompt !== existing.masterPrompt) ||
      (data.additionalPrompt !== undefined && data.additionalPrompt !== existing.additionalPrompt);

    if (promptChanged) {
      const newMasterPrompt = data.masterPrompt !== undefined ? data.masterPrompt : existing.masterPrompt;
      const newAdditionalPrompt = data.additionalPrompt !== undefined ? data.additionalPrompt : existing.additionalPrompt;
      const hash = crypto.createHash('sha256').update(newMasterPrompt + '\0' + newAdditionalPrompt).digest('hex');

      // Check if hash matches latest revision — skip if identical (dedup)
      const [latestRevision] = await db
        .select({ promptHash: agentPromptRevisions.promptHash })
        .from(agentPromptRevisions)
        .where(eq(agentPromptRevisions.agentId, id))
        .orderBy(desc(agentPromptRevisions.revisionNumber))
        .limit(1);

      if (!latestRevision || latestRevision.promptHash !== hash) {
        const [maxRow] = await db
          .select({ maxNum: max(agentPromptRevisions.revisionNumber) })
          .from(agentPromptRevisions)
          .where(eq(agentPromptRevisions.agentId, id));

        const nextRevisionNumber = (maxRow?.maxNum ?? 0) + 1;

        // Auto-generate change description
        const changes: string[] = [];
        if (data.masterPrompt !== undefined && data.masterPrompt !== existing.masterPrompt) {
          const diff = (data.masterPrompt?.length ?? 0) - (existing.masterPrompt?.length ?? 0);
          changes.push(`masterPrompt changed (${diff >= 0 ? '+' : ''}${diff} chars)`);
        }
        if (data.additionalPrompt !== undefined && data.additionalPrompt !== existing.additionalPrompt) {
          const diff = (data.additionalPrompt?.length ?? 0) - (existing.additionalPrompt?.length ?? 0);
          changes.push(`additionalPrompt changed (${diff >= 0 ? '+' : ''}${diff} chars)`);
        }

        await db.insert(agentPromptRevisions).values({
          agentId: id,
          organisationId,
          revisionNumber: nextRevisionNumber,
          masterPrompt: newMasterPrompt,
          additionalPrompt: newAdditionalPrompt,
          promptHash: hash,
          changeDescription: changes.join('; '),
        });

        // Emit audit event for prompt change
        await auditService.log({
          organisationId,
          actorType: 'user',
          action: 'agent.prompt.updated',
          entityType: 'agent',
          entityId: id,
          metadata: { revisionNumber: nextRevisionNumber, changeDescription: changes.join('; ') },
        });
      }
    }

    const [updated] = await db
      .update(agents)
      .set(update)
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

    // Draft agents require a masterPrompt before activation
    // System-managed agents inherit their prompt at runtime, so they are exempt
    if (!existing.isSystemManaged && !existing.masterPrompt?.trim()) {
      throw { statusCode: 400, message: 'Cannot activate agent: masterPrompt is required. Add a prompt before activating.' };
    }

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
    await db.update(agents).set({ deletedAt: now, updatedAt: now }).where(and(eq(agents.id, id), eq(agents.organisationId, organisationId)));
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
      sourceType: 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload';
      sourcePath: string;
      sourceHeaders?: Record<string, string>;
      contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      syncMode?: 'lazy' | 'proactive';
      priority?: number;
      maxTokenBudget?: number;
      cacheMinutes?: number;
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
        sourcePath: data.sourcePath,
        sourceHeaders: data.sourceHeaders ? connectionTokenService.encryptToken(JSON.stringify(data.sourceHeaders)) : undefined,
        contentType: data.contentType ?? 'auto',
        syncMode,
        priority: data.priority ?? 0,
        maxTokenBudget: data.maxTokenBudget ?? 8000,
        cacheMinutes: data.cacheMinutes ?? 60,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    if (source.syncMode === 'proactive') {
      dataSyncScheduler.schedule(source.id, source.cacheMinutes * 60 * 1000);
    }

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

    dataSyncScheduler.cancel(sourceId);
    dataSourceCache.delete(sourceId);
    lastGoodContentCache.delete(sourceId);
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
  },

  // ── Startup: schedule all proactive sources ────────────────────────────

  async scheduleAllProactiveSources(): Promise<void> {
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
  },

  /**
   * Return org agents as a nested tree structure.
   */
  async getTree(organisationId: string) {
    const allAgents = await db
      .select()
      .from(agents)
      .where(and(eq(agents.organisationId, organisationId), isNull(agents.deletedAt)))
      .orderBy(agents.name);

    return buildTree(
      allAgents.map(a => ({ ...a, sortOrder: 0 })),
      (a) => a.parentAgentId
    );
  },

  fetchAgentDataSources,
};
