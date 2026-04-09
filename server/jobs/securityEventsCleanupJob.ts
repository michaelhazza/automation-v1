/**
 * security-events-cleanup — Sprint 2 P1.1 Layer 3 retention pruner.
 *
 * Runs nightly to delete rows from `tool_call_security_events` older than
 * the retention window. The table stores one row per tool-call
 * authorisation decision (allow / deny / review), so write volume is high
 * and retention has to be bounded to keep the table compact.
 *
 * Retention resolution:
 *   1. Per-org override: `organisations.security_event_retention_days`.
 *      NULL means "use the default".
 *   2. Global default: `DEFAULT_SECURITY_EVENT_RETENTION_DAYS` from
 *      `server/config/limits.ts`.
 *
 * The deletion is cross-org, so the job uses `withAdminConnection` +
 * `SET LOCAL ROLE admin_role` to bypass RLS for the sweep. Without the
 * role switch the query would fail-closed (zero rows deleted).
 *
 * Idempotency: the job can safely re-run — deletion is based on
 * timestamps, not on any external id. pg-boss's at-most-once semantics
 * combined with idempotent DELETE mean duplicate runs are a no-op after
 * the first completes.
 *
 * Cap: DELETE is capped per-organisation at 100k rows to keep one nightly
 * run bounded. If an org exceeds the cap repeatedly, a manual backfill
 * via `scripts/prune-security-events.ts` can drain the backlog.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import {
  DEFAULT_SECURITY_EVENT_RETENTION_DAYS,
  MAX_SECURITY_EVENT_RETENTION_DAYS,
} from '../config/limits.js';

/** Maximum rows deleted per org per run. */
const MAX_DELETE_PER_ORG = 100_000;

interface PruneResult {
  organisationId: string;
  retentionDays: number;
  deleted: number;
}

/**
 * Sweep retention across all organisations. Returns a per-org summary
 * for observability. Never throws on a single org failure — failures are
 * logged and the sweep continues.
 */
export async function runSecurityEventsCleanup(): Promise<PruneResult[]> {
  const started = Date.now();
  const results: PruneResult[] = [];

  await withAdminConnection(
    {
      source: 'jobs.securityEventsCleanup',
      reason: 'Nightly sweep of tool_call_security_events retention',
    },
    async (tx) => {
      // Elevate to admin_role so the DELETE bypasses RLS — this is a
      // cross-org maintenance sweep by design.
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Resolve (org, retention) pairs in one query, clamping overrides
      // to [1, MAX_SECURITY_EVENT_RETENTION_DAYS] and falling back to the
      // default when NULL. Clamping in SQL keeps the job resilient to
      // bad data already in the column.
      const rows = (await tx.execute(sql`
        SELECT
          id AS organisation_id,
          LEAST(
            GREATEST(
              COALESCE(security_event_retention_days, ${DEFAULT_SECURITY_EVENT_RETENTION_DAYS}),
              1
            ),
            ${MAX_SECURITY_EVENT_RETENTION_DAYS}
          )::int AS retention_days
        FROM organisations
      `)) as unknown as Array<{ organisation_id: string; retention_days: number }>;

      for (const row of rows) {
        try {
          const deleted = (await tx.execute(sql`
            WITH victims AS (
              SELECT id
              FROM tool_call_security_events
              WHERE organisation_id = ${row.organisation_id}::uuid
                AND created_at < now() - (${row.retention_days}::int || ' days')::interval
              LIMIT ${MAX_DELETE_PER_ORG}
            )
            DELETE FROM tool_call_security_events
            WHERE id IN (SELECT id FROM victims)
          `)) as unknown as { count?: number };

          const count = typeof deleted.count === 'number' ? deleted.count : 0;
          results.push({
            organisationId: row.organisation_id,
            retentionDays: row.retention_days,
            deleted: count,
          });
        } catch (err) {
          // Keep the sweep going on single-org failures.
          console.error(
            JSON.stringify({
              event: 'security_events_cleanup_org_failed',
              organisationId: row.organisation_id,
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
      event: 'security_events_cleanup_complete',
      orgs: results.length,
      totalDeleted,
      durationMs,
    }),
  );

  return results;
}
