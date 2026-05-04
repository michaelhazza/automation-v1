// ---------------------------------------------------------------------------
// agentSpendCompletionHandler — main-app handler for `agent-spend-completion` queue
//
// Receives WorkerSpendCompletion from the IEE worker after it fills a
// merchant-hosted payment form (worker_hosted_form path only).
//
// Invariant 20 enforcement:
//   - May ONLY set provider_charge_id on a still-executed row (merchant_succeeded).
//   - May ONLY transition executed → failed on a still-executed row (merchant_failed).
//   - MUST NOT transition to succeeded — that is webhook-only.
//
// If the row has already left executed (Stripe webhook beat the worker):
//   - Trigger rejects the update; handler logs worker_completion_after_terminal
//     and drops silently (no error to the worker).
//
// Spec: tasks/builds/agentic-commerce/spec.md §8.4a, §10 invariant 20
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 11
// Invariants enforced: 20, 31, 38
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { eq, and, sql } from 'drizzle-orm';
import { agentCharges } from '../db/schema/agentCharges.js';
import { logger } from '../lib/logger.js';
import { logChargeTransition, withTrace } from '../lib/spendLogging.js';
import { getJobConfig } from '../config/jobConfig.js';
import { createWorker } from '../lib/createWorker.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import type { SpendCompletionPayload } from '../../shared/iee/actionSchema.js';

export const QUEUE = 'agent-spend-completion';

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function validatePayload(data: unknown): SpendCompletionPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.ledgerRowId !== 'string' || obj.ledgerRowId.length === 0) return null;
  if (obj.outcome !== 'merchant_succeeded' && obj.outcome !== 'merchant_failed') return null;
  if (obj.providerChargeId !== null && typeof obj.providerChargeId !== 'string') return null;
  if (obj.failureReason !== null && typeof obj.failureReason !== 'string') return null;
  if (typeof obj.completedAt !== 'string' || obj.completedAt.length === 0) return null;

  return obj as unknown as SpendCompletionPayload;
}

// ---------------------------------------------------------------------------
// Pure decision logic (invariant 20)
// ---------------------------------------------------------------------------

export type CompletionDecision =
  | { allowed: true; action: 'set_provider_charge_id' | 'transition_to_failed' }
  | { allowed: false; reason: 'already_terminal' | 'not_executed' };

/**
 * Pure decision: given a charge's current status and the completion outcome,
 * decide what the handler is permitted to do.
 *
 * Invariant 20: completion handler may only:
 *   (a) set provider_charge_id on a still-executed row (merchant_succeeded), OR
 *   (b) transition executed → failed on a still-executed row (merchant_failed).
 * MUST NOT transition to succeeded.
 */
