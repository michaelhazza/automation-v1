// ---------------------------------------------------------------------------
// stripeAgentWebhookService — async processor for Stripe agent-charge webhooks
//
// Called by stripeAgentWebhook.ts route after signature verification + dedupe.
//
// Responsibilities:
//   1. Resolve agent_charges row by provider_charge_id.
//   2. Verify tenant match (organisation_id + subaccount_id).
//   3. Secondary dedupe: check last_transition_event_id (invariant 37).
//   4. Invariant 24: validate webhook amount/currency against ledger row.
//   5. Apply state transitions including failed → succeeded carve-out (invariant 33).
//   6. Out-of-order webhook compensation (deterministic implied transitions).
//   7. Set last_transition_by = 'stripe_webhook' + last_transition_event_id.
//   8. Emit logChargeTransition per invariant 31 with traceId per invariant 38.
//   9. TODO(Chunk 13): call agentSpendAggregateService.upsertAgentSpend on succeed/refund.
//
// Monotonicity: enforced at app layer (assertValidAgentChargeTransition) AND
// DB layer (trigger). Never rolls back.
//
// Spec: tasks/builds/agentic-commerce/spec.md §7.5
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 12
// Invariants: 20, 24, 31, 33, 37, 38, 40
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logChargeTransition, withTrace } from '../lib/spendLogging.js';
import { logger } from '../lib/logger.js';
import { recordIncident } from './incidentIngestor.js';
import { agentSpendAggregateService } from './agentSpendAggregateService.js';
import {
  assertValidAgentChargeTransition,
  isAllowedAgentChargeTransition,
  InvalidAgentChargeTransitionError,
} from '../../shared/stateMachineGuards.js';
import { validateAmountForCurrency } from './chargeRouterServicePure.js';
import type { AgentChargeStatus } from '../../shared/stateMachineGuards.js';

// ---------------------------------------------------------------------------
// Input + internal types
// ---------------------------------------------------------------------------

export interface StripeAgentWebhookEventInput {
  event: Record<string, unknown>;
  stripeEventId: string;
  connectionId: string;
  organisationId: string;
  subaccountId: string | null;
  /** Internal retry count for out-of-order re-enqueue logic (default 0). */
  _retryCount?: number;
}

/** Minimal projection of an agent_charges row for webhook processing. */
interface AgentChargeRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  status: AgentChargeStatus;
  amountMinor: number;
  currency: string;
  failureReason: string | null;
  lastTransitionEventId: string | null;
  kind: string;
  metadataJson: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Stripe event-type → target transition resolution
// ---------------------------------------------------------------------------

/**
 * Classify a Stripe event type into the ledger transition it implies.
 * Returns null for unrecognised event types (no-op).
 */
function resolveTargetStatus(
  eventType: string,
): AgentChargeStatus | null {
  switch (eventType) {
    case 'charge.succeeded':
    case 'payment_intent.succeeded':
      return 'succeeded';
    case 'charge.failed':
    case 'payment_intent.payment_failed':
      return 'failed';
    case 'charge.dispute.created':
      return 'disputed';
    case 'charge.dispute.closed': {
      // dispute closed — the status in the dispute object determines refunded vs succeeded
      // Caller must inspect dispute.status to distinguish 'lost' → refunded vs 'won' → succeeded.
      // We return null here and handle inline in applyTransition.
      return null;
    }
    case 'charge.refunded':
      return 'refunded';
    default:
      return null;
  }
}

/**
 * For charge.dispute.closed events, determine the ledger target.
 * Stripe dispute status 'lost' → refunded; 'won' → succeeded.
 */
function resolveDisputeCloseTarget(
  event: Record<string, unknown>,
): AgentChargeStatus | null {
  const disputeObject = (event['data'] as Record<string, unknown> | undefined)?.['object'] as Record<string, unknown> | undefined;
  const disputeStatus = disputeObject?.['status'] as string | undefined;
  if (disputeStatus === 'lost') return 'refunded';
  if (disputeStatus === 'won') return 'succeeded';
  return null;
}

// ---------------------------------------------------------------------------
// Out-of-order compensation: deterministic implied transitions
// ---------------------------------------------------------------------------

