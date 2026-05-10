/**
 * maintenance:webhook-replay-nonce-prune
 * Prunes webhook_replay_nonces rows older than 10 minutes across all organisations.
 * Scheduled hourly in queueService.ts.
 *
 * Design note: the 10-minute prune window matches the dedup window declared in the
 * spec. A nonce row's existence (not the wall clock) is the dedup invariant — the
 * test "nonce row still present past 10 minutes is still deduped" captures this.
 * The prune job removes rows AFTER they are no longer needed for dedup, keeping the
 * table small.
 *
 * Execution contract:
 *   - Uses withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS for the
 *     cross-org DELETE. This mirrors the pattern in fastPathDecisionsPruneJob.ts.
 *   - Single DELETE statement (not per-org fan-out) since the table has no
 *     per-org performance concern at this row volume.
 *   - Idempotent: re-running recomputes from current data; DELETE WHERE seen_at <
 *     cutoff is idempotent against the current state.
 *
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'webhook-replay-nonce-prune' as const;

export interface WebhookReplayNoncePruneResult {
  status: 'success' | 'failed';
  rowsDeleted: number;
  durationMs: number;
}

export async function runWebhookReplayNoncePrune(): Promise<WebhookReplayNoncePruneResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  try {
    const deleted = await withAdminConnection(
      { source: SOURCE, reason: 'Hourly prune of expired webhook_replay_nonces', skipAudit: true },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        const rows = (await adminDb.execute(
          sql`DELETE FROM webhook_replay_nonces WHERE seen_at < now() - INTERVAL '10 minutes' RETURNING 1`,
        )) as unknown as Array<unknown>;
        return rows.length;
      },
    );

    const durationMs = Date.now() - startedAt;
    const result: WebhookReplayNoncePruneResult = {
      status: 'success',
      rowsDeleted: deleted,
      durationMs,
    };

    logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: WebhookReplayNoncePruneResult = {
      status: 'failed',
      rowsDeleted: 0,
      durationMs,
    };

    logger.error(`${SOURCE}.completed`, {
      jobRunId,
      ...result,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }
}
