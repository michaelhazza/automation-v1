/**
 * llmLedgerArchiveJob — nightly retention sweep for llm_requests (spec §12.4).
 *
 * Moves rows created >= env.LLM_LEDGER_RETENTION_MONTHS months ago into
 * llm_requests_archive in 10k-row chunks. Each chunk is a single
 * transaction: copy then delete, so a row is either in the live table OR
 * the archive, never both and never neither.
 *
 * Schedule: '0 3 * * *' (03:00 UTC daily) registered in queueService.ts.
 *
 * Safety notes:
 *   - ORDER BY created_at ASC + LIMIT bounds each transaction.
 *   - FOR UPDATE SKIP LOCKED makes concurrent runs safe (though the
 *     nightly cadence means concurrency is extremely unlikely).
 *   - Idempotent: re-running after a clean sweep is a no-op.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { computeArchiveCutoff } from './llmLedgerArchiveJobPure.js';

interface ArchiveResult {
  totalMoved: number;
  cutoff:     string;              // ISO 8601
}

const CHUNK_SIZE = 10_000;

export async function archiveOldLedgerRows(): Promise<ArchiveResult> {
  const cutoff = computeArchiveCutoff(env.LLM_LEDGER_RETENTION_MONTHS, new Date());
  const cutoffIso = cutoff.toISOString();
  let totalMoved = 0;

  for (;;) {
    // Select + copy + delete in a single transaction. The CTE chain
    // guarantees atomicity — a failure aborts everything.
    //
    // llm_requests + llm_requests_archive both have FORCE ROW LEVEL
    // SECURITY. This nightly sweep is intentionally cross-tenant, so the
    // transaction runs under withAdminConnection + `SET LOCAL ROLE
    // admin_role` (BYPASSRLS) — the only legitimate cross-org caller for
    // these tables.
    const moved = await withAdminConnection(
      {
        source: 'llmLedgerArchiveJob',
        reason: `retention sweep ≥ ${env.LLM_LEDGER_RETENTION_MONTHS} months`,
      },
      async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      const result = await tx.execute(sql`
        WITH doomed AS (
          SELECT id
          FROM llm_requests
          WHERE created_at < ${cutoffIso}
          ORDER BY created_at
          LIMIT ${CHUNK_SIZE}
          FOR UPDATE SKIP LOCKED
        ),
        inserted AS (
          INSERT INTO llm_requests_archive (
            id, idempotency_key, organisation_id, subaccount_id, user_id,
            source_type, run_id, execution_id, iee_run_id, source_id,
            feature_tag, call_site, agent_name, task_type,
            provider, model, provider_request_id,
            tokens_in, tokens_out, provider_tokens_in, provider_tokens_out,
            cost_raw, cost_with_margin, cost_with_margin_cents, margin_multiplier, fixed_fee_cents,
            request_payload_hash, response_payload_hash,
            provider_latency_ms, router_overhead_ms,
            status, error_message, attempt_number,
            parse_failure_raw_excerpt, abort_reason,
            cached_prompt_tokens,
            execution_phase, capability_tier, was_downgraded, routing_reason,
            was_escalated, escalation_reason,
            requested_provider, requested_model, fallback_chain,
            billing_month, billing_day,
            created_at
          )
          SELECT
            id, idempotency_key, organisation_id, subaccount_id, user_id,
            source_type, run_id, execution_id, iee_run_id, source_id,
            feature_tag, call_site, agent_name, task_type,
            provider, model, provider_request_id,
            tokens_in, tokens_out, provider_tokens_in, provider_tokens_out,
            cost_raw, cost_with_margin, cost_with_margin_cents, margin_multiplier, fixed_fee_cents,
            request_payload_hash, response_payload_hash,
            provider_latency_ms, router_overhead_ms,
            status, error_message, attempt_number,
            parse_failure_raw_excerpt, abort_reason,
            cached_prompt_tokens,
            execution_phase, capability_tier, was_downgraded, routing_reason,
            was_escalated, escalation_reason,
            requested_provider, requested_model, fallback_chain,
            billing_month, billing_day,
            created_at
          FROM llm_requests
          WHERE id IN (SELECT id FROM doomed)
          ON CONFLICT DO NOTHING
          RETURNING id
        )
        -- DELETE joins doomed, not inserted: if a row is already in the
        -- archive (idempotency_key or id collision), ON CONFLICT DO NOTHING
        -- silently drops it from inserted. We still want to remove that
        -- row from the live table — otherwise it stays forever, re-entering
        -- doomed every night and the live table never shrinks.
        , deleted AS (
          DELETE FROM llm_requests
          WHERE id IN (SELECT id FROM doomed)
          RETURNING 1
        )
        SELECT COUNT(*)::int AS moved FROM deleted;
      `);
      // drizzle/postgres-js returns a RowList with a single row `{ moved: N }`.
      const rowList = result as unknown as ArrayLike<{ moved: number }>;
      const first = rowList.length > 0 ? rowList[0] : undefined;
      return first?.moved ?? 0;
      },
    );

    totalMoved += moved;
    if (moved < CHUNK_SIZE) break;
  }

  logger.info('llm_ledger_archive_complete', { totalMoved, cutoff: cutoffIso });
  return { totalMoved, cutoff: cutoffIso };
}
