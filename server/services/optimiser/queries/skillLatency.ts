/**
 * skillLatency.ts — Optimiser telemetry query (Chunk 2)
 *
 * Reads agent_execution_events for skill.completed events (which contain
 * skillSlug + durationMs in their JSONB payload) and computes per-skill p95
 * latency for the sub-account over 7 days.
 *
 * Then joins to the optimiser_skill_peer_medians materialised view (read via
 * withAdminConnection) to produce a ratio row for each skill.
 *
 * Staleness guard: before joining the view, reads optimiser_view_metadata to
 * confirm the view was refreshed within the last 24 hours. If stale or absent,
 * returns [] and emits recommendations.scan_skipped.peer_view_stale.
 *
 * Query cost guardrail: WHERE event_timestamp >= now() - interval '7 days'.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

export interface SkillLatencyRow {
  skill_slug: string;
  latency_p95_ms: number;   // integer ms — p95 for this sub-account over 7 days
  peer_p95_ms: number;      // integer ms — p95 across all tenants (from view)
  ratio: number;            // 4 decimal places — latency_p95_ms / peer_p95_ms
}

const SOURCE = 'optimiser.skillLatency';
const STALE_THRESHOLD_HOURS = 24;

export async function querySkillLatency(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<SkillLatencyRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: skill latency', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // --- Staleness guard ---
        const metaResult = await tx.execute(sql`
          SELECT refreshed_at,
                 EXTRACT(EPOCH FROM (now() - refreshed_at)) / 3600 AS age_hours
          FROM optimiser_view_metadata
          WHERE view_name = 'optimiser_skill_peer_medians'
        `);

        const metaRows = metaResult as unknown as Array<{ refreshed_at: string | null; age_hours: string | null }>;
        const metaRow = metaRows[0];

        if (!metaRow || metaRow.refreshed_at === null) {
          // First run before initial refresh — treat as stale
          logger.warn('recommendations.scan_skipped.peer_view_stale', {
            view_name: 'optimiser_skill_peer_medians',
            view_age_hours: null,
            threshold_hours: STALE_THRESHOLD_HOURS,
            reason: 'no_metadata_row',
          });
          return [];
        }

        const ageHours = parseFloat(String(metaRow.age_hours ?? '0'));
        if (ageHours > STALE_THRESHOLD_HOURS) {
          logger.warn('recommendations.scan_skipped.peer_view_stale', {
            view_name: 'optimiser_skill_peer_medians',
            view_age_hours: Math.round(ageHours * 100) / 100,
            threshold_hours: STALE_THRESHOLD_HOURS,
            reason: 'view_stale',
          });
          return [];
        }

        // --- Per-sub-account p95 over 7 days ---
        const latencyResult = await tx.execute(sql`
          WITH local_latency AS (
            SELECT
              (aee.payload->>'skillSlug')::text AS skill_slug,
              percentile_cont(0.95) WITHIN GROUP (
                ORDER BY (aee.payload->>'durationMs')::int
              )::int AS latency_p95_ms
            FROM agent_execution_events aee
            JOIN agent_runs ar ON ar.id = aee.run_id
            WHERE aee.subaccount_id = ${subaccountId}
              AND aee.organisation_id = ${organisationId}
              AND aee.event_type = 'skill.completed'
              AND aee.event_timestamp >= now() - INTERVAL '7 days'
              AND aee.payload->>'skillSlug' IS NOT NULL
              AND aee.payload->>'durationMs' IS NOT NULL
              AND (aee.payload->>'durationMs')::int > 0
            GROUP BY aee.payload->>'skillSlug'
          )
          SELECT
            ll.skill_slug,
            ll.latency_p95_ms,
            pm.p95_ms::int AS peer_p95_ms,
            ROUND(
              (ll.latency_p95_ms::numeric / GREATEST(pm.p95_ms, 1))::numeric,
              4
            )::float AS ratio
          FROM local_latency ll
          JOIN optimiser_skill_peer_medians pm ON pm.skill_slug = ll.skill_slug
          WHERE pm.p95_ms IS NOT NULL AND pm.p95_ms > 0
        `);

        return (latencyResult as unknown as Array<Record<string, unknown>>).map((row) => ({
          skill_slug: String(row.skill_slug),
          latency_p95_ms: Number(row.latency_p95_ms) || 0,
          peer_p95_ms: Number(row.peer_p95_ms) || 0,
          ratio: Number(Number(row.ratio).toFixed(4)) || 0,
        }));
      },
    );
  } catch (err) {
    logger.error(`${SOURCE}.failed`, {
      subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(new Error('optimiser query failed'), {
      statusCode: 500,
      errorCode: 'skill_latency_failed',
    });
  }
}
