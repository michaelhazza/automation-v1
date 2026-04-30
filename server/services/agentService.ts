import { eq, and, or, isNull, asc, max, desc } from 'drizzle-orm';
import * as fs from 'node:fs';
import { db } from '../db/index.js';
import { agents, agentDataSources, users, agentPromptRevisions, scheduledTasks } from '../db/schema/index.js';
import crypto from 'crypto';
import { auditService } from './auditService.js';
import { configHistoryService } from './configHistoryService.js';
import { validateHierarchy, buildTree } from './hierarchyService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens, resolveTemperature, resolveMaxTokens } from './llmService.js';
import { emailService } from './emailService.js';
import { env } from '../lib/env.js';
import { assertScopeSingle } from '../lib/scopeAssertion.js';
import { v4 as uuidv4 } from 'uuid';
import { softDeleteByTarget } from './agentTestFixturesService.js';

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
    // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to resolve agent name and org for alert email; agentId sourced from agentDataSources row which is already org-scoped"
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
    // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to resolve agent name and org for recovery email; agentId sourced from agentDataSources row which is already org-scoped"
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

/**
 * Pure extraction of the content-loading branch from the original
 * fetchAgentDataSources loop. Shared by fetchDataSourcesByScope and by
 * the read_data_source skill handler so they use the same fetching /
 * caching / error-handling path. No logic change from the original.
 */
export async function loadSourceContent(
  source: typeof agentDataSources.$inferSelect
): Promise<{ content: string; fetchOk: boolean; tokenCount: number }> {
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
  return { content, fetchOk, tokenCount };
}

/**
 * Scope descriptor for loading data sources. See spec §6.1.
 *
 * At least `agentId` must be set. Optionally narrows by subaccountAgentId
 * (for subaccount-specific sources) or scheduledTaskId (for scheduled-task-
 * specific sources). These two are orthogonal — a run either came from a
 * subaccount-agent link, or from a scheduled task, but not both sources of
 * scoping at the same row level.
 */
export interface DataSourceScope {
  agentId: string;
  subaccountAgentId?: string | null;
  scheduledTaskId?: string | null;
}

/**
 * LoadedDataSource — the raw shape returned by fetchDataSourcesByScope and
 * loadTaskAttachmentsAsContext. The "decision" fields (orderIndex,
 * includedInPrompt, etc.) are populated later by loadRunContextData — see
 * spec §6.1 for the full pre/post-loader invariant.
 */
export interface LoadedDataSource {
  id: string;
  scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
  name: string;
  description: string | null;
  content: string;
  contentType: string;
  tokenCount: number;
  sizeBytes: number;
  loadingMode: 'eager' | 'lazy';
  priority: number;
  fetchOk: boolean;
  maxTokenBudget: number;

  // Decision fields — populated by loadRunContextData after sorting,
  // override suppression, and the budget walk. Optional at the type level
  // because fetchDataSourcesByScope and loadTaskAttachmentsAsContext return
  // values with none of them set. See spec §6.1.
  orderIndex?: number;
  includedInPrompt?: boolean;
  truncated?: boolean;
  suppressedByOverride?: boolean;
  suppressedBy?: string;
}

/**
 * Load data sources across the three agent_data_sources scopes:
 *   - agent-wide (agentId matches, no subaccount/scheduled-task scope)
 *   - subaccount-scoped (agentId + subaccountAgentId match)
 *   - scheduled-task-scoped (scheduledTaskId matches — agentId is
 *     denormalised on the row but the scope key is the scheduled task)
 *
 * A single DB round-trip uses OR conditions so hitting all three scopes
 * costs one query. Results are returned in stable priority order; the
 * caller (loadRunContextData) handles scope-precedence sorting and
 * same-name override resolution.
 */