/**
 * Given current row status and target status, returns the sequence of
 * intermediate transitions to apply atomically, or null if ambiguous.
 *
 * Only handles sequences whose every step is unambiguous per §4.
 * Returns an array of [from, to] pairs in application order.
 */
function deriveCompensationSequence(
  currentStatus: AgentChargeStatus,
  targetStatus: AgentChargeStatus,
): Array<[AgentChargeStatus, AgentChargeStatus]> | null {
  // Direct allowed transitions — no compensation needed
  if (isAllowedAgentChargeTransition(currentStatus, targetStatus, 'stripe_webhook')) {
    return [[currentStatus, targetStatus]];
  }

  // Deterministic two-step sequences (out-of-order compensation)
  // executed → succeeded → refunded
  if (currentStatus === 'executed' && targetStatus === 'refunded') {
    return [
      ['executed', 'succeeded'],
      ['succeeded', 'refunded'],
    ];
  }
  // executed → succeeded → disputed
  if (currentStatus === 'executed' && targetStatus === 'disputed') {
    return [
      ['executed', 'succeeded'],
      ['succeeded', 'disputed'],
    ];
  }

  // No unambiguous path
  return null;
}

// ---------------------------------------------------------------------------
// Core processor
// ---------------------------------------------------------------------------

/**
 * Process a verified Stripe webhook event for agent-initiated charges.
 * This is the async processor called after the route has already acked HTTP 200.
 *
 * Invariant 37 (multi-layer dedupe):
 *   Primary dedupe already applied in the route handler (stripeAgentDedupeStore).
 *   This function applies the secondary dedupe (last_transition_event_id row check)
 *   and relies on the tertiary DB trigger for monotonicity.
 *
 * Invariant 38 (traceId threading):
 *   traceId is extracted from agent_charges.metadata_json.traceId if present,
 *   then threaded through withTrace() so all logChargeTransition calls inherit it.
 */
export async function processStripeAgentWebhookEvent(
  input: StripeAgentWebhookEventInput,
): Promise<void> {
  const { event, stripeEventId, organisationId } = input;

  const eventType = event['type'] as string | undefined;
  if (!eventType) {
    logger.warn('stripe_agent_webhook.missing_event_type', { stripeEventId });
    return;
  }

  // Extract provider_charge_id from the Stripe event payload.
  const providerChargeId = extractProviderChargeId(event);
  if (!providerChargeId) {
    logger.warn('stripe_agent_webhook.no_provider_charge_id', { stripeEventId, eventType });
    return;
  }

  // Resolve charge row by provider_charge_id under admin connection (cross-org lookup).
  const chargeRow: AgentChargeRow | null = await withAdminConnection(
    { source: 'services.stripeAgentWebhookService', reason: 'Resolve charge row by provider_charge_id', skipAudit: true },
    async (tx): Promise<AgentChargeRow | null> => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      const rows = (await tx.execute(sql`
        SELECT
          id, organisation_id, subaccount_id, status,
          amount_minor, currency, failure_reason,
          last_transition_event_id, kind, metadata_json
        FROM agent_charges
        WHERE provider_charge_id = ${providerChargeId}
        LIMIT 1
      `)) as unknown as Array<Record<string, unknown>> | { rows?: Array<Record<string, unknown>> };

      const arr = Array.isArray(rows)
        ? rows
        : Array.isArray((rows as { rows?: unknown[] })?.rows)
          ? (rows as { rows: Array<Record<string, unknown>> }).rows
          : [];

      if (arr.length === 0) return null;
      const r = arr[0];
      return {
        id: r['id'] as string,
        organisationId: r['organisation_id'] as string,
        subaccountId: (r['subaccount_id'] as string | null) ?? null,
        status: r['status'] as AgentChargeStatus,
        amountMinor: Number(r['amount_minor']),
        currency: r['currency'] as string,
        failureReason: (r['failure_reason'] as string | null) ?? null,
        lastTransitionEventId: (r['last_transition_event_id'] as string | null) ?? null,
        kind: (r['kind'] as string) ?? 'outbound_charge',
        metadataJson: (r['metadata_json'] as Record<string, unknown> | null) ?? null,
      };
    },
  );

  if (!chargeRow) {
    recordIncident({
      source: 'job',
      summary: `Stripe agent webhook: no agent_charges row found for provider_charge_id=${providerChargeId}`,
      errorCode: 'reconciliation_mismatch',
      fingerprintOverride: `webhook:stripe-agent:no_row:${providerChargeId}`,
      errorDetail: { stripeEventId, providerChargeId, organisationId },
    });
    return;
  }

  // Thread traceId through async context (invariant 38).
  const traceId = chargeRow.metadataJson?.['traceId'] as string | undefined;

  await withTrace(traceId ?? stripeEventId, async () => {
    await processWithTrace(input, chargeRow!, providerChargeId, eventType);
  });
}

