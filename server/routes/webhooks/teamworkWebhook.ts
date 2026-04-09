import { Router, raw } from 'express';
import { connectorConfigService } from '../../services/connectorConfigService.js';
import { adapters } from '../../adapters/index.js';
import { webhookDedupeStore } from '../../lib/webhookDedupe.js';
import { asyncHandler } from '../../lib/asyncHandler.js';

const router = Router();

/**
 * Teamwork Desk Webhook endpoint — unauthenticated.
 * Security: HMAC-SHA256 signature verification against connector_configs.webhook_secret.
 *
 * Teamwork Desk sends:
 *   - Event type in X-Desk-Event header (not in payload body)
 *   - Signature in X-Desk-Signature header
 */
router.post('/api/webhooks/teamwork', raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const rawBody = req.body as Buffer;
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Teamwork Desk sends event type via header, not payload
  const eventType = req.headers['x-desk-event'] as string | undefined;
  if (eventType) {
    event.event = eventType;
  }

  // Find active Teamwork connector configs via service layer
  let config;
  try {
    const configs = await connectorConfigService.findAllActiveByType('teamwork');

    if (configs.length === 0) {
      console.warn('[Teamwork Webhook] No active Teamwork connector configs found');
      res.status(200).json({ received: true });
      return;
    }

    // Match by verifying HMAC signature against each config's webhook secret
    const adapter = adapters.teamwork;
    const signature = req.headers['x-desk-signature'] as string | undefined;

    if (!signature) {
      console.warn('[Teamwork Webhook] Missing X-Desk-Signature header, rejecting');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    for (const candidate of configs) {
      if (candidate.webhookSecret && adapter?.webhook?.verifySignature(rawBody, signature, candidate.webhookSecret)) {
        config = candidate;
        break;
      }
    }

    if (!config) {
      console.warn('[Teamwork Webhook] No config matched signature, rejecting');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } catch (err) {
    console.error('[Teamwork Webhook] DB lookup failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  // Ack immediately
  res.status(200).json({ received: true });

  // Process asynchronously
  try {
    const adapter = adapters.teamwork;
    if (!adapter?.webhook?.normaliseEvent) {
      console.warn('[Teamwork Webhook] Teamwork adapter has no webhook normaliser');
      return;
    }

    const normalised = adapter.webhook.normaliseEvent(event);
    if (!normalised) return; // Unrecognised event type

    // Deduplicate — skip if already processed
    if (normalised.externalEventId && webhookDedupeStore.isDuplicate(normalised.externalEventId)) {
      console.log(`[Teamwork Webhook] Skipping duplicate event ${normalised.externalEventId}`);
      return;
    }

    console.log(`[Teamwork Webhook] Processed ${normalised.eventType} for ticket ${normalised.entityExternalId}`);

    // Ticket webhook events are for real-time awareness (agent reactions),
    // not canonical data ingestion. Emit for downstream consumers.
    // Future: publish to event bus / pg-boss queue for agent processing.
  } catch (err) {
    console.error('[Teamwork Webhook] Error processing event:', err instanceof Error ? err.message : err);
  }
}));

export default router;
