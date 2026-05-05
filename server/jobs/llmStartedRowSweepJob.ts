/**
 * llmStartedRowSweepJob — reaps aged-out provisional `'started'` rows from
 * `llm_requests`.
 *
 * Deferred-items brief §1 (tasks/llm-inflight-deferred-items-brief.md):
 * provisional rows are written before `providerAdapter.call()` so a retry
 * after a provider-success + DB-blip doesn't double-bill. When the router
 * terminalises the row (success / error / timeout), the upsert overwrites
 * the `'started'` status with the final status. A process crash between
 * the `'started'` insert and the terminal upsert leaves an orphan row
 * that would otherwise block all retries for this idempotencyKey.
 *
 * This sweep runs every 2 minutes and reaps any `'started'` row older
 * than `PROVIDER_CALL_TIMEOUT_MS + 60s`. The row is rewritten to
 * `status = 'error'` with `error_message = 'provisional_row_expired'`
 * — a hygiene operation that closes the retry window under the same
 * idempotencyKey. Actual provider-side billing is irrecoverable, but at
 * least the system un-jams.
 *
 * Registered in `server/services/queueService.ts` as
 * `maintenance:llm-started-row-sweep`. Admin-bypass (RLS-FORCE'd table
 * via withAdminConnection).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { PROVIDER_CALL_TIMEOUT_MS } from '../config/limits.js';
import { computeStartedRowSweepCutoff } from './llmStartedRowSweepJobPure.js';

const CHUNK_SIZE = 1_000;

interface SweepResult {
  totalReaped: number;
  cutoff:      string;   // ISO 8601
}

export async function sweepExpiredStartedRows(): Promise<SweepResult> {
  const cutoff = computeStartedRowSweepCutoff({
    nowMs:             Date.now(),
    providerTimeoutMs: PROVIDER_CALL_TIMEOUT_MS,
  });
  const cutoffIso = cutoff.toISOString();
  let totalReaped = 0;

  for (;;) {
    const reaped = await withAdminConnection(
      {
        source: 'llmStartedRowSweepJob',
        reason: `reap provisional 'started' rows older than ${cutoffIso}`,
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        // Rewrite aged-out provisional rows as errors. Use the
        // `llm_requests_started_idx` partial index (migration 0190) so
        // this scan is cheap.
        const result = await tx.execute(sql`
          WITH doomed AS (
            SELECT id
            FROM llm_requests
            WHERE status = 'started'
              AND created_at < ${cutoffIso}
            ORDER BY created_at
            LIMIT ${CHUNK_SIZE}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE llm_requests
          SET status = 'error',
              error_message = 'provisional_row_expired'
          WHERE id IN (SELECT id FROM doomed)
          RETURNING id;
        `);
        const rowList = result as unknown as ArrayLike<{ id: string }>;
        return rowList.length;
      },
    );

    totalReaped += reaped;
    if (reaped < CHUNK_SIZE) break;
  }

  if (totalReaped > 0) {
    logger.warn('llm_started_row_sweep_reaped', { totalReaped, cutoff: cutoffIso });
  } else {
    logger.debug('llm_started_row_sweep_clean', { cutoff: cutoffIso });
  }
  return { totalReaped, cutoff: cutoffIso };
}
