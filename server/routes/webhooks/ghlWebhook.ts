import { Router } from 'express';
import { db } from '../../db/index.js';
import { connectorConfigs, canonicalAccounts } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { adapters } from '../../adapters/index.js';
import { canonicalDataService } from '../../services/canonicalDataService.js';

const router = Router();

/**
 * GHL Webhook endpoint — unauthenticated (GHL cannot provide JWT tokens).
 * Security: HMAC-SHA256 signature verification against connector_configs.webhook_secret.
 *
 * Pattern follows server/routes/githubWebhook.ts
 */
router.post('/api/webhooks/ghl', async (req, res) => {
  // Always ack immediately to prevent GHL timeout
  res.status(200).json({ received: true });

  try {
    // Collect raw body for HMAC verification
    // Note: if body-parser has already parsed, req.body is available
    const rawBody = JSON.stringify(req.body);
    const event = req.body as Record<string, unknown>;

    const locationId = event.locationId as string | undefined;
    if (!locationId) {
      console.warn('[GHL Webhook] Event missing locationId, skipping');
      return;
    }

    // Find the connector config by matching the locationId to a canonical account
    const [account] = await db
      .select({ config: connectorConfigs, account: canonicalAccounts })
      .from(canonicalAccounts)
      .innerJoin(connectorConfigs, eq(connectorConfigs.id, canonicalAccounts.connectorConfigId))
      .where(and(
        eq(canonicalAccounts.externalId, locationId),
        eq(connectorConfigs.connectorType, 'ghl')
      ))
      .limit(1);

    if (!account) {
      console.warn(`[GHL Webhook] No connector config found for locationId ${locationId}`);
      return;
    }

    const config = account.config;

    // Verify HMAC signature if webhook secret is configured
    if (config.webhookSecret) {
      const signature = req.headers['x-ghl-signature'] as string | undefined;
      if (!signature) {
        console.warn('[GHL Webhook] Missing signature header, skipping');
        return;
      }

      const adapter = adapters.ghl;
      if (!adapter?.webhook?.verifySignature(Buffer.from(rawBody), signature, config.webhookSecret)) {
        console.warn('[GHL Webhook] Invalid signature, skipping');
        return;
      }
    }

    // Normalise the event
    const adapter = adapters.ghl;
    if (!adapter?.webhook?.normaliseEvent) {
      console.warn('[GHL Webhook] GHL adapter has no webhook normaliser');
      return;
    }

    const normalised = adapter.webhook.normaliseEvent(event);
    if (!normalised) {
      // Unrecognised event type — silently skip
      return;
    }

    // Upsert the entity based on event type
    const dbAccount = account.account;
    const orgId = config.organisationId;

    switch (normalised.entityType) {
      case 'contact':
        await canonicalDataService.upsertContact(orgId, dbAccount.id, {
          externalId: normalised.entityExternalId,
          firstName: normalised.data.firstName as string | undefined,
          lastName: normalised.data.lastName as string | undefined,
          email: normalised.data.email as string | undefined,
          phone: normalised.data.phone as string | undefined,
          tags: normalised.data.tags as string[] | undefined,
        });
        break;

      case 'opportunity':
        await canonicalDataService.upsertOpportunity(orgId, dbAccount.id, {
          externalId: normalised.entityExternalId,
          name: normalised.data.name as string | undefined,
          stage: normalised.data.pipelineStageId as string | undefined,
          value: normalised.data.monetaryValue ? String(normalised.data.monetaryValue) : undefined,
          status: normalised.data.status as string | undefined,
        });
        break;

      case 'conversation':
        await canonicalDataService.upsertConversation(orgId, dbAccount.id, {
          externalId: normalised.entityExternalId,
          status: normalised.data.status as string | undefined,
          messageCount: normalised.data.messageCount as number | undefined,
          lastMessageAt: normalised.data.lastMessageDate ? new Date(normalised.data.lastMessageDate as string) : undefined,
        });
        break;

      case 'revenue':
        await canonicalDataService.upsertRevenue(orgId, dbAccount.id, {
          externalId: normalised.entityExternalId,
          amount: normalised.data.amount ? String(Number(normalised.data.amount) / 100) : '0',
          status: normalised.data.status as string | undefined,
          transactionDate: normalised.data.createdAt ? new Date(normalised.data.createdAt as string) : undefined,
        });
        break;
    }

    console.log(`[GHL Webhook] Processed ${normalised.eventType} for account ${locationId}`);
  } catch (err) {
    console.error('[GHL Webhook] Error processing event:', err instanceof Error ? err.message : err);
  }
});

export default router;
