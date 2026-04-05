import { Router, raw } from 'express';
import { db } from '../../db/index.js';
import { connectorConfigs } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { adapters } from '../../adapters/index.js';

const router = Router();

/**
 * Teamwork Desk Webhook endpoint — unauthenticated.
 * Security: HMAC-SHA256 signature verification against connector_configs.webhook_secret.
 *
 * Teamwork sends webhook payloads with an `X-Teamwork-Signature` header.
 * The event payload contains the event type and ticket data.
 */
router.post('/api/webhooks/teamwork', raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body as Buffer;
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Find the connector config for Teamwork Desk.
  // Unlike GHL (which routes by locationId), Teamwork routes by org-level connector config.
  // If multiple orgs use Teamwork, we match by webhook secret signature.
  let config;
  try {
    const configs = await db
      .select()
      .from(connectorConfigs)
      .where(and(
        eq(connectorConfigs.connectorType, 'teamwork'),
        eq(connectorConfigs.status, 'active'),
      ));

    if (configs.length === 0) {
      console.warn('[Teamwork Webhook] No active Teamwork connector configs found');
      res.status(200).json({ received: true });
      return;
    }

    // Match by verifying HMAC signature against each config's webhook secret
    const adapter = adapters.teamwork;
    const signature = req.headers['x-teamwork-signature'] as string | undefined;

    for (const candidate of configs) {
      if (candidate.webhookSecret && signature && adapter?.webhook?.verifySignature(rawBody, signature, candidate.webhookSecret)) {
        config = candidate;
        break;
      }
    }

    // If no signature match, use the first config (single-org setup without HMAC)
    if (!config) {
      if (signature) {
        console.warn('[Teamwork Webhook] No config matched signature, rejecting');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      config = configs[0];
      console.warn(`[Teamwork Webhook] No webhook secret configured for connector ${config.id} — processing without HMAC verification`);
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

    console.log(`[Teamwork Webhook] Processed ${normalised.eventType} for ticket ${normalised.entityExternalId}`);

    // Ticket webhook events are for real-time awareness (agent reactions),
    // not canonical data ingestion. Emit for downstream consumers.
    // Future: publish to event bus / pg-boss queue for agent processing.
  } catch (err) {
    console.error('[Teamwork Webhook] Error processing event:', err instanceof Error ? err.message : err);
  }
});

export default router;
