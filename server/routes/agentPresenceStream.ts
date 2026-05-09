/**
 * Agent presence SSE stream endpoints.
 *
 * POST /api/agent-presence/stream-token  — issue a short-lived signed token
 * GET  /api/agent-presence/stream/:agentId
 * GET  /api/agent-presence/stream/workspace/:subaccountId
 *
 * Agent Workspace Chunk 9 + B3 signed-token auth.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { authenticateStreamToken } from '../middleware/authenticateStreamToken.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveAgent } from '../lib/resolveAgent.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { signStreamToken } from '../lib/agentPresenceStreamToken.js';
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

  // Heartbeat every 15 s (spec §13.3)
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
  }, 15_000);

  // Cleanup
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    unsubscribe();
  });
}

// ── Endpoint 0: stream-token issuance ────────────────────────────────────────
//
// Issues a short-lived signed token (120s TTL) bound to the user's org + requested scope.
// The browser holds the token in memory only (never in localStorage).
// Client re-fetches this endpoint on token expiry before reconnecting.

router.post(
  '/api/agent-presence/stream-token',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE),
  asyncHandler(async (req, res) => {
    const { scope: scopeBody } = req.body as {
      scope?: { kind?: string; agentId?: string; subaccountId?: string };
    };

    if (!scopeBody || !scopeBody.kind) {
      res.status(400).json({ error: 'scope.kind required' });
      return;
    }

    const orgId = req.orgId!;
    const userId = req.user!.id;

    if (scopeBody.kind === 'agent') {
      if (!scopeBody.agentId) {
        res.status(400).json({ error: 'scope.agentId required for agent scope' });
        return;
      }
      await resolveAgent(scopeBody.agentId, orgId);
      const { token, expiresAt } = signStreamToken({
        userId,
        orgId,
        scope: { kind: 'agent', agentId: scopeBody.agentId },
      });
      res.json({ token, expiresAt });
      return;
    }

    if (scopeBody.kind === 'workspace') {
      if (!scopeBody.subaccountId) {
        res.status(400).json({ error: 'scope.subaccountId required for workspace scope' });
        return;
      }
      await resolveSubaccount(scopeBody.subaccountId, orgId);
      const { token, expiresAt } = signStreamToken({
        userId,
        orgId,
        scope: { kind: 'workspace', subaccountId: scopeBody.subaccountId },
      });
      res.json({ token, expiresAt });
      return;
    }

    res.status(400).json({ error: 'scope.kind must be agent or workspace' });
  }),
);

// ── Endpoint 1: agent-scoped stream ──────────────────────────────────────────
//
// Uses authenticateStreamToken — verifies the short-lived ?token= query param,
// populates req.user / req.orgId / req.streamTokenScope, and strips the token
// from req.url before loggers see it.

router.get(
  '/api/agent-presence/stream/:agentId',
  authenticateStreamToken,
  async (req: import('express').Request, res: import('express').Response) => {
    try {
      // Verify the token's bound scope matches the URL path param
      const claimedAgentId = (req.streamTokenScope as { agentId?: string } | undefined)?.agentId;
      if (claimedAgentId && claimedAgentId !== req.params.agentId) {
        res.status(403).json({ error: 'Token scope does not match requested agent' });
        return;
      }

      await resolveAgent(req.params.agentId, req.orgId!);
      sseSetup(res);
      const scope: PresenceScope = { kind: 'agent', agentId: req.params.agentId, organisationId: req.orgId! };
      attachStream(req, res, scope);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) { res.status(404).json({ error: 'Agent not found' }); return; }
      logger.error('presence_stream.agent.error', { error: err });
      res.status(500).end();
    }
  },
);

// ── Endpoint 2: workspace-scoped stream ──────────────────────────────────────

router.get(
  '/api/agent-presence/stream/workspace/:subaccountId',
  authenticateStreamToken,
  async (req: import('express').Request, res: import('express').Response) => {
    try {
      // Verify the token's bound scope matches the URL path param
      const claimedSubaccountId = (req.streamTokenScope as { subaccountId?: string } | undefined)?.subaccountId;
      if (claimedSubaccountId && claimedSubaccountId !== req.params.subaccountId) {
        res.status(403).json({ error: 'Token scope does not match requested workspace' });
        return;
      }

      await resolveSubaccount(req.params.subaccountId, req.orgId!);
      sseSetup(res);
      const scope: PresenceScope = { kind: 'workspace', subaccountId: req.params.subaccountId };
      attachStream(req, res, scope);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) { res.status(404).json({ error: 'Workspace not found' }); return; }
      logger.error('presence_stream.workspace.error', { error: err });
      res.status(500).end();
    }
  },
);

export default router;