export async function fetchDataSourcesByScope(
  scope: DataSourceScope
): Promise<LoadedDataSource[]> {
  const conditions = [
    // 1. Agent-wide: agentId matches, no subaccount or scheduled task scope
    and(
      eq(agentDataSources.agentId, scope.agentId),
      isNull(agentDataSources.subaccountAgentId),
      isNull(agentDataSources.scheduledTaskId),
    ),
  ];

  if (scope.subaccountAgentId) {
    conditions.push(
      and(
        eq(agentDataSources.agentId, scope.agentId),
        eq(agentDataSources.subaccountAgentId, scope.subaccountAgentId),
      )
    );
  }

  if (scope.scheduledTaskId) {
    conditions.push(
      eq(agentDataSources.scheduledTaskId, scope.scheduledTaskId),
    );
  }

  const rows = await db
    .select()
    .from(agentDataSources)
    .where(or(...conditions))
    .orderBy(asc(agentDataSources.priority));

  const results: LoadedDataSource[] = [];
  for (const source of rows) {
    const resolvedScope: LoadedDataSource['scope'] =
      source.scheduledTaskId ? 'scheduled_task'
      : source.subaccountAgentId ? 'subaccount'
      : 'agent';

    // Lazy sources: emit manifest entry only; do NOT fetch content upfront.
    // The read_data_source skill will call loadSourceContent on demand.
    //
    // Estimate sizeBytes from maxTokenBudget so the manifest's "~XKB" hint
    // gives the agent a useful "should I bother reading this?" signal.
    // The estimate uses ~4 chars/token (matching approxTokens) — it's a
    // ceiling for the source, not the actual file size, but for the agent's
    // decision-making "is this big enough to consume meaningful context?"
    // it's the right heuristic. (pr-reviewer Major 2.)
    if (source.loadingMode === 'lazy') {
      const estimatedSize = source.maxTokenBudget * 4;
      results.push({
        id: source.id,
        scope: resolvedScope,
        name: source.name,
        description: source.description,
        content: '',
        contentType: source.contentType,
        tokenCount: 0,
        sizeBytes: estimatedSize,
        loadingMode: 'lazy',
        priority: source.priority,
        fetchOk: true,
        maxTokenBudget: source.maxTokenBudget,
      });
      continue;
    }

    // Eager: fetch content now via the shared helper.
    const { content, fetchOk, tokenCount } = await loadSourceContent(source);
    results.push({
      id: source.id,
      scope: resolvedScope,
      name: source.name,
      description: source.description,
      content,
      contentType: source.contentType,
      tokenCount,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      loadingMode: 'eager',
      priority: source.priority,
      fetchOk,
      maxTokenBudget: source.maxTokenBudget,
    });
  }

  return results;
}

