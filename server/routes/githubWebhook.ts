/**
 * GitHub App Webhook handler
 *
 * Receives events from GitHub (issues.opened, issue_comment.created, etc.)
 * and creates tasks on the relevant subaccount board.
 *
 * GitHub sends: POST /api/webhooks/github
 *   Headers: x-github-event, x-hub-signature-256, x-github-delivery
 *   Body: event payload (JSON)
 *
 * Security: HMAC-SHA256 signature verified against GITHUB_APP_WEBHOOK_SECRET.
 * Route is intentionally unauthenticated (GitHub cannot provide a JWT).
 */

import { Router } from 'express';
import crypto from 'crypto';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { recordIncident } from '../services/incidentIngestor.js';
import { handleGitHubIssueEvent, handleGitHubIssueCommentEvent } from '../services/githubWebhookService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyGitHubSignature(body: Buffer, signature: string | undefined): boolean {
  const secret = env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret configured, skip verification (dev only)
    logger.warn('github_webhook.no_secret_configured');
    return true;
  }
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/github
// ---------------------------------------------------------------------------

// Express raw body middleware is needed for HMAC verification.
// We use express.raw in the route; the global JSON parser runs first
// so we store the raw body on the request via a custom middleware.

router.post('/api/webhooks/github', (req, res, next) => {
  // Collect raw body for HMAC check
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
}, async (req, res) => {
  const event = req.headers['x-github-event'] as string | undefined;
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const delivery = req.headers['x-github-delivery'] as string | undefined;

  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));

  // 1. Verify signature
  if (!verifyGitHubSignature(rawBody, signature)) {
    logger.warn('github_webhook.signature_failed', { delivery });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Always ack quickly
  res.status(200).json({ received: true, event, delivery });

  // 2. Route to event handler (fire-and-forget after ack)
  try {
    if (event === 'issues') {
      await handleGitHubIssueEvent(payload);
    } else if (event === 'issue_comment') {
      await handleGitHubIssueCommentEvent(payload);
    }
    // ping, installation, push etc. are silently ignored
  } catch (err) {
    logger.error('github_webhook.handler_error', { event, delivery, error: err instanceof Error ? err.message : String(err) });

    // The response was already sent at line 112 (early-ack pattern). This
    // emission is purely for observability — it never affects the response.
    recordIncident({
      source: 'route',
      summary: `GitHub webhook handler failed for event ${event}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      errorCode: 'webhook_handler_failed',
      stack: err instanceof Error ? err.stack : undefined,
      fingerprintOverride: 'webhook:github:handler_failed',
      errorDetail: { event, delivery },
    });
  }
});

export default router;
