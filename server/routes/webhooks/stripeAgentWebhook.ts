// ---------------------------------------------------------------------------
// stripeAgentWebhookService — Stripe webhook ingestion for agent-initiated charges
//
// Mounted at /api/webhooks/stripe-agent/:connectionId — BEFORE global JSON
// body parser (raw body required for Stripe signature verification).
//
// Security model:
//   1. Resolve :connectionId via admin-bypass DB query (no tenant context yet).
//   2. Reject if providerType !== 'stripe_agent' or connectionStatus === 'revoked'.
//   3. Verify stripe-signature HMAC against configJson.webhookSecret.
//   4. Resolve tenant context from the verified connection row.
//   5. Deduplicate via stripeAgentDedupeStore (TTL ≥ 96 h) keyed on Stripe event id.
//   6. Enqueue async processing to stripeAgentWebhookService.
//   7. Acknowledge HTTP 200 (target < 100 ms).
//
// Multi-layer dedupe (invariant 37):
//   Primary  — stripeAgentDedupeStore (Redis-backed in prod, in-memory here)
//   Secondary — agent_charges.last_transition_event_id row-level check (in service)
//   Tertiary  — DB trigger monotonicity check
//
// Spec: tasks/builds/agentic-commerce/spec.md §7.5
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 12
// ---------------------------------------------------------------------------

import { Router, raw } from 'express';
import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { WebhookDedupeStore } from '../../lib/webhookDedupe.js';
import { recordIncident } from '../../services/incidentIngestor.js';
import { logger } from '../../lib/logger.js';
import { processStripeAgentWebhookEvent } from '../../services/stripeAgentWebhookService.js';

// Stripe agent webhook dedupe store — explicit TTL ≥ 96 h per invariant 37 / Chunk 12 spec.
// Stripe retries failed deliveries for up to 3 days; this store must outlive that window
// with margin so retry storms cannot reprocess events.
export const STRIPE_WEBHOOK_DEDUPE_TTL_MS = 96 * 60 * 60 * 1000; // 96 hours
export const stripeAgentDedupeStore = new WebhookDedupeStore(STRIPE_WEBHOOK_DEDUPE_TTL_MS);

const router = Router();

/**
 * Verify Stripe webhook signature.
 * Stripe signs payloads as: v1=HMAC-SHA256("${timestamp}.${rawBody}", secret)
 * Header format: "t=<ts>,v1=<sig>"
 */
