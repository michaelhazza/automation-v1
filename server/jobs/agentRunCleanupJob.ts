/**
 * agent-run-cleanup — Sprint 3 P2.1 Sprint 3A retention pruner.
 *
 * Runs nightly to delete terminal `agent_runs` rows older than each
 * organisation's retention window. Cascade-protected child rows
 * (`agent_run_snapshots`, `agent_run_messages`) are removed by the
 * `ON DELETE CASCADE` foreign keys in migration 0084.
 *
 * Retention resolution:
 *   1. Per-org override: `organisations.run_retention_days`. NULL (or
 *      any non-positive value) means "use the default".
 *   2. Global default: `DEFAULT_RUN_RETENTION_DAYS` from
 *      `server/config/limits.ts`.
 *
 * Only terminal runs are pruned — `pending`, `running`, and any other
 * non-terminal state is left alone because Sprint 3B will treat those
 * rows as resume targets. The terminal statuses pruned match
 * `docs/improvements-roadmap-spec.md §P2.1 Retention`:
 *
 *    completed | failed | timeout | cancelled
 *
 * `loop_detected` and `budget_exceeded` are intentionally not pruned by
 * this job — they are left for manual review (a long-lived loop is a
 * bug signal, not a storage cost signal).
 *
 * The job uses `withAdminConnection` + `SET LOCAL ROLE admin_role`
 * because it is a cross-org maintenance sweep. Without the role switch
 * the DELETE would fail-closed under RLS and delete zero rows.
 *
 * Idempotency: the sweep is safe to re-run — the DELETE is time-based
 * and has no external keys. pg-boss's `idempotencyStrategy: 'fifo'`
 * contract (declared in `jobConfig.ts`) matches this — each tick is a
 * distinct unit of work that re-reads the current DB state.
 *
 * Cap: DELETE is bounded per-org at 50k rows per run to keep one
 * nightly tick within the worker's wall-clock budget. An org that
 * exceeds the cap will drain over multiple nightly runs — the next
 * tick picks up the next 50k oldest terminal rows.
 *
 * See docs/improvements-roadmap-spec.md §P2.1 and
 * tasks/sprint-3-plan.md §2.4.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { DEFAULT_RUN_RETENTION_DAYS } from '../config/limits.js';
import { resolveRetentionDays, computeCutoffDate } from './agentRunCleanupJobPure.js';

/** Maximum `agent_runs` rows deleted per organisation per tick. */
const MAX_DELETE_PER_ORG = 50_000;

interface PruneResult {
  organisationId: string;
  retentionDays: number;
  deleted: number;
}

export interface AgentRunCleanupSummary {
  orgs: number;
  pruned: number;
  skipped: number;
  durationMs: number;
}

/**
 * Sweep retention across all organisations. Returns an aggregate
 * summary for observability. Never throws on a single-org failure —
 * failures are logged and the sweep continues to the next org so a
 * single bad row cannot block the nightly run.
 */
export async function runAgentRunCleanupTick(): Promise<AgentRunCleanupSummary> {
  const started = Date.now();
  const results: PruneResult[] = [];
  let skipped = 0;

  await withAdminConnection(
    {
      source: 'jobs.agentRunCleanupTick',
      reason: 'Nightly sweep of terminal agent_runs retention',
    },
    async (tx) => {
      // Elevate to admin_role so the DELETE bypasses RLS — this is a
      // cross-org maintenance sweep by design. Without this, every
      // DELETE would hit zero rows because the RLS USING clause would
      // fail-closed against the absent org context.
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Pull (org_id, run_retention_days) pairs in one round trip.
      // Override resolution happens in the pure helper so the fallback
      // semantics stay tested independently of the DB.
      const rows = (await tx.execute(sql`
        SELECT id AS organisation_id, run_retention_days
        FROM organisations
      `)) as unknown as Array<{
        organisation_id: string;
        run_retention_days: number | null;
      }>;

      const now = new Date();

      for (const row of rows) {
        const retentionDays = resolveRetentionDays(
          row.run_retention_days,
          DEFAULT_RUN_RETENTION_DAYS,
        );
        const cutoff = computeCutoffDate(now, retentionDays);

        try {
          // Two-step DELETE with a CTE so we can cap the per-org blast
          // radius at MAX_DELETE_PER_ORG. Oldest runs win — the
          // `ORDER BY created_at ASC` clause ensures an org that is
          // over the cap drains deterministically across successive
          // ticks rather than leaving random holes.
          const deleted = (await tx.execute(sql`
            WITH victims AS (
              SELECT id
              FROM agent_runs
              WHERE organisation_id = ${row.organisation_id}::uuid
                AND status IN ('completed', 'failed', 'timeout', 'cancelled')
                AND created_at < ${cutoff.toISOString()}::timestamptz
              ORDER BY created_at ASC
              LIMIT ${MAX_DELETE_PER_ORG}
            )
            DELETE FROM agent_runs
            WHERE id IN (SELECT id FROM victims)
          `)) as unknown as { count?: number };

          const count = typeof deleted.count === 'number' ? deleted.count : 0;
          results.push({
            organisationId: row.organisation_id,
            retentionDays,
            deleted: count,
          });
        } catch (err) {
          skipped += 1;
          // Keep the sweep going on single-org failures. A bad row
          // should not bankrupt the nightly cadence for every other
          // organisation.
          console.error(
            JSON.stringify({
              event: 'agent_run_cleanup_org_failed',
              organisationId: row.organisation_id,
              retentionDays,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    },
  );

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  const durationMs = Date.now() - started;

  console.info(
    JSON.stringify({
      event: 'agent_run_cleanup_tick_complete',
      orgs: results.length,
      pruned: totalDeleted,
      skipped,
      durationMs,
    }),
  );

  return {
    orgs: results.length,
    pruned: totalDeleted,
    skipped,
    durationMs,
  };
}
