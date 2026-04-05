import { Router, raw } from 'express';
import { db } from '../../db/index.js';
import { connectorConfigs } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { adapters } from '../../adapters/index.js';

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
 */
router.post('/api/webhooks/slack', raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body as Buffer;
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Handle Slack URL verification challenge (required during webhook setup)
  if (event.type === 'url_verification') {
    res.status(200).json({ challenge: event.challenge });
    return;
  }

  // Find the Slack connector config
  let config;
  try {
    const [result] = await db
      .select()
      .from(connectorConfigs)
      .where(and(
        eq(connectorConfigs.connectorType, 'slack'),
        eq(connectorConfigs.status, 'active'),
      ))
      .limit(1);

    if (!result) {
      console.warn('[Slack Webhook] No active Slack connector config found');
      res.status(200).json({ received: true });
      return;
    }
    config = result;
  } catch (err) {
    console.error('[Slack Webhook] DB lookup failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  // Verify Slack signature
  if (config.webhookSecret) {
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
    if (!adapter?.webhook?.verifySignature(basestring, signature, config.webhookSecret)) {
      console.warn('[Slack Webhook] Invalid signature, rejecting');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } else {
    console.warn(`[Slack Webhook] No webhook secret configured for connector ${config.id} — processing without HMAC verification`);
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

    console.log(`[Slack Webhook] Processed ${normalised.eventType} in channel ${normalised.entityExternalId}`);

    // Messaging webhook events are for real-time awareness (agent reactions).
    // Future: publish to event bus / pg-boss queue for agent processing.
  } catch (err) {
    console.error('[Slack Webhook] Error processing event:', err instanceof Error ? err.message : err);
  }
});

export default router;