export function decideCompletionAction(
  currentStatus: string,
  outcome: 'merchant_succeeded' | 'merchant_failed',
): CompletionDecision {
  if (currentStatus !== 'executed') {
    return { allowed: false, reason: 'already_terminal' };
  }
  return {
    allowed: true,
    action: outcome === 'merchant_succeeded' ? 'set_provider_charge_id' : 'transition_to_failed',
  };
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export async function registerAgentSpendCompletionHandler(boss: PgBoss): Promise<void> {
  const config = getJobConfig(QUEUE);

  await createWorker<Record<string, unknown>>({
    queue: QUEUE,
    boss,
    concurrency: 4,
    resolveOrgContext: () => null,
    handler: async (job) => {
      const payload = validatePayload(job.data);
      if (!payload) {
        logger.warn('agent_spend_completion.invalid_payload', {
          jobId: job.id,
          rawKeys: typeof job.data === 'object' && job.data !== null
            ? Object.keys(job.data as Record<string, unknown>)
            : typeof job.data,
        });
        return;
      }

      const { ledgerRowId, outcome, providerChargeId, failureReason } = payload;

      // Fetch the charge row to get the trace id for invariant 38.
      // No org-scoped GUC available in this job; use admin bypass + role switch.
      let chargeRow: { id: string; status: string; metadataJson: Record<string, unknown> | null; organisationId: string } | undefined;
      await withAdminConnection(
        { source: 'jobs.agentSpendCompletionHandler', reason: 'read charge row for completion' },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          await tx.execute(sql`SET LOCAL app.spend_caller = 'worker_completion'`);
          const rows = await tx
            .select({
              id: agentCharges.id,
              status: agentCharges.status,
              metadataJson: agentCharges.metadataJson,
              organisationId: agentCharges.organisationId,
            })
            .from(agentCharges)
            .where(eq(agentCharges.id, ledgerRowId))
            .limit(1);
          chargeRow = rows[0];
        },
      );

      if (!chargeRow) {
        logger.warn('agent_spend_completion.charge_not_found', {
          ledgerRowId,
          jobId: job.id,
        });
        return;
      }

      // Extract traceId from metadataJson if present (invariant 38).
      const traceId: string =
        (chargeRow.metadataJson?.traceId as string | undefined) ?? ledgerRowId;

      await withTrace(traceId, async () => {
        const decision = decideCompletionAction(chargeRow!.status, outcome);

        if (!decision.allowed) {
          // Stripe webhook beat the worker — drop silently per invariant 20.
          logger.info('agent_spend_completion.worker_completion_after_terminal', {
            ledgerRowId,
            currentStatus: chargeRow!.status,
            outcome,
            traceId,
            jobId: job.id,
          });
          return;
        }

        if (decision.action === 'set_provider_charge_id') {
          // Merchant succeeded: set provider_charge_id on still-executed row.
          // State remains 'executed' — webhook drives executed → succeeded.
          let result: { id: string }[] = [];
          await withAdminConnection(
            { source: 'jobs.agentSpendCompletionHandler', reason: 'set provider_charge_id', skipAudit: true },
            async (tx) => {
              await tx.execute(sql`SET LOCAL ROLE admin_role`);
              await tx.execute(sql`SET LOCAL app.spend_caller = 'worker_completion'`);
              // No status change here — trigger only permits provider_charge_id
              // and updated_at to change on a still-executed row (spec §5.1
              // worker-completion allowlist). Do NOT include last_transition_by
              // — it is in the disallowed list for the no-status path.
              result = await tx
                .update(agentCharges)
                .set({
                  providerChargeId: providerChargeId ?? null,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(agentCharges.id, ledgerRowId),
                  eq(agentCharges.status, 'executed'),
                ))
                .returning({ id: agentCharges.id });
            },
          );

          if (result.length === 0) {
            // Row left executed between our SELECT and this UPDATE (trigger blocked).
            logger.info('agent_spend_completion.worker_completion_after_terminal', {
              ledgerRowId,
              outcome,
              traceId,
              jobId: job.id,
              note: 'trigger_rejected_or_race',
            });
            return;
          }

          logChargeTransition({
            chargeId: ledgerRowId,
            from: 'executed',
            to: 'executed',
            reason: 'worker_completed',
            caller: 'worker_completion',
            traceId,
          });

          logger.info('agent_spend_completion.provider_charge_id_set', {
            ledgerRowId,
            providerChargeId,
            traceId,
          });
          return;
        }

        // decision.action === 'transition_to_failed'
        // Merchant failed: transition executed → failed.
        let result: { id: string }[] = [];
        await withAdminConnection(
          { source: 'jobs.agentSpendCompletionHandler', reason: 'transition to failed', skipAudit: true },
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE admin_role`);
            await tx.execute(sql`SET LOCAL app.spend_caller = 'worker_completion'`);
            result = await tx
              .update(agentCharges)
              .set({
                status: 'failed',
                failureReason: failureReason ?? 'merchant_failed',
                lastTransitionBy: 'worker_completion',
                updatedAt: new Date(),
              })
              .where(and(
                eq(agentCharges.id, ledgerRowId),
                eq(agentCharges.status, 'executed'),
              ))
              .returning({ id: agentCharges.id });
          },
        );

        if (result.length === 0) {
          // Row left executed between our SELECT and this UPDATE (trigger blocked).
          logger.info('agent_spend_completion.worker_completion_after_terminal', {
            ledgerRowId,
            outcome,
            traceId,
            jobId: job.id,
            note: 'trigger_rejected_or_race',
          });
          return;
        }

        logChargeTransition({
          chargeId: ledgerRowId,
          from: 'executed',
          to: 'failed',
          reason: failureReason ?? 'merchant_failed',
          caller: 'worker_completion',
          traceId,
        });

        logger.info('agent_spend_completion.transition_to_failed', {
          ledgerRowId,
          failureReason,
          traceId,
        });
      });
    },
  });

  logger.info('agent_spend_completion.handler_registered', {
    retryLimit: config.retryLimit,
    deadLetter: 'deadLetter' in config ? config.deadLetter : undefined,
  });
}