async function processWithTrace(
  input: StripeAgentWebhookEventInput,
  chargeRow: AgentChargeRow,
  providerChargeId: string,
  eventType: string,
): Promise<void> {
  const { event, stripeEventId, organisationId, subaccountId } = input;

  // Step 2: Verify tenant match.
  const tenantOrgMatch = chargeRow.organisationId === organisationId;
  const tenantSubMatch = subaccountId === null
    ? chargeRow.subaccountId === null
    : chargeRow.subaccountId === subaccountId;

  if (!tenantOrgMatch || !tenantSubMatch) {
    recordIncident({
      source: 'job',
      summary: `Stripe agent webhook: tenant mismatch for charge ${chargeRow.id} (expected org=${organisationId}, got org=${chargeRow.organisationId})`,
      errorCode: 'reconciliation_mismatch',
      fingerprintOverride: `webhook:stripe-agent:tenant_mismatch:${chargeRow.id}`,
      errorDetail: { stripeEventId, chargeId: chargeRow.id, webhookOrg: organisationId, rowOrg: chargeRow.organisationId },
    });
    return;
  }

  // Step 3 (Secondary dedupe — invariant 37): check last_transition_event_id.
  if (chargeRow.lastTransitionEventId === stripeEventId) {
    logger.info('stripe_agent_webhook.already_applied', { stripeEventId, chargeId: chargeRow.id });
    return;
  }

  // Resolve target status from event type.
  let targetStatus: AgentChargeStatus | null;
  if (eventType === 'charge.dispute.closed') {
    targetStatus = resolveDisputeCloseTarget(event);
  } else {
    targetStatus = resolveTargetStatus(eventType);
  }

  if (targetStatus === null) {
    logger.info('stripe_agent_webhook.unrecognised_event_type', { eventType, stripeEventId, chargeId: chargeRow.id });
    return;
  }

  // Step 4 (Invariant 24): Amount/currency check for succeeded events.
  // Hold in executed and fire critical alert on mismatch.
  if (targetStatus === 'succeeded') {
    const webhookAmount = extractWebhookAmount(event);
    const webhookCurrency = extractWebhookCurrency(event);

    if (webhookAmount !== null && webhookCurrency !== null) {
      const amountValidation = validateAmountForCurrency(webhookAmount, webhookCurrency);
      if (!amountValidation.valid) {
        recordIncident({
          source: 'job',
          summary: `Stripe agent webhook: invariant 24 — ambiguous exponent for currency ${webhookCurrency} on charge ${chargeRow.id}`,
          errorCode: 'ledger_amount_mismatch',
          fingerprintOverride: `webhook:stripe-agent:amount_mismatch:${chargeRow.id}`,
          errorDetail: { stripeEventId, chargeId: chargeRow.id, webhookCurrency, reason: amountValidation.reason },
        });
        return; // Hold row in executed
      }

      const currencyMismatch = webhookCurrency.toUpperCase() !== chargeRow.currency.toUpperCase();
      const amountMismatch = webhookAmount !== chargeRow.amountMinor;

      if (currencyMismatch || amountMismatch) {
        recordIncident({
          source: 'job',
          summary: `Stripe agent webhook: invariant 24 — amount/currency mismatch on charge ${chargeRow.id}`,
          errorCode: 'ledger_amount_mismatch',
          fingerprintOverride: `webhook:stripe-agent:amount_mismatch:${chargeRow.id}`,
          errorDetail: {
            stripeEventId,
            chargeId: chargeRow.id,
            webhookAmount,
            webhookCurrency,
            rowAmount: chargeRow.amountMinor,
            rowCurrency: chargeRow.currency,
          },
        });
        return; // Hold row in executed
      }
    }
  }

  // Derive the transition sequence (direct or out-of-order compensation).
  const sequence = deriveCompensationSequence(chargeRow.status, targetStatus);

  if (sequence === null) {
    // Ambiguous or impossible path — re-enqueue logic handled by caller.
    // Log + attempt re-enqueue up to 3 times, then fire anomaly alert.
    const retryCount = input._retryCount ?? 0;
    if (retryCount < 3) {
      logger.warn('stripe_agent_webhook.out_of_order_ambiguous', {
        stripeEventId,
        chargeId: chargeRow.id,
        currentStatus: chargeRow.status,
        targetStatus,
        retryCount,
      });
      // Schedule re-enqueue with 60s delay (pg-boss send would go here in prod).
      // For now, log at warn — the caller re-enqueue mechanism is outside scope for this chunk.
      return;
    }

    // After 3 retries: fire anomaly alert.
    recordIncident({
      source: 'job',
      summary: `Stripe agent webhook: webhook_ordering_anomaly — no unambiguous path from ${chargeRow.status} to ${targetStatus} for charge ${chargeRow.id}`,
      errorCode: 'webhook_ordering_anomaly',
      fingerprintOverride: `webhook:stripe-agent:ordering_anomaly:${chargeRow.id}`,
      errorDetail: { stripeEventId, chargeId: chargeRow.id, currentStatus: chargeRow.status, targetStatus },
    });
    return;
  }

  // Validate the first step via app-layer guard before touching the DB.
  const [firstFrom, firstTo] = sequence[0];
  try {
    assertValidAgentChargeTransition(firstFrom, firstTo, { callerIdentity: 'stripe_webhook' });
  } catch (err) {
    if (err instanceof InvalidAgentChargeTransitionError) {
      logger.warn('transition_after_terminal', {
        stripeEventId,
        chargeId: chargeRow.id,
        from: firstFrom,
        to: firstTo,
        caller: 'stripe_webhook',
      });
      return;
    }
    throw err;
  }

  // Apply transition(s) atomically.
  const isCompensated = sequence.length > 1;
  await applyTransitionSequence({
    chargeRow,
    sequence,
    isCompensated,
    stripeEventId,
    targetStatus,
  });
}