function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  try {
    const parts: Record<string, string> = {};
    for (const part of signatureHeader.split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) parts[part.slice(0, eq)] = part.slice(eq + 1);
    }
    const timestamp = parts['t'];
    const v1sig = parts['v1'];
    if (!timestamp || !v1sig) return false;

    const signedPayload = `${timestamp}.${rawBody.toString('utf-8')}`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Constant-time compare to prevent timing attacks.
    return crypto.timingSafeEqual(Buffer.from(v1sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

router.post(
  '/api/webhooks/stripe-agent/:connectionId',
  raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const { connectionId } = req.params;
    const rawBody = req.body as Buffer;

    type ConnectionRow = {
      id: string;
      organisationId: string;
      subaccountId: string | null;
      connectionStatus: string;
      configJson: Record<string, unknown> | null;
    };

    // Step 1+2: Resolve connection via admin bypass, validate providerType + status.
    let connection: ConnectionRow | null;
    try {
      connection = await withAdminConnection(
        { source: 'routes.stripeAgentWebhook', reason: 'Resolve connection for webhook routing', skipAudit: true },
        async (tx): Promise<ConnectionRow | null> => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          const rows = (await tx.execute(sql`
            SELECT id, organisation_id, subaccount_id, connection_status, config_json
            FROM integration_connections
            WHERE id = ${connectionId}::uuid
              AND provider_type = 'stripe_agent'
            LIMIT 1
          `)) as unknown as Array<{
            id: string;
            organisation_id: string;
            subaccount_id: string | null;
            connection_status: string;
            config_json: Record<string, unknown> | null;
          }> | { rows?: Array<{
            id: string;
            organisation_id: string;
            subaccount_id: string | null;
            connection_status: string;
            config_json: Record<string, unknown> | null;
          }> };

          const arr = Array.isArray(rows)
            ? rows
            : Array.isArray((rows as { rows?: unknown[] })?.rows)
              ? (rows as { rows: Array<{
                  id: string;
                  organisation_id: string;
                  subaccount_id: string | null;
                  connection_status: string;
                  config_json: Record<string, unknown> | null;
                }> }).rows
              : [];

          if (arr.length === 0) return null;
          const row = arr[0];
          return {
            id: row.id,
            organisationId: row.organisation_id,
            subaccountId: row.subaccount_id,
            connectionStatus: row.connection_status,
            configJson: row.config_json,
          };
        },
      );
    } catch (err) {
      logger.error('stripe_agent_webhook.db_lookup_failed', {
        connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Allowlist: only `active` connections may receive webhooks. `revoked` and
    // `error` (and any future non-active state) are rejected here. The webhook
    // secret persists in `configJson` after a state change, so an exclusion-only
    // check that misses a future state would let signed events from a non-active
    // connection inject state transitions into agent_charges.
    if (connection.connectionStatus !== 'active') {
      recordIncident({
        source: 'route',
        summary: `Stripe agent webhook: non-active connection rejected (connectionId=${connectionId}, status=${connection.connectionStatus})`,
        errorCode: 'stripeAgentWebhook.non_active_connection',
        fingerprintOverride: `webhook:stripe-agent:non_active:${connectionId}:${connection.connectionStatus}`,
        errorDetail: { connectionId, connectionStatus: connection.connectionStatus },
      });
      res.status(404).json({ error: 'Connection not active' });
      return;
    }

    // Step 3: Verify Stripe signature.
    const signatureHeader = req.headers['stripe-signature'] as string | undefined;
    if (!signatureHeader) {
      recordIncident({
        source: 'route',
        summary: `Stripe agent webhook: missing signature header (connectionId=${connectionId})`,
        errorCode: 'stripeAgentWebhook.signature_failure',
        fingerprintOverride: `webhook:stripe-agent:missing_sig:${connectionId}`,
        errorDetail: { connectionId },
      });
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    const webhookSecret = connection.configJson?.webhookSecret as string | undefined;
    if (!webhookSecret) {
      logger.warn('stripe_agent_webhook.no_secret_configured', { connectionId });
      res.status(400).json({ error: 'Webhook secret not configured' });
      return;
    }

    const signatureValid = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
    if (!signatureValid) {
      recordIncident({
        source: 'route',
        summary: `Stripe agent webhook: invalid signature (connectionId=${connectionId})`,
        errorCode: 'stripeAgentWebhook.signature_failure',
        fingerprintOverride: `webhook:stripe-agent:invalid_sig:${connectionId}`,
        errorDetail: { connectionId },
      });
      res.status(400).json({ error: 'Invalid stripe-signature' });
      return;
    }

    // Parse JSON body (after signature verification).
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    const stripeEventId = event['id'] as string | undefined;
    if (!stripeEventId) {
      res.status(400).json({ error: 'Missing event id' });
      return;
    }

    // Step 4: Tenant context resolved from the verified connection row.
    const { organisationId, subaccountId } = connection;

    // Step 5: Deduplicate via stripeAgentDedupeStore (primary layer — invariant 37).
    // On dedupe-store outage: log warning and proceed with layer-2 + layer-3 protection.
    let isDuplicate = false;
    try {
      isDuplicate = stripeAgentDedupeStore.isDuplicate(stripeEventId);
    } catch (err) {
      logger.warn('dedupe_store_degraded', {
        alert: 'dedupe_store_degraded',
        connectionId,
        stripeEventId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Proceed: layer-2 (last_transition_event_id) + layer-3 (DB trigger) protect against duplicates.
    }

    if (isDuplicate) {
      res.status(200).json({ received: true });
      return;
    }

    // Step 6: Acknowledge immediately (< 100 ms target) then process asynchronously.
    res.status(200).json({ received: true });

    // Step 7: Enqueue async processing — do NOT await (already acked).
    void (async () => {
      try {
        await processStripeAgentWebhookEvent({
          event,
          stripeEventId,
          connectionId,
          organisationId,
          subaccountId,
        });
      } catch (err) {
        logger.error('stripe_agent_webhook.process_failed', {
          connectionId,
          stripeEventId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }),
);

export default router;
