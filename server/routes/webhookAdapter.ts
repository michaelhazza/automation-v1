import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { agents } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { webhookAdapterService } from '../services/webhookAdapterService.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Authenticated CRUD — webhook adapter config per agent
// ---------------------------------------------------------------------------

/**
 * GET /api/agents/:agentId/webhook-config
 * Get webhook adapter config for an agent.
 */
router.get(
  '/api/agents/:agentId/webhook-config',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    // Verify agent belongs to org
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, req.orgId!), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const config = await webhookAdapterService.getConfig(agentId, req.orgId!);
    if (!config) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No webhook config for this agent' } });
    }

    // Redact secrets in response
    res.json({
      ...config,
      authSecret: config.authSecret ? '••••••••' : null,
      callbackSecret: config.callbackSecret ? '••••••••' : null,
    });
  }),
);

/**
 * PUT /api/agents/:agentId/webhook-config
 * Create or update webhook adapter config for an agent.
 */
router.put(
  '/api/agents/:agentId/webhook-config',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    // Verify agent belongs to org
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, req.orgId!), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const {
      endpointUrl,
      authType,
      authSecret,
      authHeaderName,
      timeoutMs,
      retryCount,
      retryBackoffMs,
      expectCallback,
      callbackSecret,
    } = req.body as {
      endpointUrl?: string;
      authType?: 'none' | 'bearer' | 'hmac_sha256' | 'api_key_header';
      authSecret?: string | null;
      authHeaderName?: string | null;
      timeoutMs?: number;
      retryCount?: number;
      retryBackoffMs?: number;
      expectCallback?: boolean;
      callbackSecret?: string | null;
    };

    if (!endpointUrl?.trim()) {
      throw { statusCode: 400, message: 'endpointUrl is required' };
    }

    const config = await webhookAdapterService.upsertConfig(agentId, req.orgId!, {
      endpointUrl: endpointUrl.trim(),
      authType,
      authSecret,
      authHeaderName,
      timeoutMs,
      retryCount,
      retryBackoffMs,
      expectCallback,
      callbackSecret,
    });

    // Redact secrets in response
    res.json({
      ...config,
      authSecret: config.authSecret ? '••••••••' : null,
      callbackSecret: config.callbackSecret ? '••••••••' : null,
    });
  }),
);

/**
 * DELETE /api/agents/:agentId/webhook-config
 * Delete webhook adapter config for an agent.
 */
router.delete(
  '/api/agents/:agentId/webhook-config',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    // Verify agent belongs to org
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, req.orgId!), isNull(agents.deletedAt)));

    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const deleted = await webhookAdapterService.deleteConfig(agentId, req.orgId!);
    if (!deleted) {
      throw { statusCode: 404, message: 'No webhook config found for this agent' };
    }

    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Public callback endpoint — called by external agents
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/agent-callback/:runId
 * Receive async callback from an external agent.
 *
 * Authenticates via Bearer token in Authorization header (JWT).
 * Validates X-Timestamp header for replay protection (5 min drift max).
 */
router.post(
  '/api/webhooks/agent-callback/:runId',
  asyncHandler(async (req, res) => {
    const { runId } = req.params;

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw { statusCode: 401, message: 'Missing or invalid Authorization header' };
    }
    const token = authHeader.slice(7);

    // Validate X-Timestamp header — reject drift > 5 minutes
    const timestamp = req.headers['x-timestamp'] as string | undefined;
    if (timestamp) {
      const requestTime = new Date(timestamp).getTime();
      const drift = Math.abs(Date.now() - requestTime);
      if (isNaN(requestTime) || drift > 5 * 60 * 1000) {
        logger.warn('webhook_callback_timestamp_drift', { runId, timestamp, drift });
        throw { statusCode: 400, message: 'Request timestamp is too far from server time' };
      }
    }

    // Parse response body
    const response = req.body as {
      status?: 'completed' | 'failed' | 'in_progress';
      message?: string;
      taskUpdates?: { status?: string; deliverables?: Array<{ title: string; content: string; type: string }> };
      error?: string;
      metadata?: Record<string, unknown>;
    };

    if (!response.status || !['completed', 'failed', 'in_progress'].includes(response.status)) {
      throw { statusCode: 400, message: 'response.status must be one of: completed, failed, in_progress' };
    }

    const result = await webhookAdapterService.handleCallback(runId, token, {
      status: response.status,
      message: response.message,
      taskUpdates: response.taskUpdates,
      error: response.error,
      metadata: response.metadata,
    });

    if (!result.success) {
      throw { statusCode: 409, message: result.message };
    }

    res.json(result);
  }),
);

export default router;
