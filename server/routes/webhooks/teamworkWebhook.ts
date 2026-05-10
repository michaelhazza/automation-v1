import { Router, raw } from 'express';
import { connectorConfigService } from '../../services/connectorConfigService.js';
import { adapters } from '../../adapters/index.js';
import { webhookDedupeStore } from '../../lib/webhookDedupe.js';
import { recordIfNew } from '../../lib/webhookReplayNonceStore.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { recordIncident } from '../../services/incidentIngestor.js';
import { logger } from '../../lib/logger.js';

const router = Router();

/**
 * Teamwork Desk Webhook endpoint — unauthenticated.
 *
 * Security (W3 — pre-test hardening):
 *   - URL carries a per-connector token: POST /api/webhooks/teamwork/:orgWebhookToken
 *   - HMAC-SHA256 signature verified against the single matched connector config's secret.
 *   - Replay protection backed by the durable webhook_replay_nonces table.
 *   - The old un-tokened route ( POST /api/webhooks/teamwork ) is REMOVED entirely.
 *
 * Teamwork Desk sends:
 *   - Event type in X-Desk-Event header (not in payload body)
 *   - Signature in X-Desk-Signature header
 *   - Delivery ID in X-Desk-Delivery header
 */
router.post('/api/webhooks/teamwork/:orgWebhookToken', raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const { orgWebhookToken } = req.params;
  const rawBody = req.body as Buffer;

  // ── Step 1: Resolve the connector config by token ──────────────────────────
  let config: Awaited<ReturnType<typeof connectorConfigService.findByWebhookToken>>;
  try {
    config = await connectorConfigService.findByWebhookToken(orgWebhookToken, 'teamwork');
  } catch (err) {
    logger.error('webhook.teamwork.token_lookup_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    await recordIncident({
      source: 'route',
      summary: 'Teamwork webhook connector-config token lookup failed',
      fingerprintOverride: 'webhook:teamwork:token_lookup_failed',
      severity: 'medium',
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  if (!config) {
    res.status(401).json({ error: 'webhook.token_unknown' });
    return;
  }

  // ── Step 2: Parse body ─────────────────────────────────────────────────────
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

  // ── Step 3: Verify HMAC signature ─────────────────────────────────────────
  const signature = req.headers['x-desk-signature'] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: 'webhook.signature_invalid' });
    return;
  }

  const adapter = adapters.teamwork;
  const signatureValid = config.webhookSecret && adapter?.webhook?.verifySignature(rawBody, signature, config.webhookSecret);
  if (!signatureValid) {
    res.status(401).json({ error: 'webhook.signature_invalid' });
    return;
  }

  // ── Step 4: Require deliveryId ─────────────────────────────────────────────
  const deliveryId = req.headers['x-desk-delivery'] as string | undefined;
  if (!deliveryId || deliveryId.trim() === '') {
    res.status(400).json({ error: 'webhook.delivery_id_required' });
    return;
  }

  // ── Step 5: Persistent replay dedup ───────────────────────────────────────
  let deduped: { inserted: boolean };
  try {
    deduped = await recordIfNew(config.organisationId, 'teamwork', deliveryId);
  } catch (err) {
    logger.error('webhook.teamwork.dedup_db_unreachable', {
      orgId: config.organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordIncident({
      source: 'route',
      summary: 'Teamwork webhook replay-nonce DB insert failed',
      fingerprintOverride: 'webhook:teamwork:dedup_db_unreachable',
      severity: 'medium',
      organisationId: config.organisationId,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  if (!deduped.inserted) {
    // Replay detected — ack but perform no side effects.
    logger.info('webhook.teamwork.replay_deduped', {
      orgId: config.organisationId,
      deliveryId,
      source: 'teamwork',
    });
    res.status(200).json({ received: true, deduplicated: true });
    return;
  }

  // ── Step 6: Ack immediately ────────────────────────────────────────────────
  res.status(200).json({ received: true });

  // ── Step 7: Process asynchronously ────────────────────────────────────────
  try {
    if (!adapter?.webhook?.normaliseEvent) {
      logger.warn('webhook.teamwork.no_normaliser', { orgId: config.organisationId });
      return;
    }

    const normalised = adapter.webhook.normaliseEvent(event);
    if (!normalised) return; // Unrecognised event type

    // Layer-0 in-memory fast-path probe (non-authoritative; durable dedup above is the invariant).
    if (normalised.externalEventId && webhookDedupeStore.isDuplicate(normalised.externalEventId)) {
      logger.debug('webhook.teamwork.in_memory_dedup', {
        orgId: config.organisationId,
        externalEventId: normalised.externalEventId,
      });
      return;
    }

    logger.info('webhook.teamwork.processed', {
      orgId: config.organisationId,
      eventType: normalised.eventType,
      entityExternalId: normalised.entityExternalId,
    });

    // Ticket webhook events are for real-time awareness (agent reactions),
    // not canonical data ingestion. Emit for downstream consumers.
    // Future: publish to event bus / pg-boss queue for agent processing.
  } catch (err) {
    logger.error('webhook.teamwork.handler_failed', {
      orgId: config.organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
    recordIncident({
      source: 'route',
      summary: 'Teamwork webhook event processing failed',
      fingerprintOverride: 'webhook:teamwork:handler_failed',
      severity: 'medium',
      organisationId: config.organisationId,
      stack: err instanceof Error ? err.stack : undefined,
      errorDetail: { eventType: event?.event },
    }).catch(() => { /* fire-and-forget */ });
  }
}));

export default router;
