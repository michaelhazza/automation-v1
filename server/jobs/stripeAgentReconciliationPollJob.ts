/**
 * stripeAgentReconciliationPollJob — polls Stripe for `executed` agent charges
 * that haven't received a webhook confirmation within 30 minutes.
 *
 * Runs every 5-10 minutes via pg-boss (registered in queueService.startMaintenanceJobs).
 *
 * If Stripe returns a terminal state for a charge, drives the equivalent transition.
 * On poll failure: log; row stays `executed`; surfaces in dashboard "pending confirmation";
 * warning alert fires.
 *
 * Cross-org sweep contract:
 *   - Uses `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass RLS.
 *
 * Concurrency: pg-boss deduplicates across instances natively; teamSize=1.
 *
 * Spec: tasks/builds/agentic-commerce/spec.md §16.6
 * Plan: tasks/builds/agentic-commerce/plan.md § Chunk 12
 */

import axios from 'axios';
import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logChargeTransition } from '../lib/spendLogging.js';
import { logger } from '../lib/logger.js';
import { recordIncident } from '../services/incidentIngestor.js';
import {
  deriveReconciliationCutoff,
  decideReconciliationPoll,
  mapStripeChargeStatusToTarget,
  type ReconciliationPollSummary,
  type ExecutedCandidateRow,
} from './stripeAgentReconciliationPollJobPure.js';
import type { AgentChargeStatus } from '../../shared/stateMachineGuards.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_TIMEOUT_MS = 10_000;

/**
 * Retrieve a Stripe charge by its charge ID using the connection's SPT/access token.
 * Returns the Stripe charge status string, or throws on HTTP error.
 */
async function fetchStripeChargeStatus(
  providerChargeId: string,
  sptToken: string,
): Promise<string> {
  const response = await axios.get(`${STRIPE_API_BASE}/charges/${providerChargeId}`, {
    headers: { Authorization: `Bearer ${sptToken}` },
    timeout: STRIPE_API_TIMEOUT_MS,
  });
  const data = response.data as { status?: string };
  return data.status ?? 'unknown';
}


export async function runStripeAgentReconciliationPoll(): Promise<ReconciliationPollSummary> {
  const started = Date.now();
  const now = new Date();
  const cutoff = deriveReconciliationCutoff(now);

  let scanned = 0;
  let polled = 0;
  let transitioned = 0;
  let skipped = 0;
  let pollErrors = 0;

  await withAdminConnection(
    {
      source: 'jobs.stripeAgentReconciliationPollJob',
      reason: 'Sweep executed agent_charges past 30-min threshold for Stripe poll',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const candidates = (await tx.execute(sql`
        SELECT
          ac.id,
          ac.status,
          ac.executed_at,
          ac.provider_charge_id,
          ac.organisation_id,
          ac.subaccount_id,
          ic.id AS connection_id,
          ic.access_token
        FROM agent_charges ac
        JOIN integration_connections ic
          ON ic.organisation_id = ac.organisation_id
          AND ic.provider_type = 'stripe_agent'
          AND ic.connection_status = 'active'
          AND (
            ic.subaccount_id = ac.subaccount_id
            OR (ic.subaccount_id IS NULL AND ac.subaccount_id IS NULL)
          )
        WHERE ac.status = 'executed'
          AND ac.executed_at < ${cutoff.toISOString()}::timestamptz
          AND ac.provider_charge_id IS NOT NULL
        LIMIT 500
      `)) as unknown as Array<Record<string, unknown>> | { rows?: Array<Record<string, unknown>> };

      const rows: Array<Record<string, unknown>> = Array.isArray(candidates)
        ? candidates
        : Array.isArray((candidates as { rows?: unknown[] })?.rows)
          ? (candidates as { rows: Array<Record<string, unknown>> }).rows
          : [];

      scanned = rows.length;

      for (const raw of rows) {
        const candidate: ExecutedCandidateRow = {
          id: raw['id'] as string,
          status: raw['status'] as string,
          executedAt: raw['executed_at'] ? new Date(raw['executed_at'] as string) : null,
          providerChargeId: (raw['provider_charge_id'] as string | null) ?? null,
          organisationId: raw['organisation_id'] as string,
          subaccountId: (raw['subaccount_id'] as string | null) ?? null,
        };

        const decision = decideReconciliationPoll(candidate, cutoff);

        if (!decision.shouldPoll) {
          skipped += 1;
          continue;
        }

        polled += 1;

        const sptToken = (raw['access_token'] as string | null) ?? null;
        if (!sptToken) {
          logger.warn('reconciliation_poll.no_spt_token', { chargeId: candidate.id });
          pollErrors += 1;
          continue;
        }

        let stripeStatus: string;
        try {
          stripeStatus = await fetchStripeChargeStatus(candidate.providerChargeId!, sptToken);
        } catch (err) {
          logger.warn('reconciliation_poll.stripe_api_failed', {
            chargeId: candidate.id,
            providerChargeId: candidate.providerChargeId,
            error: err instanceof Error ? err.message : String(err),
          });
          recordIncident({
            source: 'job',
            summary: `Reconciliation poll: Stripe API failed for charge ${candidate.id}`,
            errorCode: 'reconciliation_poll_failed',
            fingerprintOverride: `reconciliation_poll:stripe_api_failed:${candidate.id}`,
            errorDetail: {
              chargeId: candidate.id,
              providerChargeId: candidate.providerChargeId,
              error: err instanceof Error ? err.message : String(err),
            },
          });
          pollErrors += 1;
          continue;
        }

        const targetStatus = mapStripeChargeStatusToTarget(stripeStatus);
        if (!targetStatus) {
          // Stripe reports 'pending' or unknown — row stays executed; retry on next poll.
          logger.info('reconciliation_poll.not_terminal', {
            chargeId: candidate.id,
            stripeStatus,
          });
          continue;
        }

        try {
          await tx.execute(sql`SET LOCAL app.spend_caller = 'stripe_webhook'`);
          const updated = (await tx.execute(sql`
            UPDATE agent_charges
            SET
              status = ${targetStatus},
              last_transition_by = 'stripe_webhook',
              updated_at = ${now.toISOString()}::timestamptz,
              settled_at = COALESCE(settled_at, ${now.toISOString()}::timestamptz)
            WHERE id = ${candidate.id}::uuid
              AND status = 'executed'
            RETURNING id
          `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

          const updatedRows = Array.isArray(updated)
            ? updated
            : Array.isArray((updated as { rows?: unknown[] })?.rows)
              ? (updated as { rows: Array<{ id: string }> }).rows
              : [];

          if (updatedRows.length > 0) {
            transitioned += 1;
            logChargeTransition({
              chargeId: candidate.id,
              from: 'executed',
              to: targetStatus as AgentChargeStatus,
              reason: 'reconciliation_poll',
              caller: 'stripe_webhook',
            });
          }
        } catch (err) {
          logger.warn('reconciliation_poll.update_failed', {
            chargeId: candidate.id,
            targetStatus,
            error: err instanceof Error ? err.message : String(err),
          });
          pollErrors += 1;
        }
      }
    },
  );

  const summary: ReconciliationPollSummary = {
    scanned,
    polled,
    transitioned,
    skipped,
    pollErrors,
    durationMs: Date.now() - started,
  };

  logger.info('reconciliation_poll_sweep', { ...summary });

  return summary;
}
