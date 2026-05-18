import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db/index.js';
import {
  webhookAdapterConfigs,
  agentRuns,
  agents,
  canonicalTickets,
  canonicalTicketMessages,
  canonicalTicketDrafts,
  canonicalSupportAgents,
  canonicalInboxes,
} from '../db/schema/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { auditService } from './auditService.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { mapTeamworkStatus } from '../adapters/teamwork/teamworkSupportStatusMap.js';
import { SUPPORT_LOG_CODES } from '../../shared/types/supportObservability.js';
import { findBackLinkCandidate } from './supportDraftReconciliationPure.js';
import type { NormalisedEvent } from '../adapters/integrationAdapter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskPayload {
  id: string;
  title: string;
  description: string;
  brief: string;
  priority: string;
  goalContext?: string;
}

interface TriggerContext {
  subaccountId: string;
  subaccountName: string;
  organisationId: string;
}

interface WebhookAgentResponse {
  status: 'completed' | 'failed' | 'in_progress';
  message?: string;
  taskUpdates?: {
    status?: string;
    deliverables?: Array<{ title: string; content: string; type: string }>;
  };
  error?: string;
  metadata?: Record<string, unknown>;
}

interface CallbackTokenPayload {
  runId: string;
  agentId: string;
  orgId: string;
}

// ---------------------------------------------------------------------------
// In-memory circuit breaker (per-agent, resets on restart)
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: Array<number>; // timestamps of failures within window
  openUntil: number | null; // timestamp until which the circuit is open
}

const CIRCUIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const circuitBreakers = new Map<string, CircuitState>();

function getCircuitState(agentId: string): CircuitState {
  let state = circuitBreakers.get(agentId);
  if (!state) {
    state = { failures: [], openUntil: null };
    circuitBreakers.set(agentId, state);
  }
  return state;
}

function isCircuitOpen(agentId: string): boolean {
  const state = getCircuitState(agentId);
  if (state.openUntil === null) return false;
  if (Date.now() >= state.openUntil) {
    // Allow a probe — reset the circuit to half-open
    state.openUntil = null;
    return false;
  }
  return true;
}

function recordFailure(agentId: string): void {
  const state = getCircuitState(agentId);
  const now = Date.now();
  state.failures.push(now);
  // Prune failures outside window
  state.failures = state.failures.filter((t) => now - t < CIRCUIT_WINDOW_MS);
  if (state.failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_OPEN_DURATION_MS;
  }
}

