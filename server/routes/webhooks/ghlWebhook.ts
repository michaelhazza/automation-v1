import { Router, raw } from 'express';
import { db } from '../../db/index.js';
import { connectorConfigs, canonicalAccounts } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { adapters } from '../../adapters/index.js';
import { canonicalDataService } from '../../services/canonicalDataService.js';
import { fromOrgId } from '../../services/principal/fromOrgId.js';
import { webhookDedupeStore } from '../../lib/webhookDedupe.js';
import { recordGhlMutation, dispatchWebhookSideEffects } from '../../services/ghlWebhookMutationsService.js';
import type { GhlEventEnvelope } from '../../services/ghlWebhookMutationsPure.js';
import { recordIncident } from '../../services/incidentIngestor.js';

const router = Router();

/**
 * GHL Webhook endpoint — unauthenticated (GHL cannot provide JWT tokens).
 * Security: HMAC-SHA256 signature verification against connector_configs.webhook_secret.
 *
 * Pattern follows server/routes/githubWebhook.ts
 *
 * Uses raw body parser to capture the original bytes for HMAC verification.
 * The JSON body is parsed separately after signature validation.
 */
router.post('/api/webhooks/ghl', raw({ type: 'application/json' }), async (req, res) => {
  // req.body is a Buffer when using raw() parser
  const rawBody = req.body as Buffer;
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Agency lifecycle events (INSTALL/UNINSTALL/LocationCreate/LocationUpdate) carry
  // webhookId + companyId but no meaningful locationId. Handle these synchronously
  // before the location-scoped flow so that §5.4 dedupe ordering is enforced:
  // side effects FIRST, then mark dedupe, then respond.
  const eventType = event.type as string | undefined;
  const webhookId = event.webhookId as string | undefined;
  const companyId = event.companyId as string | undefined;
  const lifecycleTypes = new Set(['INSTALL', 'UNINSTALL', 'LocationCreate', 'LocationUpdate']);

  if (eventType && webhookId && companyId && lifecycleTypes.has(eventType)) {
    // §5.4 hard invariant: side effects FIRST, dedupe mark only on success.
    // Do not call isDuplicate before dispatch — a 503 must leave the dedupe store
    // unmarked so GHL will re-deliver on retry.
    let dispatchResult: { statusCode: 200 | 503 };
    try {
      dispatchResult = await dispatchWebhookSideEffects({
        type: eventType,
        webhookId,
        companyId,
        locationId: event.locationId as string | undefined,
        installType: event.installType as string | undefined,
      });
    } catch {
      res.status(503).json({ error: 'Side effect dispatch failed' });
      return;
    }

    if (dispatchResult.statusCode === 503) {
      res.status(503).json({ error: 'Upstream unavailable — retry' });
      return;
    }

    // Side effects succeeded — mark dedupe, then ack
    webhookDedupeStore.isDuplicate(webhookId);
    res.status(200).json({ received: true });
    return;
  }

  const locationId = event.locationId as string | undefined;
  if (!locationId) {
    res.status(400).json({ error: 'Missing locationId' });
    return;
  }

  // Find the connector config by matching the locationId to a canonical account
  let config;
  let dbAccount;
  try {
    const [result] = await db
      .select({ config: connectorConfigs, account: canonicalAccounts })
      .from(canonicalAccounts)
      .innerJoin(connectorConfigs, eq(connectorConfigs.id, canonicalAccounts.connectorConfigId))
      .where(and(
        eq(canonicalAccounts.externalId, locationId),
        eq(connectorConfigs.connectorType, 'ghl')
      ))
      .limit(1);

    if (!result) {
      console.warn(`[GHL Webhook] No connector config found for locationId ${locationId}`);
      res.status(200).json({ received: true });
      return;
    }
    config = result.config;
    dbAccount = result.account;
  } catch (err) {
    console.error('[GHL Webhook] DB lookup failed:', err instanceof Error ? err.message : err);

    // Surface to the System Monitor so the agent can triage repeated failures.
    // fingerprintOverride pins the dedup key; stack-derived fingerprinting is
    // unreliable inside webhook handlers because the failure surface depends on
    // adapter internals we don't control.
    recordIncident({
      source: 'route',
      summary: `GHL webhook DB lookup failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      errorCode: 'webhook_handler_failed',
      stack: err instanceof Error ? err.stack : undefined,
      fingerprintOverride: 'webhook:ghl:db_lookup_failed',
      errorDetail: { locationId },
    });

    res.status(500).json({ error: 'Internal error' });
    return;
  }

  // Verify HMAC signature if webhook secret is configured
  if (config.webhookSecret) {
    const signature = req.headers['x-ghl-signature'] as string | undefined;
    if (!signature) {
      console.warn('[GHL Webhook] Missing signature header, rejecting');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    const adapter = adapters.ghl;
    if (!adapter?.webhook?.verifySignature(rawBody, signature, config.webhookSecret)) {
      console.warn('[GHL Webhook] Invalid signature, rejecting');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } else {
    console.warn(`[GHL Webhook] No webhook secret configured for connector ${config.id} — processing without HMAC verification`);
  }

  // Ack after signature verification
  res.status(200).json({ received: true });

  // Process the event asynchronously (response already sent)
  try {
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

    // Deduplicate — skip if already processed
    if (normalised.externalEventId && webhookDedupeStore.isDuplicate(normalised.externalEventId)) {
      console.log(`[GHL Webhook] Skipping duplicate event ${normalised.externalEventId}`);
      return;
    }

    const orgId = config.organisationId;
    const principal = fromOrgId(orgId, dbAccount.subaccountId ?? undefined);

    switch (normalised.entityType) {
      case 'contact':
        await canonicalDataService.upsertContact(principal, dbAccount.id, {
          externalId: normalised.entityExternalId,
          firstName: normalised.data.firstName as string | undefined,
          lastName: normalised.data.lastName as string | undefined,
          email: normalised.data.email as string | undefined,
          phone: normalised.data.phone as string | undefined,
          tags: normalised.data.tags as string[] | undefined,
        });
        break;

      case 'opportunity':
        await canonicalDataService.upsertOpportunity(principal, dbAccount.id, {
          externalId: normalised.entityExternalId,
          name: normalised.data.name as string | undefined,
          stage: normalised.data.pipelineStageId as string | undefined,
          value: normalised.data.monetaryValue ? String(normalised.data.monetaryValue) : undefined,
          status: normalised.data.status as string | undefined,
        });
        break;

      case 'conversation':
        await canonicalDataService.upsertConversation(principal, dbAccount.id, {
          externalId: normalised.entityExternalId,
          status: normalised.data.status as string | undefined,
          messageCount: normalised.data.messageCount as number | undefined,
          lastMessageAt: normalised.data.lastMessageDate ? new Date(normalised.data.lastMessageDate as string) : undefined,
        });
        break;

      case 'revenue':
        await canonicalDataService.upsertRevenue(principal, dbAccount.id, {
          externalId: normalised.entityExternalId,
          amount: normalised.data.amount ? String(Number(normalised.data.amount) / 100) : '0',
          status: normalised.data.status as string | undefined,
          transactionDate: normalised.data.createdAt ? new Date(normalised.data.createdAt as string) : undefined,
        });
        break;

      case 'account':
        // INSTALL / UNINSTALL / LocationCreate / LocationUpdate — no canonical
        // row upsert here (location lifecycle is materialised via the
        // listAccounts poll path). The mutation writer below records it.
        break;
    }

    // Record the mutation row for Staff Activity Pulse (§2.0b). Runs AFTER
    // the canonical upsert so the mutation log is always in sync with
    // downstream state. Safe no-op when the event doesn't map to a mutation.
    const mutationResult = await recordGhlMutation({
      organisationId: orgId,
      subaccountId: dbAccount.subaccountId,
      event: event as GhlEventEnvelope,
    });
    if (mutationResult.status === 'error') {
      console.warn(
        `[GHL Webhook] Mutation write failed for ${normalised.eventType} (${locationId}): ${mutationResult.error}`,
      );
    } else if (mutationResult.status === 'skipped_no_subaccount') {
      console.warn(
        `[GHL Webhook] Account ${locationId} has no subaccount mapping — skipping mutation ${mutationResult.mutationType}`,
      );
    }

    console.log(`[GHL Webhook] Processed ${normalised.eventType} for account ${locationId}`);
  } catch (err) {
    console.error(`[GHL Webhook] Error processing event for account ${locationId}:`, err instanceof Error ? err.message : err);
  }
});

export default router;