/**
 * Backwards-compatible wrapper for the legacy fetchAgentDataSources signature.
 * Kept for conversationService.ts:179 (agent-chat surface) which needs agent-
 * level sources only, no scheduled-task or subaccount scoping.
 *
 * The return shape is a subset of LoadedDataSource that matches what the
 * existing buildSystemPrompt consumer at llmService.ts:283 expects.
 */
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
  const loaded = await fetchDataSourcesByScope({ agentId });
  // Keep only eager sources for backwards compatibility — the old function
  // always returned fully-loaded content. Lazy sources in the agent-chat
  // surface would need a different UX, which is not part of this change.
  return loaded
    .filter((s) => s.loadingMode === 'eager')
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      content: s.content,
      contentType: s.contentType,
      tokenCount: s.tokenCount,
      maxTokenBudget: s.maxTokenBudget,
      priority: s.priority,
      fetchOk: s.fetchOk,
    }));
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
    const [rawAgent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));

    // P1.1 Layer 2 scope assertion — agent.additionalPrompt is merged
    // into the LLM system prompt window, so this is a retrieval boundary
    // that must be guarded belt-and-suspenders even though the query
    // already filters by organisationId.
    const agent = assertScopeSingle(
      rawAgent ?? null,
      { organisationId },
      'agentService.getAgent',
    );

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
      defaultSkillSlugs: (agent.defaultSkillSlugs ?? []) as string[],
      icon: agent.icon ?? '',
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

    await configHistoryService.recordHistory({
      entityType: 'agent',
      entityId: agent.id,
      organisationId,
      snapshot: agent as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
      sessionId: null,
      changeSummary: null,
    });

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

    await configHistoryService.recordHistory({
      entityType: 'agent',
      entityId: id,
      organisationId,
      snapshot: existing as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
      sessionId: null,
      changeSummary: null,
    });

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
      // guard-ignore-next-line: org-scoped-writes reason="existing agent was fetched above with and(eq(agents.id, id), eq(agents.organisationId, organisationId)) — org membership already verified"
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

    await configHistoryService.recordHistory({
      entityType: 'agent',
      entityId: id,
      organisationId,
      snapshot: existing as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
      sessionId: null,
      changeSummary: null,
    });

    const [updated] = await db
      .update(agents)
      .set({ status: 'active', updatedAt: new Date() })
      // guard-ignore-next-line: org-scoped-writes reason="existing agent was fetched above with and(eq(agents.id, id), eq(agents.organisationId, organisationId)) — org membership already verified"
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

    await configHistoryService.recordHistory({
      entityType: 'agent',
      entityId: id,
      organisationId,
      snapshot: existing as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
      sessionId: null,
      changeSummary: null,
    });

    const [updated] = await db
      .update(agents)
      .set({ status: 'inactive', updatedAt: new Date() })
      // guard-ignore-next-line: org-scoped-writes reason="existing agent was fetched above with and(eq(agents.id, id), eq(agents.organisationId, organisationId)) — org membership already verified"
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
    // Feature 2 §9 orphan cleanup: soft-delete test fixtures for this agent
    // (best-effort — not in the same DB transaction as the agent soft-delete above).
    await softDeleteByTarget(organisationId, 'agent', id);
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
  },

  async addDataSource(
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
      loadingMode?: 'eager' | 'lazy';
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
        loadingMode: data.loadingMode ?? 'eager',
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
      loadingMode: 'eager' | 'lazy';
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
    if (data.loadingMode !== undefined) update.loadingMode = data.loadingMode;
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
  fetchDataSourcesByScope,
  loadSourceContent,

  // ─── Scheduled task data sources (spec §6.4) ──────────────────────────────
  //
  // These methods mirror the agent-level CRUD but scope attachments to a
  // specific scheduled task. They all verify that the scheduled task belongs
  // to `organisationId` before any read or write to guard against cross-org
  // tampering via guessed ids.

  /**
   * Helper: load a scheduled task and verify org ownership.
   * Throws 404 if the task does not exist or belongs to a different org.
   */
  async _getScheduledTaskOrThrow(scheduledTaskId: string, organisationId: string) {
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
  },

  async listScheduledTaskDataSources(scheduledTaskId: string, organisationId: string) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);
    return db
      .select()
      .from(agentDataSources)
      .where(eq(agentDataSources.scheduledTaskId, scheduledTaskId))
      .orderBy(asc(agentDataSources.priority));
  },

  async addScheduledTaskDataSource(
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
      loadingMode?: 'eager' | 'lazy';
      priority?: number;
      maxTokenBudget?: number;
      cacheMinutes?: number;
      connectionId?: string;
    },
    actorUserId?: string
  ) {
    const st = await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

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
        loadingMode: data.loadingMode ?? 'eager',
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
        loadingMode: source.loadingMode,
      },
    });

    return source;
  },

  async updateScheduledTaskDataSource(
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
      loadingMode: 'eager' | 'lazy';
      priority: number;
      maxTokenBudget: number;
      cacheMinutes: number;
    }>,
    actorUserId?: string
  ) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

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
    if (data.loadingMode !== undefined) update.loadingMode = data.loadingMode;
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
  },

  async deleteScheduledTaskDataSource(
    sourceId: string,
    scheduledTaskId: string,
    organisationId: string,
    actorUserId?: string
  ) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

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
  },

  async testScheduledTaskDataSource(
    sourceId: string,
    scheduledTaskId: string,
    organisationId: string
  ) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

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
  },

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
   * loadingMode / priority) so the row matches what the operator
   * intended in the upload form.
   */
  async uploadScheduledTaskDataSourceFile(
    scheduledTaskId: string,
    organisationId: string,
    file: Express.Multer.File,
    metadata: {
      name: string;
      description?: string;
      contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      loadingMode?: 'eager' | 'lazy';
      priority?: number;
      maxTokenBudget?: number;
    },
    actorUserId?: string
  ) {
    const st = await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

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
          loadingMode: metadata.loadingMode ?? 'eager',
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
          loadingMode: source.loadingMode,
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
  },

  // Note: previewScheduledTaskReassignment was removed in the pr-reviewer
  // hardening pass. The cascade itself in scheduledTaskService.update is
  // implemented and transactional, but the UI flow that would have called
  // this preview endpoint was deferred — there's no agent picker in the
  // ScheduledTaskDetailPage edit form yet. When the agent reassignment UI
  // lands, restore this method (it was a pure read with no side effects)
  // and re-add the GET /reassignment-preview route in scheduledTasks.ts.
};