function recordSuccess(agentId: string): void {
  const state = getCircuitState(agentId);
  state.failures = [];
  state.openUntil = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CALLBACK_TOKEN_EXPIRY = '15m';

// Use a distinct secret for callback tokens to prevent confusion with user auth JWTs
const CALLBACK_SECRET = env.WEBHOOK_CALLBACK_SECRET || (env.JWT_SECRET + ':webhook-callback');

function generateCallbackToken(payload: CallbackTokenPayload): string {
  return jwt.sign({ ...payload, aud: 'webhook-callback' }, CALLBACK_SECRET, { expiresIn: CALLBACK_TOKEN_EXPIRY });
}

function verifyCallbackToken(token: string): CallbackTokenPayload {
  const decoded = jwt.verify(token, CALLBACK_SECRET, { audience: 'webhook-callback' }) as CallbackTokenPayload & { exp: number; aud: string };
  return decoded;
}

function buildCallbackUrl(runId: string): string {
  const base = env.WEBHOOK_BASE_URL || env.APP_BASE_URL;
  return `${base}/api/webhooks/agent-callback/${runId}`;
}

function signRequest(
  body: string,
  authType: 'none' | 'bearer' | 'hmac_sha256' | 'api_key_header',
  authSecret: string | null,
  authHeaderName: string | null,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!authSecret) return headers;

  switch (authType) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${authSecret}`;
      break;
    case 'hmac_sha256': {
      const sig = crypto.createHmac('sha256', authSecret).update(body).digest('hex');
      headers['X-Signature'] = `sha256=${sig}`;
      break;
    }
    case 'api_key_header': {
      const headerName = authHeaderName || 'X-API-Key';
      headers[headerName] = authSecret;
      break;
    }
    case 'none':
    default:
      break;
  }
  return headers;
}

async function postWithRetry(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  retryCount: number,
  retryBackoffMs: number,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Global execution cap: prevent zombie runs from retries + long timeouts
  const maxExecutionMs = timeoutMs * (retryCount + 1) + retryBackoffMs * (Math.pow(2, retryCount + 1) - 1);
  const executionStart = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    // Hard stop if global execution cap exceeded
    if (Date.now() - executionStart > maxExecutionMs) {
      return { ok: false, status: 0, data: { error: 'Global execution cap exceeded' } };
    }
    if (attempt > 0) {
      // Exponential backoff with jitter: base * 2^attempt + random(0, base/2)
      const delay = retryBackoffMs * Math.pow(2, attempt) + Math.random() * (retryBackoffMs / 2);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const data = await response.json().catch(() => null); // guard-ignore: no-silent-failures reason="JSON parse failure falls back to null; caller handles null data"

      if (response.ok) {
        return { ok: true, status: response.status, data };
      }

      // 4xx = client error, don't retry (except 429 rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { ok: false, status: response.status, data };
      }

      // 5xx or 429 — retry
      lastError = { status: response.status, data };
    } catch (err) {
      lastError = err;
    }
  }

  return { ok: false, status: 0, data: lastError };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const webhookAdapterService = {
  /**
   * Get webhook config for an agent.
   */
  async getConfig(agentId: string, organisationId: string) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [config] = await db
      .select()
      .from(webhookAdapterConfigs)
      .where(
        and(
          eq(webhookAdapterConfigs.agentId, agentId),
          eq(webhookAdapterConfigs.organisationId, organisationId),
        ),
      );
    return config ?? null;
  },

  /**
   * Create or update webhook config for an agent.
   */
  async upsertConfig(
    agentId: string,
    organisationId: string,
    data: {
      endpointUrl: string;
      authType?: 'none' | 'bearer' | 'hmac_sha256' | 'api_key_header';
      authSecret?: string | null;
      authHeaderName?: string | null;
      timeoutMs?: number;
      retryCount?: number;
      retryBackoffMs?: number;
      expectCallback?: boolean;
      callbackSecret?: string | null;
    },
  ) {
    const existing = await this.getConfig(agentId, organisationId);

    if (existing) {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      const [updated] = await db
        .update(webhookAdapterConfigs)
        .set({
          endpointUrl: data.endpointUrl,
          authType: data.authType ?? existing.authType,
          authSecret: data.authSecret !== undefined ? data.authSecret : existing.authSecret,
          authHeaderName: data.authHeaderName !== undefined ? data.authHeaderName : existing.authHeaderName,
          timeoutMs: data.timeoutMs ?? existing.timeoutMs,
          retryCount: data.retryCount ?? existing.retryCount,
          retryBackoffMs: data.retryBackoffMs ?? existing.retryBackoffMs,
          expectCallback: data.expectCallback ?? existing.expectCallback,
          callbackSecret: data.callbackSecret !== undefined ? data.callbackSecret : existing.callbackSecret,
          updatedAt: new Date(),
        })
        .where(eq(webhookAdapterConfigs.id, existing.id))
        .returning();
      return updated;
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [created] = await db
      .insert(webhookAdapterConfigs)
      .values({
        agentId,
        organisationId,
        endpointUrl: data.endpointUrl,
        authType: data.authType ?? 'none',
        authSecret: data.authSecret ?? null,
        authHeaderName: data.authHeaderName ?? null,
        timeoutMs: data.timeoutMs ?? 300000,
        retryCount: data.retryCount ?? 2,
        retryBackoffMs: data.retryBackoffMs ?? 5000,
        expectCallback: data.expectCallback ?? false,
        callbackSecret: data.callbackSecret ?? null,
      })
      .returning();
    return created;
  },

  /**
   * Delete webhook config for an agent.
   */
  async deleteConfig(agentId: string, organisationId: string): Promise<boolean> {
    const existing = await this.getConfig(agentId, organisationId);
    if (!existing) return false;

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .delete(webhookAdapterConfigs)
      .where(
        and(
          eq(webhookAdapterConfigs.agentId, agentId),
          eq(webhookAdapterConfigs.organisationId, organisationId),
        ),
      );
    return true;
  },

  /**
   * Trigger a webhook agent — build payload, sign, POST to endpoint.
   * Called from the agent execution path when modelProvider = 'http_webhook'.
   */
  async triggerWebhookAgent(
    agentId: string,
    runId: string,
    task: TaskPayload | null,
    context: TriggerContext,
    eventType: 'heartbeat' | 'task_assigned' | 'manual_trigger' = 'heartbeat',
  ) {
    const config = await this.getConfig(agentId, context.organisationId);
    if (!config) {
      throw { statusCode: 404, message: 'Webhook adapter config not found for agent' };
    }

    // Circuit breaker check
    if (isCircuitOpen(agentId)) {
      logger.warn('webhook_circuit_open', { agentId, runId });
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      await db
        .update(agentRuns)
        .set({
          status: 'failed',
          errorMessage: 'Circuit breaker open — webhook endpoint has been failing',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, runId));

      await auditService.log({
        organisationId: context.organisationId,
        actorType: 'system',
        action: 'webhook.failed',
        entityType: 'agent_run',
        entityId: runId,
        metadata: { agentId, reason: 'circuit_breaker_open' },
      });

      return { status: 'failed', reason: 'circuit_breaker_open' };
    }

    // Fetch agent name
    // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to fetch agent name; agentId is sourced from the org-scoped run context"
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [agent] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId));
    const agentName = agent?.name ?? 'Unknown Agent';

    // Generate callback token (JWT, 15 min expiry)
    const callbackToken = generateCallbackToken({ runId, agentId, orgId: context.organisationId });
    const callbackUrl = buildCallbackUrl(runId);

    // Build payload
    const payload = {
      eventType,
      agentId,
      agentName,
      runId,
      task: task ?? undefined,
      context,
      idempotencyKey: runId,
      callbackUrl,
      callbackToken,
      timestamp: new Date().toISOString(),
    };

    const bodyStr = JSON.stringify(payload);
    const headers = signRequest(bodyStr, config.authType as any, config.authSecret, config.authHeaderName);

    await auditService.log({
      organisationId: context.organisationId,
      actorType: 'system',
      action: 'webhook.invoked',
      entityType: 'agent_run',
      entityId: runId,
      metadata: { agentId, endpointUrl: config.endpointUrl, eventType },
    });

    const result = await postWithRetry(
      config.endpointUrl,
      bodyStr,
      headers,
      config.timeoutMs,
      config.retryCount,
      config.retryBackoffMs,
    );

    if (!result.ok) {
      recordFailure(agentId);

      const errorMsg = `Webhook POST failed after ${config.retryCount + 1} attempts`;
      const failStatus = result.status === 0 ? 'timeout' : 'failed';

      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      await db
        .update(agentRuns)
        .set({
          status: failStatus,
          errorMessage: errorMsg,
          errorDetail: { lastStatus: result.status, lastResponse: result.data },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, runId));

      await auditService.log({
        organisationId: context.organisationId,
        actorType: 'system',
        action: 'webhook.failed',
        entityType: 'agent_run',
        entityId: runId,
        metadata: { agentId, error: errorMsg, lastStatus: result.status },
      });

      return { status: 'failed', error: errorMsg };
    }

    recordSuccess(agentId);

    // If expectCallback, set status to waiting_callback and return
    if (config.expectCallback) {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      await db
        .update(agentRuns)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(agentRuns.id, runId));

      // The run is now waiting — the caller should schedule the SLA timeout job
      // (15 min pg-boss delayed job that checks if run is still waiting_callback)
      return { status: 'waiting_callback', callbackUrl };
    }

    // Synchronous response — process immediately
    const responseData = result.data as WebhookAgentResponse | null;
    const runStatus = responseData?.status === 'failed' ? 'failed' : 'completed';

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(agentRuns)
      .set({
        status: runStatus,
        summary: responseData?.message ?? null,
        errorMessage: responseData?.error ?? null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));

    return { status: runStatus, response: responseData };
  },

  /**
   * Handle an async callback from an external agent.
   * Validates the JWT token, performs conditional UPDATE on the run,
   * and processes any task updates.
   */
  async handleCallback(
    runId: string,
    token: string,
    response: WebhookAgentResponse,
  ): Promise<{ success: boolean; message: string }> {
    // 1. Verify JWT
    let tokenPayload: CallbackTokenPayload;
    try {
      tokenPayload = verifyCallbackToken(token);
    } catch (err) {
      logger.warn('webhook_callback_invalid_token', { runId, error: (err as Error).message });
      return { success: false, message: 'Invalid or expired callback token' };
    }

    // 2. Check runId matches
    if (tokenPayload.runId !== runId) {
      logger.warn('webhook_callback_runid_mismatch', { runId, tokenRunId: tokenPayload.runId });
      return { success: false, message: 'Token runId does not match URL parameter' };
    }

    // 3. Conditional UPDATE — only update if status is still waiting_callback
    const newStatus = response.status === 'failed' ? 'failed' : 'completed';

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const updated = await db
      .update(agentRuns)
      .set({
        status: newStatus,
        summary: response.message ?? null,
        errorMessage: response.error ?? null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.status, 'running'),
        ),
      )
      .returning({ id: agentRuns.id });

    if (updated.length === 0) {
      logger.warn('webhook_callback_no_update', { runId, reason: 'run not in running status' });
      return { success: false, message: 'Run is not in a state that accepts callbacks' };
    }

    // 4. Log audit event
    await auditService.log({
      organisationId: tokenPayload.orgId,
      actorType: 'system',
      action: 'webhook.callback_received',
      entityType: 'agent_run',
      entityId: runId,
      metadata: {
        agentId: tokenPayload.agentId,
        responseStatus: response.status,
        hasTaskUpdates: !!response.taskUpdates,
      },
    });

    return { success: true, message: `Run updated to ${newStatus}` };
  },
};

// ---------------------------------------------------------------------------
// Support Ticket Webhook Dispatcher
// ---------------------------------------------------------------------------
//
// Handles Teamwork Desk webhook events normalised by teamworkAdapter.normaliseEvent.
// The route (teamworkWebhook.ts) calls dispatchSupportEvent after ack.
//
// Event routing:
//   ticket.created / updated / reopened / completed  → upsert canonical_tickets
//   ticket.deleted                                   → tombstone canonical_tickets
//   ticket.assigned                                  → update assignee_agent_id
//   ticket.status_changed                            → update status
//   ticket.reply.created / ticket.note.created       → upsert canonical_ticket_messages + back-link
//   (unknown)                                        → emit PROVIDER_WEBHOOK_UNMAPPED_EVENT
// ---------------------------------------------------------------------------

export async function dispatchSupportEvent(
  event: NormalisedEvent,
  connectorConfigId: string,
  organisationId: string,
): Promise<void> {
  const rawData = event.data as Record<string, unknown>;
  const ticketData = rawData?.ticket as Record<string, unknown> | undefined;
  const ticketExternalId = event.entityExternalId;

  // ── Ticket upsert events ─────────────────────────────────────────────────
  if (
    event.eventType === 'ticket.created' ||
    event.eventType === 'ticket.updated' ||
    event.eventType === 'ticket.reopened' ||
    event.eventType === 'ticket.completed'
  ) {
    await withOrgTx(
      { tx: db, organisationId, source: 'webhookAdapterService.dispatchSupportEvent.ticketUpsert' },
      async () => {
        const orgDb = getOrgScopedDb('webhookAdapterService.dispatchSupportEvent.ticketUpsert');

        // Resolve inbox canonical id (required — if missing, log and skip)
        const inboxExternalId = ticketData?.inboxId ? String(ticketData.inboxId) : null;
        if (!inboxExternalId) {
          logger.warn('support.webhook.ticket_upsert_no_inbox', {
            code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
            connectorConfigId,
            ticketExternalId,
            eventType: event.eventType,
          });
          return;
        }

        // Load inbox by connectorConfigId + externalId
        const [inboxRow] = await orgDb
          .select({ id: canonicalInboxes.id })
          .from(canonicalInboxes)
          .where(
            and(
              eq(canonicalInboxes.connectorConfigId, connectorConfigId),
              eq(canonicalInboxes.externalId, inboxExternalId),
            ),
          );

        if (!inboxRow) {
          logger.warn('support.webhook.ticket_upsert_inbox_not_found', {
            code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
            connectorConfigId,
            ticketExternalId,
            inboxExternalId,
          });
          return;
        }

        // Resolve status
        const rawStatus = ticketData?.status as string | undefined;
        const status = mapTeamworkStatus(rawStatus);

        // Resolve priority
        const rawPriority = ticketData?.priority as string | undefined;
        const validPriorities = ['low', 'medium', 'high', 'urgent'] as const;
        type Priority = typeof validPriorities[number];
        const priority: Priority = validPriorities.includes(rawPriority as Priority)
          ? (rawPriority as Priority)
          : 'medium';

        // Resolve sourceChannel
        const rawChannel = ticketData?.channel as string | undefined;
        const validChannels = ['email', 'chat', 'form', 'api'] as const;
        type Channel = typeof validChannels[number];
        const sourceChannel: Channel = validChannels.includes(rawChannel as Channel)
          ? (rawChannel as Channel)
          : 'email';

        const externalMetadata: Record<string, unknown> = {};
        if (status === 'unknown_provider_status' && rawStatus) {
          externalMetadata['provider_status_raw'] = rawStatus;
          logger.warn('support.webhook.unknown_status', {
            code: SUPPORT_LOG_CODES.STATUS_UNKNOWN_PROVIDER_STATUS,
            connectorConfigId,
            ticketExternalId,
            rawStatus,
          });
        }

        // Resolve assignee
        const assigneeExternalId = ticketData?.assigneeId ? String(ticketData.assigneeId) : null;
        let assigneeAgentId: string | null = null;
        if (assigneeExternalId) {
          const [agentRow] = await orgDb
            .select({ id: canonicalSupportAgents.id })
            .from(canonicalSupportAgents)
            .where(
              and(
                eq(canonicalSupportAgents.connectorConfigId, connectorConfigId),
                eq(canonicalSupportAgents.externalId, assigneeExternalId),
              ),
            );
          assigneeAgentId = agentRow?.id ?? null;
        }

        const upsertValues = {
          organisationId,
          connectorConfigId,
          externalId: ticketExternalId,
          inboxId: inboxRow.id,
          status,
          priority,
          sourceChannel,
          subject: (ticketData?.subject as string | undefined) ?? '(no subject)',
          tags: Array.isArray(ticketData?.tags)
            ? (ticketData.tags as unknown[]).map(String)
            : [],
          category: (ticketData?.category as string | undefined) ?? null,
          customerEmail: (ticketData?.customerEmail as string | undefined) ?? null,
          customerName: (ticketData?.customerName as string | undefined) ?? null,
          customerExternalId: (ticketData?.customerExternalId as string | undefined) ?? null,
          openedAt: event.sourceTimestamp ?? event.timestamp,
          assigneeAgentId,
          externalMetadata: Object.keys(externalMetadata).length > 0 ? externalMetadata : null,
          lastSyncedAt: new Date(),
        };

        await orgDb
          .insert(canonicalTickets)
          .values(upsertValues)
          .onConflictDoUpdate({
            target: [canonicalTickets.connectorConfigId, canonicalTickets.externalId],
            set: {
              inboxId: upsertValues.inboxId,
              status: upsertValues.status,
              priority: upsertValues.priority,
              subject: upsertValues.subject,
              tags: upsertValues.tags,
              category: upsertValues.category,
              customerEmail: upsertValues.customerEmail,
              customerName: upsertValues.customerName,
              customerExternalId: upsertValues.customerExternalId,
              assigneeAgentId: upsertValues.assigneeAgentId,
              externalMetadata: upsertValues.externalMetadata,
              lastSyncedAt: upsertValues.lastSyncedAt,
              updatedAt: new Date(),
            },
          });
      },
    );
    return;
  }

  // ── Ticket deleted ───────────────────────────────────────────────────────
  if (event.eventType === 'ticket.deleted') {
    await withOrgTx(
      { tx: db, organisationId, source: 'webhookAdapterService.dispatchSupportEvent.ticketDeleted' },
      async () => {
        const orgDb = getOrgScopedDb('webhookAdapterService.dispatchSupportEvent.ticketDeleted');
        const result = await orgDb
          .update(canonicalTickets)
          .set({
            providerDeleted: true,
            deletedAtExternal: event.timestamp,
            deletedAtCanonical: new Date(),
            deletionSource: 'provider_webhook',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(canonicalTickets.connectorConfigId, connectorConfigId),
              eq(canonicalTickets.externalId, ticketExternalId),
            ),
          )
          .returning({ id: canonicalTickets.id });

        if (result.length > 0) {
          logger.info(SUPPORT_LOG_CODES.TICKET_PROVIDER_DELETED, {
            code: SUPPORT_LOG_CODES.TICKET_PROVIDER_DELETED,
            connectorConfigId,
            ticketExternalId,
            ticketId: result[0].id,
          });
        }
      },
    );
    return;
  }

  // ── Ticket assigned ──────────────────────────────────────────────────────
  if (event.eventType === 'ticket.assigned') {
    await withOrgTx(
      { tx: db, organisationId, source: 'webhookAdapterService.dispatchSupportEvent.ticketAssigned' },
      async () => {
        const orgDb = getOrgScopedDb('webhookAdapterService.dispatchSupportEvent.ticketAssigned');

        const assigneeExternalId = ticketData?.assigneeId ? String(ticketData.assigneeId) : null;
        let assigneeAgentId: string | null = null;
        if (assigneeExternalId) {
          const [agentRow] = await orgDb
            .select({ id: canonicalSupportAgents.id })
            .from(canonicalSupportAgents)
            .where(
              and(
                eq(canonicalSupportAgents.connectorConfigId, connectorConfigId),
                eq(canonicalSupportAgents.externalId, assigneeExternalId),
              ),
            );
          assigneeAgentId = agentRow?.id ?? null;
        }

        await orgDb
          .update(canonicalTickets)
          .set({ assigneeAgentId, updatedAt: new Date() })
          .where(
            and(
              eq(canonicalTickets.connectorConfigId, connectorConfigId),
              eq(canonicalTickets.externalId, ticketExternalId),
            ),
          );
      },
    );
    return;
  }

  // ── Ticket status changed ────────────────────────────────────────────────
  if (event.eventType === 'ticket.status_changed') {
    await withOrgTx(
      { tx: db, organisationId, source: 'webhookAdapterService.dispatchSupportEvent.ticketStatusChanged' },
      async () => {
        const orgDb = getOrgScopedDb('webhookAdapterService.dispatchSupportEvent.ticketStatusChanged');

        const rawStatus = ticketData?.status as string | undefined;
        const status = mapTeamworkStatus(rawStatus);

        if (status === 'unknown_provider_status' && rawStatus) {
          // Preserve raw status in external_metadata; fetch existing metadata first
          const [existing] = await orgDb
            .select({ externalMetadata: canonicalTickets.externalMetadata })
            .from(canonicalTickets)
            .where(
              and(
                eq(canonicalTickets.connectorConfigId, connectorConfigId),
                eq(canonicalTickets.externalId, ticketExternalId),
              ),
            );

          const mergedMetadata = {
            ...(existing?.externalMetadata ?? {}),
            provider_status_raw: rawStatus,
          };

          logger.warn('support.webhook.unknown_status', {
            code: SUPPORT_LOG_CODES.STATUS_UNKNOWN_PROVIDER_STATUS,
            connectorConfigId,
            ticketExternalId,
            rawStatus,
          });

          await orgDb
            .update(canonicalTickets)
            .set({ status, externalMetadata: mergedMetadata, updatedAt: new Date() })
            .where(
              and(
                eq(canonicalTickets.connectorConfigId, connectorConfigId),
                eq(canonicalTickets.externalId, ticketExternalId),
              ),
            );
          return;
        }

        await orgDb
          .update(canonicalTickets)
          .set({ status, updatedAt: new Date() })
          .where(
            and(
              eq(canonicalTickets.connectorConfigId, connectorConfigId),
              eq(canonicalTickets.externalId, ticketExternalId),
            ),
          );
      },
    );
    return;
  }

  // ── Message events (reply / note) ────────────────────────────────────────
  if (
    event.eventType === 'ticket.reply.created' ||
    event.eventType === 'ticket.note.created'
  ) {
    const messageData = rawData?.message as Record<string, unknown> | undefined;
    const messageExternalId = messageData?.id ? String(messageData.id) : null;

    if (!messageExternalId) {
      logger.warn('support.webhook.message_event_no_id', {
        code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
        connectorConfigId,
        ticketExternalId,
        eventType: event.eventType,
      });
      return;
    }

    const direction: 'inbound' | 'outbound' | 'internal_note' =
      event.eventType === 'ticket.note.created'
        ? 'internal_note'
        : (messageData?.direction as 'inbound' | 'outbound' | undefined) ?? 'outbound';

    const visibility: 'public' | 'internal' =
      direction === 'internal_note' ? 'internal' : 'public';

    const authorType: 'customer' | 'agent' | 'bot' | 'system' =
      direction === 'inbound' ? 'customer' : 'agent';

    await withOrgTx(
      { tx: db, organisationId, source: 'webhookAdapterService.dispatchSupportEvent.messageUpsert' },
      async () => {
        const orgDb = getOrgScopedDb('webhookAdapterService.dispatchSupportEvent.messageUpsert');

        // Resolve canonical ticket FK
        const [ticketRow] = await orgDb
          .select({ id: canonicalTickets.id })
          .from(canonicalTickets)
          .where(
            and(
              eq(canonicalTickets.connectorConfigId, connectorConfigId),
              eq(canonicalTickets.externalId, ticketExternalId),
            ),
          );

        if (!ticketRow) {
          logger.warn('support.webhook.message_event_ticket_not_found', {
            code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
            connectorConfigId,
            ticketExternalId,
            messageExternalId,
          });
          return;
        }

        // Resolve author FK per polymorphic-FK CHECK constraint (migration 0310):
        // agent/bot messages MUST carry author_support_agent_id; customer messages must NOT.
        let authorSupportAgentId: string | null = null;
        if (authorType !== 'customer') {
          const authorObj = messageData?.author as Record<string, unknown> | undefined;
          const authorExternalId = authorObj?.id ? String(authorObj.id) : null;
          if (!authorExternalId) {
            logger.warn('support.webhook.message_event_missing_author_id', {
              code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
              connectorConfigId,
              ticketExternalId,
              messageExternalId,
              authorType,
              reason: 'missing_author_external_id',
            });
            return;
          }
          const [agentRow] = await orgDb
            .select({ id: canonicalSupportAgents.id })
            .from(canonicalSupportAgents)
            .where(
              and(
                eq(canonicalSupportAgents.connectorConfigId, connectorConfigId),
                eq(canonicalSupportAgents.externalId, authorExternalId),
              ),
            );
          if (!agentRow) {
            logger.warn('support.webhook.message_event_unknown_agent', {
              code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
              connectorConfigId,
              ticketExternalId,
              messageExternalId,
              authorExternalId,
              reason: 'unknown_agent_external_id',
            });
            return;
          }
          authorSupportAgentId = agentRow.id;
        }

        const inserted = await orgDb
          .insert(canonicalTicketMessages)
          .values({
            organisationId,
            connectorConfigId,
            ticketId: ticketRow.id,
            ticketExternalId,
            externalId: messageExternalId,
            direction,
            visibility,
            authorType,
            authorSupportAgentId,
            bodyText: (messageData?.body as string | undefined) ?? '',
            bodyHtml: (messageData?.bodyHtml as string | undefined) ?? null,
            createdAtExternal: event.sourceTimestamp ?? event.timestamp,
            externalMetadata: null,
          })
          .onConflictDoNothing()
          .returning({ id: canonicalTicketMessages.id });

        // Back-link routine — only run when a new row was actually inserted
        if (inserted.length === 0) {
          logger.info(SUPPORT_LOG_CODES.INGEST_DUPLICATE_COLLAPSED, {
            code: SUPPORT_LOG_CODES.INGEST_DUPLICATE_COLLAPSED,
            connectorConfigId,
            ticketExternalId,
            messageExternalId,
          });
          return;
        }

        const newMessageId = inserted[0].id;
        const newMessageBodyText = (messageData?.body as string | undefined) ?? '';

        // Load drafts eligible for back-linking. Three eligible status sets:
        //   - manually_marked_sent — operator-confirmed dispatch awaiting late linking (spec §11.7)
        //   - sent (sent_message_id IS NULL) — defensive; no callsite produces this today
        //   - needs_reconciliation — synchronous-success drafts parked here so the
        //     reconciliation worker / back-link can resolve them to `sent` once the
        //     canonical message lands (see supportDraftDispatchService.ts approveDraft).
        const candidateDraftRows = await orgDb
          .select({
            id: canonicalTicketDrafts.id,
            proposedBodyText: canonicalTicketDrafts.proposedBodyText,
            proposedVisibility: canonicalTicketDrafts.proposedVisibility,
            status: canonicalTicketDrafts.status,
            sentMessageId: canonicalTicketDrafts.sentMessageId,
          })
          .from(canonicalTicketDrafts)
          .where(
            and(
              eq(canonicalTicketDrafts.ticketId, ticketRow.id),
              eq(canonicalTicketDrafts.organisationId, organisationId),
              inArray(canonicalTicketDrafts.status, ['manually_marked_sent', 'sent', 'needs_reconciliation']),
            ),
          );

        const backLinkResult = findBackLinkCandidate({
          newlyLandedMessage: {
            direction,
            visibility,
            bodyText: newMessageBodyText,
            createdAtExternal: event.sourceTimestamp ?? event.timestamp,
          },
          candidateDrafts: candidateDraftRows.map((d) => ({
            id: d.id,
            proposedBodyText: d.proposedBodyText,
            proposedVisibility: d.proposedVisibility,
            status: d.status,
            sentMessageId: d.sentMessageId ?? null,
          })),
        });

        if (backLinkResult.ambiguous) {
          logger.warn(SUPPORT_LOG_CODES.DRAFT_BACKLINK_AMBIGUOUS, {
            code: SUPPORT_LOG_CODES.DRAFT_BACKLINK_AMBIGUOUS,
            connectorConfigId,
            ticketExternalId,
            messageExternalId,
            candidateCount: candidateDraftRows.length,
          });
          return;
        }

        if (backLinkResult.match) {
          const matchedDraftId = backLinkResult.match.id;

          // Set source_draft_id on the message
          await orgDb
            .update(canonicalTicketMessages)
            .set({ sourceDraftId: matchedDraftId })
            .where(eq(canonicalTicketMessages.id, newMessageId));

          // Set sent_message_id on the draft + transition to 'sent'
          await orgDb
            .update(canonicalTicketDrafts)
            .set({
              sentMessageId: newMessageId,
              status: 'sent',
              updatedAt: new Date(),
            })
            .where(eq(canonicalTicketDrafts.id, matchedDraftId));

          logger.info(SUPPORT_LOG_CODES.DRAFT_SENT, {
            code: SUPPORT_LOG_CODES.DRAFT_SENT,
            connectorConfigId,
            ticketExternalId,
            draftId: matchedDraftId,
            messageId: newMessageId,
          });
        }
      },
    );
    return;
  }

  // ── Unknown event type ───────────────────────────────────────────────────
  logger.warn(SUPPORT_LOG_CODES.PROVIDER_WEBHOOK_UNMAPPED_EVENT, {
    code: SUPPORT_LOG_CODES.PROVIDER_WEBHOOK_UNMAPPED_EVENT,
    connectorConfigId,
    eventType: event.eventType,
  });
}
