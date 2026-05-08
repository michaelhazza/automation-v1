/**
 * Agent presence SSE stream endpoints.
 *
 * GET /api/agent-presence/stream/:agentId
 * GET /api/agent-presence/stream/workspace/:subaccountId
 *
 * Agent Workspace Chunk 9.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { logger } from '../lib/logger.js';
import {
  subscribe,
  replaySinceLastEventId,
  type PresenceStreamEvent,
  type PresenceScope,
} from '../services/agentPresenceStreamPublisher.js';

const router = Router();

// ── Shared helpers ────────────────────────────────────────────────────────────

function writeSSEEvent(res: import('express').Response, event: PresenceStreamEvent): void {
  res.write(`id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`);
}

function resolveLastEventId(req: import('express').Request): string | undefined {
  const headerValue = req.headers['last-event-id'] as string | undefined;
  const queryValue = req.query.lastEventId as string | undefined;

  if (headerValue && queryValue && headerValue !== queryValue) {
    logger.debug('presence_stream.last_event_id_conflict', {
      header: headerValue,
      queryParam: queryValue,
    });
  }

  return headerValue ?? queryValue;
}

function sseSetup(res: import('express').Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function attachStream(
  req: import('express').Request,
  res: import('express').Response,
  scope: PresenceScope,
): void {
  const lastEventId = resolveLastEventId(req) ?? null;
  const subscriberId = randomUUID();

  // Replay buffer
  const replayed = replaySinceLastEventId(scope, lastEventId);
  for (const event of replayed) {
    writeSSEEvent(res, event);
  }

  // Live subscription
  const { unsubscribe } = subscribe(scope, subscriberId, (event) => {
    writeSSEEvent(res, event);
  });

  // Heartbeat every 30 s
  const heartbeatInterval = setInterval(() => {
    const heartbeat: PresenceStreamEvent = {
      agentId: scope.kind === 'agent' ? scope.agentId : '',
      eventTimestamp: new Date().toISOString(),
      serverNow: new Date().toISOString(),
      eventId: randomUUID(),
      data: null,
      eventType: 'server_heartbeat',
    };
    writeSSEEvent(res, heartbeat);
  }, 30_000);

  // Cleanup
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    unsubscribe();
  });
}

// ── Endpoint 1: agent-scoped stream ──────────────────────────────────────────

router.get(
  '/api/agent-presence/stream/:agentId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE),
  async (req: import('express').Request, res: import('express').Response) => {
    try {
      sseSetup(res);
      const scope: PresenceScope = { kind: 'agent', agentId: req.params.agentId };
      attachStream(req, res, scope);
    } catch (err) {
      logger.error('presence_stream.agent.error', { error: err });
      res.status(500).end();
    }
  },
);

// ── Endpoint 2: workspace-scoped stream ──────────────────────────────────────

router.get(
  '/api/agent-presence/stream/workspace/:subaccountId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE),
  async (req: import('express').Request, res: import('express').Response) => {
    try {
      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      sseSetup(res);
      const scope: PresenceScope = { kind: 'workspace', subaccountId: req.params.subaccountId };
      attachStream(req, res, scope);
    } catch (err) {
      logger.error('presence_stream.workspace.error', { error: err });
      res.status(500).end();
    }
  },
);

export default router;
