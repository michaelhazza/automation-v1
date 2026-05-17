/**
 * operatorSessionDispatchNextChainLinkHandler — dispatches the next chain link.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §7.3
 *
 * Reads the parent agent_run status; gates on the allowed-predecessor set for
 * the declared reason; then calls operatorManagedBackend.dispatch().
 *
 * Backoff retry (per spec §7.3):
 *   - 1st retry: startAfter 60s (1 min)
 *   - 2nd retry: startAfter 300s (5 min)
 *   - 3rd retry: startAfter 900s (15 min)
 *
 * Idempotency:
 *   - Status 'cancelled' → no-op (cancel-vs-dispatch invariant).
 *   - Status not in predecessor allow-list for the reason → no-op.
 *   - 'permanent' | 'auth' | 'profile_corruption' error classes → bypass retry.
 */

import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { createWorker } from '../lib/createWorker.js';
import { derivePredecessorAllowList } from '../services/executionBackends/operatorManagedBackendPure.js';
import type { DispatchReason } from '../services/executionBackends/operatorManagedBackendPure.js';

export const OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE = 'operator-session-dispatch-next-chain-link';

const payloadSchema = z.object({
  agentRunId: z.string().uuid(),
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid(),
  reason: z.enum(['bootstrap', 'continuation', 'retry', 'budget_extension']),
  parentChainLinkId: z.string().uuid().optional(),
  retryAttempt: z.number().int().min(1).default(1),
});

type DispatchNextPayload = z.infer<typeof payloadSchema>;

/** Backoff schedule in seconds: attempt 1 → 60s, attempt 2 → 300s, attempt 3 → 900s. */
const BACKOFF_SECONDS = [60, 300, 900] as const;
const MAX_RETRY_ATTEMPTS = 3;

/** Non-retryable error class prefix patterns in failure_reason. */
const NON_RETRYABLE_FAILURE_REASONS = new Set([
  'OPERATOR_SESSION_UNAVAILABLE',
  'parent_orphaned',
  'profile_corruption',
  'OPERATOR_PROFILE_UNRECOVERABLE',
]);

function _isNonRetryable(failureReason: string | null | undefined): boolean {
  if (!failureReason) return false;
  return NON_RETRYABLE_FAILURE_REASONS.has(failureReason);
}

/**
 * Registers the operator-session-dispatch-next-chain-link pg-boss handler.
 */
export async function registerOperatorSessionDispatchNextChainLinkHandler(
  boss: PgBoss,
): Promise<void> {
  await createWorker<Record<string, unknown>>({
    queue: OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE,
    boss,
    concurrency: 4,
    resolveOrgContext: (job) => {
      const data = (job.data ?? {}) as Record<string, unknown>;
      const organisationId = data.organisationId;
      const subaccountId = data.subaccountId;
      if (typeof organisationId !== 'string' || typeof subaccountId !== 'string') return null;
      return { organisationId, subaccountId };
    },
    handler: async (job) => {
      const parsed = payloadSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.warn('operator.dispatch_next.invalid_payload', {
          jobId: job.id,
          issues: parsed.error.issues,
        });
        return;
      }

      const payload = parsed.data as DispatchNextPayload;
      const { agentRunId, organisationId, subaccountId, reason, retryAttempt } = payload;

      // Re-read the agent_run status — single source of truth.
      const scopedDb = getOrgScopedDb('operatorSessionDispatchNextChainLinkHandler');
      const [agentRun] = await scopedDb
        .select({ id: agentRuns.id, status: agentRuns.status, agentId: agentRuns.agentId, subaccountId: agentRuns.subaccountId })
        .from(agentRuns)
        .where(eq(agentRuns.id, agentRunId))
        .limit(1);

      if (!agentRun) {
        logger.warn('operator.dispatch_next.agent_run_not_found', { agentRunId });
        return;
      }

      // Cancel-vs-dispatch invariant: cancelled tasks are never re-dispatched.
      if (agentRun.status === 'cancelled') {
        logger.info('operator.dispatch_next.cancelled_no_op', { agentRunId });
        return;
      }

      // Predecessor allow-list check (pure helper from Chunk 3).
      const allowedStatuses = derivePredecessorAllowList(reason as DispatchReason);
      if (!allowedStatuses.includes(agentRun.status)) {
        logger.info('operator.dispatch_next.predecessor_mismatch', {
          agentRunId,
          currentStatus: agentRun.status,
          reason,
          allowedStatuses,
        });
        return;
      }

      // Dispatch the next chain link.
      try {
        const { operatorManagedBackend } = await import(
          '../services/executionBackends/operatorManagedBackend.js'
        );

        await operatorManagedBackend.dispatch({
          runId: agentRunId,
          organisationId,
          subaccountId,
          agentId: agentRun.agentId,
          promptAssembly: '',
          tokenBudget: 0,
          maxToolCalls: 0,
          timeoutMs: 0,
          backendOptions: { backendId: 'operator_managed' },
        });
      } catch (err) {
        const failureReason = err instanceof Error ? err.message : String(err);

        // Non-retryable errors bypass backoff retry.
        if (_isNonRetryable(failureReason)) {
          logger.error('operator.dispatch_next.non_retryable', {
            agentRunId,
            failureReason,
          });
          return;
        }

        // Retryable errors: apply backoff schedule.
        if (retryAttempt < MAX_RETRY_ATTEMPTS) {
          const startAfterSeconds = BACKOFF_SECONDS[retryAttempt - 1] ?? 900;
          logger.warn('operator.dispatch_next.retry_scheduled', {
            agentRunId,
            retryAttempt,
            startAfterSeconds,
            failureReason,
          });

          await boss.send(
            OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE,
            {
              agentRunId,
              organisationId,
              subaccountId,
              reason,
              parentChainLinkId: payload.parentChainLinkId,
              retryAttempt: retryAttempt + 1,
            },
            {
              startAfter: startAfterSeconds,
              singletonKey: `operator-dispatch-retry:${agentRunId}:${retryAttempt + 1}`,
            },
          );
          return;
        }

        // Max retries exceeded.
        logger.error('operator.dispatch_next.max_retries_exceeded', {
          agentRunId,
          retryAttempt,
          failureReason,
        });
        throw err;
      }

      logger.info('operator.dispatch_next.done', { agentRunId, reason });
    },
  });

  logger.info('operator.dispatch_next.handler_registered');
}
