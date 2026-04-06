import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { webhookAdapterConfigs, agentRuns, agents } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { auditService } from './auditService.js';

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
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
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

      const data = await response.json().catch(() => null);

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
