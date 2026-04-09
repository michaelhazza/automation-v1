import { Router, raw } from 'express';
import { connectorConfigService } from '../../services/connectorConfigService.js';
import { adapters } from '../../adapters/index.js';
import { webhookDedupeStore } from '../../lib/webhookDedupe.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const router = Router();

/**
 * Slack Events API webhook endpoint — unauthenticated.
 * Security: HMAC-SHA256 signature verification using Slack signing secret.
 *
 * Slack sends:
 *   - URL verification challenges (type: "url_verification")
 *   - Event callbacks (type: "event_callback")
 *
 * Slack's signature format: v0=HMAC-SHA256("v0:timestamp:body", signing_secret)
 * Headers: x-slack-signature, x-slack-request-timestamp
 *
 * Multi-tenant: routes by team_id in payload, matching against connector config.
 */
router.post('/api/webhooks/slack', raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const rawBody = req.body as Buffer;
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Multi-tenant: find config by matching signature across all active Slack configs.
  // This supports multiple Slack workspaces (each with their own signing secret).
  let config;
  try {
    const configs = await connectorConfigService.findAllActiveByType('slack');

    if (configs.length === 0) {
      console.warn('[Slack Webhook] No active Slack connector configs found');
      res.status(200).json({ received: true });
      return;
    }

    const signature = req.headers['x-slack-signature'] as string | undefined;
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      console.warn('[Slack Webhook] Missing signature or timestamp header');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    // Reject requests older than 5 minutes (replay protection)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) {
      console.warn('[Slack Webhook] Request timestamp too old, rejecting');
      res.status(401).json({ error: 'Request too old' });
      return;
    }

    // Slack signs "v0:timestamp:rawBody"
    const basestring = Buffer.from(`v0:${timestamp}:${rawBody.toString('utf-8')}`);
    const adapter = adapters.slack;

    // Try each config's webhook secret until one matches
    for (const candidate of configs) {
      if (candidate.webhookSecret && adapter?.webhook?.verifySignature(basestring, signature, candidate.webhookSecret)) {
        config = candidate;
        break;
      }
    }

    if (!config) {
      console.warn('[Slack Webhook] No config matched signature, rejecting');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } catch (err) {
    console.error('[Slack Webhook] DB lookup failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  // Handle Slack URL verification challenge (after signature verification)
  if (event.type === 'url_verification') {
    res.status(200).json({ challenge: event.challenge });
    return;
  }

  // Ack immediately (Slack requires 200 within 3 seconds)
  res.status(200).json({ received: true });

  // Process asynchronously
  try {
    const adapter = adapters.slack;
    if (!adapter?.webhook?.normaliseEvent) {
      console.warn('[Slack Webhook] Slack adapter has no webhook normaliser');
      return;
    }

    const normalised = adapter.webhook.normaliseEvent(event);
    if (!normalised) return; // Unrecognised event type

    // Deduplicate — skip if already processed
    if (normalised.externalEventId && webhookDedupeStore.isDuplicate(normalised.externalEventId)) {
      console.log(`[Slack Webhook] Skipping duplicate event ${normalised.externalEventId}`);
      return;
    }

    console.log(`[Slack Webhook] Processed ${normalised.eventType} in channel ${normalised.entityExternalId}`);

    // Messaging webhook events are for real-time awareness (agent reactions).
    // Future: publish to event bus / pg-boss queue for agent processing.
  } catch (err) {
    console.error('[Slack Webhook] Error processing event:', err instanceof Error ? err.message : err);
  }
}));

export default router;
