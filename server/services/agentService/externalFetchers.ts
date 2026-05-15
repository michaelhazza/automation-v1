import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agents, agentDataSources, users } from '../../db/schema/index.js';
import { connectionTokenService } from '../connectionTokenService.js';
import { getS3Client, getBucketName } from '../../lib/storage.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens } from '../llmService.js';
import { emailService } from '../emailService.js';
import { env } from '../../lib/env.js';
import type { GoogleDocsContent } from './types.js';
import { lastGoodContentCache, getCachedContent, setCachedContent } from './caches.js';
import { dataSyncScheduler } from './scheduler.js';

// ---------------------------------------------------------------------------
// Google Docs helpers
// ---------------------------------------------------------------------------

function extractGoogleDocId(urlOrId: string): string {
  const match = urlOrId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
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

/**
 * Thrown by fetchSourceContent when a source has sourceType === 'google_drive'.
 * These sources are handled exclusively by the external document resolver
 * pipeline in loadRunContextData and must not flow through the regular
 * fetch / cache / error-status path.
 */
class ExternalDocSourceError extends Error {
  constructor(sourceName: string) {
    super(`google_drive source "${sourceName}" is handled by the external document resolver pipeline`);
    this.name = 'ExternalDocSourceError';
  }
}

export async function fetchSourceContent(source: typeof agentDataSources.$inferSelect): Promise<string> {
  if (source.sourceType === 'google_drive') {
    // google_drive sources are resolved through externalDocumentResolverService
    // in loadRunContextData and are filtered from the regular pool.
    // Returning empty here prevents false lastFetchStatus='error' DB writes
    // for sources that will be handled separately.
    throw new ExternalDocSourceError(source.name);
  }

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

export function formatContent(raw: string, contentType: string): string {
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

dataSyncScheduler.setSyncFn(runProactiveSync);

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
      if (err instanceof ExternalDocSourceError) {
        // This source is handled by the external doc resolver pipeline.
        // Return empty without marking the source as failed or sending admin alerts.
        return { content: '', fetchOk: false, tokenCount: 0 };
      }

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