// ---------------------------------------------------------------------------
// DB write
// ---------------------------------------------------------------------------

interface ApplyTransitionInput {
  chargeRow: AgentChargeRow;
  sequence: Array<[AgentChargeStatus, AgentChargeStatus]>;
  isCompensated: boolean;
  stripeEventId: string;
  targetStatus: AgentChargeStatus;
}

async function applyTransitionSequence(args: ApplyTransitionInput): Promise<void> {
  const { chargeRow, sequence, isCompensated, stripeEventId, targetStatus } = args;
  const now = new Date();
  const finalStatus = sequence[sequence.length - 1][1];

  await withAdminConnection(
    { source: 'services.stripeAgentWebhookService.applyTransition', reason: 'Apply webhook state transition', skipAudit: true },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      await tx.execute(sql`SET LOCAL app.spend_caller = 'stripe_webhook'`);

      // Build settled_at column value for terminal transitions.
      const isTerminal = finalStatus === 'succeeded' || finalStatus === 'failed' ||
        finalStatus === 'refunded' || finalStatus === 'disputed';

      const updated = (await tx.execute(sql`
        UPDATE agent_charges
        SET
          status = ${finalStatus},
          last_transition_by = 'stripe_webhook',
          last_transition_event_id = ${stripeEventId},
          updated_at = ${now.toISOString()}::timestamptz
          ${isTerminal ? sql`, settled_at = COALESCE(settled_at, ${now.toISOString()}::timestamptz)` : sql``}
        WHERE id = ${chargeRow.id}::uuid
          AND last_transition_event_id IS DISTINCT FROM ${stripeEventId}
        RETURNING id, status
      `)) as unknown as Array<{ id: string; status: string }> | { rows?: Array<{ id: string; status: string }> };

      const updatedRows = Array.isArray(updated)
        ? updated
        : Array.isArray((updated as { rows?: unknown[] })?.rows)
          ? (updated as { rows: Array<{ id: string; status: string }> }).rows
          : [];

      if (updatedRows.length === 0) {
        // Row was already processed (secondary dedupe hit at DB level) or trigger rejected.
        logger.info('stripe_agent_webhook.transition_noop', {
          chargeId: chargeRow.id,
          stripeEventId,
          targetStatus: finalStatus,
        });
        return;
      }

      // Emit structured log per invariant 31 for each step in the sequence.
      if (isCompensated) {
        logger.info('webhook_ordering_compensated', {
          chargeId: chargeRow.id,
          sequence: sequence.map(([f, t]) => `${f} → ${t}`).join(', '),
          stripeEventId,
        });
        // Log each implied intermediate step.
        for (const [stepFrom, stepTo] of sequence) {
          logChargeTransition({
            chargeId: chargeRow.id,
            from: stepFrom,
            to: stepTo,
            reason: stepTo === targetStatus ? 'webhook_' + getEventLabel(targetStatus) : 'webhook_ordering_compensated',
            caller: 'stripe_webhook',
            lastEventId: stripeEventId,
          });
        }
      } else {
        logChargeTransition({
          chargeId: chargeRow.id,
          from: chargeRow.status,
          to: finalStatus,
          reason: 'webhook_' + getEventLabel(finalStatus),
          caller: 'stripe_webhook',
          lastEventId: stripeEventId,
        });
      }

      // Aggregate spend rollups on terminal transitions (invariant 27).
      // Fires outside the admin tx (the aggregate service uses its own transaction).
      if (finalStatus === 'succeeded' || finalStatus === 'refunded') {
        // Fire-and-forget: aggregate failures must not fail the webhook ack.
        agentSpendAggregateService.upsertAgentSpend(chargeRow.id, finalStatus).catch((aggErr) => {
          logger.error('stripe_agent_webhook.aggregate_upsert_failed', {
            chargeId: chargeRow.id,
            finalStatus,
            error: aggErr instanceof Error ? aggErr.message : String(aggErr),
          });
        });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEventLabel(status: AgentChargeStatus): string {
  switch (status) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'refunded': return 'refunded';
    case 'disputed': return 'disputed';
    default: return status;
  }
}

/**
 * Extract provider_charge_id from a Stripe event payload.
 * Supports charge objects and payment_intent objects.
 */
function extractProviderChargeId(event: Record<string, unknown>): string | null {
  const dataObject = (event['data'] as Record<string, unknown> | undefined)?.['object'] as Record<string, unknown> | undefined;
  if (!dataObject) return null;

  const objectType = dataObject['object'] as string | undefined;

  if (objectType === 'charge') {
    return (dataObject['id'] as string | undefined) ?? null;
  }
  if (objectType === 'payment_intent') {
    // For payment intents, the charge id is in latest_charge or charges.data[0].id
    const latestCharge = dataObject['latest_charge'] as string | undefined;
    if (latestCharge) return latestCharge;
    const charges = (dataObject['charges'] as Record<string, unknown> | undefined);
    const chargeData = charges?.['data'] as Array<Record<string, unknown>> | undefined;
    if (chargeData && chargeData.length > 0) return chargeData[0]['id'] as string ?? null;
  }
  if (objectType === 'dispute') {
    return (dataObject['charge'] as string | undefined) ?? null;
  }

  // Fallback: try 'id' directly (some event types use top-level id as the charge)
  return (dataObject['id'] as string | undefined) ?? null;
}

/**
 * Extract the amount in minor units from a Stripe event payload.
 * Returns null if not present (webhook may not carry the amount).
 */
function extractWebhookAmount(event: Record<string, unknown>): number | null {
  const dataObject = (event['data'] as Record<string, unknown> | undefined)?.['object'] as Record<string, unknown> | undefined;
  if (!dataObject) return null;
  const amount = dataObject['amount'] as number | undefined;
  return typeof amount === 'number' ? amount : null;
}

/**
 * Extract the currency from a Stripe event payload (uppercase ISO 4217).
 */
function extractWebhookCurrency(event: Record<string, unknown>): string | null {
  const dataObject = (event['data'] as Record<string, unknown> | undefined)?.['object'] as Record<string, unknown> | undefined;
  if (!dataObject) return null;
  const currency = dataObject['currency'] as string | undefined;
  return currency ? currency.toUpperCase() : null;
}
