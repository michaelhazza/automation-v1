/**
 * blockedRunExpiryJob — sweeps agent_runs with expired integration blocks.
 *
 * Runs every 5 minutes via pg-boss (registered in queueService.startMaintenanceJobs).
 * For every run whose blocked_expires_at < now() and that is still in a
 * non-terminal state, transitions the run to status='cancelled' /
 * run_result_status='failed' and writes cancelReason='integration_connect_timeout'
 * into runMetadata so the conversation shows a clear message.
 *
 * Cross-org maintenance contract (§2 / §9):
 *   - Uses `withAdminConnection` + `SET LOCAL ROLE admin_role` so the sweep
 *     bypasses RLS deliberately for this cross-tenant cleanup. Without the
 *     role switch the UPDATE would fail-closed under RLS and update zero rows.
 *
 * State-machine contract (§8.18):
 *   - Each transition is gated by `assertValidTransition` (kind='agent_run'),
 *     which rejects any source status already in TERMINAL_RUN_STATUSES.
 *   - The UPDATE predicate also includes `status = <observed-status>` so a
 *     parallel writer that already moved the run cannot be clobbered.
 *   - Each successful transition emits a `state_transition` structured log
 *     with `guarded: true`.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import {
  assertValidTransition,
  describeTransition,
  InvalidTransitionError,
} from '../../shared/stateMachineGuards.js';
import { AGENT_RUN_STATUS, TERMINAL_RUN_STATUSES } from '../../shared/runStatus.js';

export interface BlockedRunExpirySummary {
  expiredCount: number;
  durationMs: number;
}

export async function runFn(): Promise<BlockedRunExpirySummary> {
  const started = Date.now();
  const now = new Date();
  let expiredCount = 0;

  await withAdminConnection(
    {
      source: 'jobs.blockedRunExpiry',
      reason: 'Sweep agent_runs whose integration block has expired',
    },
    async (tx) => {
      // Cross-org sweep — must bypass RLS to see runs across all tenants.
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Step 1: identify candidates — non-terminal runs with an expired block.
      // Excluding terminal statuses defends against the (rare) state where
      // another path nulled the block but a stale row still has expires_at < now;
      // we never want to re-transition a terminal run.
      const terminalLiterals = TERMINAL_RUN_STATUSES.map((s) => `'${s}'`).join(',');
      const candidates = (await tx.execute(
        sql.raw(`
          SELECT id, status
          FROM agent_runs
          WHERE blocked_reason IS NOT NULL
            AND blocked_expires_at < '${now.toISOString()}'::timestamptz
            AND status NOT IN (${terminalLiterals})
        `),
      )) as unknown as Array<{ id: string; status: string }> | { rows?: Array<{ id: string; status: string }> };

      const candidateRows: Array<{ id: string; status: string }> = Array.isArray(candidates)
        ? candidates
        : Array.isArray(candidates?.rows)
          ? candidates.rows
          : [];

      // Step 2: transition each — assertValidTransition guards, predicate-checked
      // UPDATE prevents racing a parallel terminal writer.
      for (const run of candidateRows) {
        try {
          assertValidTransition({
            kind: 'agent_run',
            recordId: run.id,
            from: run.status,
            to: AGENT_RUN_STATUS.CANCELLED,
          });

          const updated = (await tx.execute(sql`
            UPDATE agent_runs
            SET
              status = 'cancelled',
              run_result_status = 'failed',
              blocked_reason = NULL,
              blocked_expires_at = NULL,
              integration_resume_token = NULL,
              completed_at = ${now.toISOString()}::timestamptz,
              updated_at = ${now.toISOString()}::timestamptz,
              run_metadata = jsonb_set(
                COALESCE(run_metadata, '{}'::jsonb),
                '{cancelReason}',
                '"integration_connect_timeout"'::jsonb
              )
            WHERE id = ${run.id}::uuid
              AND status = ${run.status}
            RETURNING id
          `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

          const updatedRows = Array.isArray(updated)
            ? updated
            : Array.isArray(updated?.rows)
              ? updated.rows
              : [];

          if (updatedRows.length === 1) {
            expiredCount += 1;
            logger.info(
              'state_transition',
              describeTransition({
                kind: 'agent_run',
                recordId: run.id,
                from: run.status,
                to: AGENT_RUN_STATUS.CANCELLED,
                site: 'blockedRunExpiryJob.runFn',
                guarded: true,
              }),
            );
            logger.info('run_blocked_expired', {
              runId: run.id,
              conversationId: '',
              blockedReason: 'integration_required',
              integrationId: '',
              action: 'run_blocked_expired',
            });
          }
          // updatedRows.length === 0 means a parallel writer transitioned the
          // run between SELECT and UPDATE — drop silently, the other writer
          // owns the transition.
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            logger.warn('blocked_run_expiry.invalid_transition', {
              runId: run.id,
              from: err.from,
              to: err.to,
              error: err.message,
            });
          } else {
            logger.warn('blocked_run_expiry.update_failed', {
              runId: run.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
  );

  const summary: BlockedRunExpirySummary = {
    expiredCount,
    durationMs: Date.now() - started,
  };

  logger.info('blocked_run_expiry_sweep', {
    ...summary,
    action: 'blocked_run_expiry_sweep',
  });

  return summary;
}
