/**
 * One-shot backfill: recompute capability_map for all user-owned subaccount_agents
 * to include the owner_user_id field (personal-assistant-v2-operator spec §5.1 / §6.4).
 *
 * Usage: npx tsx scripts/backfill-capability-map-owner-user-id.ts
 *
 * Idempotent — safe to re-run. If the capability_map already contains the
 * correct owner_user_id the recomputation overwrites it with an identical value
 * (computedAt will differ, all other fields are stable). Re-running is harmless.
 *
 * Processing is per-org to comply with DEVELOPMENT_GUIDELINES §1 (never a
 * single admin transaction across all orgs). Each org's rows are processed in
 * a single Drizzle transaction so a partial failure affects only that org.
 *
 * Advisory lock `hashtext('cap-map-owner-backfill')` prevents concurrent runs.
 */

import 'dotenv/config';
import { pathToFileURL } from 'url';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { db, client } from '../server/db/index.js';
import { subaccountAgents, agents } from '../server/db/schema/index.js';
import { recomputeCapabilityMapWithOwner } from '../server/services/capabilityMapService.js';

// ---------------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------------

async function tryAcquireAdvisoryLock(lockKey: number): Promise<boolean> {
  const result = await db.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_lock(${lockKey}::bigint) AS acquired`,
  );
  return result[0]?.acquired === true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface BackfillResult {
  orgsProcessed: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errors: { subaccountAgentId: string; organisationId: string; error: string }[];
}

export async function runCapabilityMapOwnerBackfill(): Promise<BackfillResult> {
  const lockRows = await db.execute<{ lock_key: number }>(
    sql`SELECT hashtext('cap-map-owner-backfill') AS lock_key`,
  );
  const lockKey: number = lockRows[0].lock_key;

  const acquired = await tryAcquireAdvisoryLock(lockKey);
  if (!acquired) {
    const msg =
      'Another cap-map-owner backfill is already running (lock held). Wait for it to complete, then retry.';
    console.error(`[cap-map-owner-backfill] ${msg}`);
    process.exit(1);
  }

  console.log('[cap-map-owner-backfill] lock acquired, discovering user-owned subaccount_agents...');

  // Fetch all user-owned subaccount_agents (joined to agents for owner_user_id).
  // We only need to recompute rows where the owning agent has owner_user_id set.
  const rows = await db
    .select({
      subaccountAgentId: subaccountAgents.id,
      organisationId: subaccountAgents.organisationId,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
    .where(isNotNull(agents.ownerUserId));

  console.log(`[cap-map-owner-backfill] found ${rows.length} user-owned subaccount_agent row(s)`);

  if (rows.length === 0) {
    console.log('[cap-map-owner-backfill] nothing to do — no user-owned agents found');
    return { orgsProcessed: 0, rowsUpdated: 0, rowsSkipped: 0, errors: [] };
  }

  // Group by org so we can process per-org (DEVELOPMENT_GUIDELINES §1)
  const byOrg = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byOrg.get(row.organisationId) ?? [];
    existing.push(row.subaccountAgentId);
    byOrg.set(row.organisationId, existing);
  }

  let rowsUpdated = 0;
  let rowsSkipped = 0;
  const errors: BackfillResult['errors'] = [];

  for (const [organisationId, subaccountAgentIds] of byOrg) {
    console.log(
      `[cap-map-owner-backfill] org ${organisationId}: processing ${subaccountAgentIds.length} row(s)`,
    );

    for (const subaccountAgentId of subaccountAgentIds) {
      try {
        const result = await recomputeCapabilityMapWithOwner(subaccountAgentId);
        if (result !== null) {
          rowsUpdated++;
          console.log(
            `[cap-map-owner-backfill] updated capability_map for subaccount_agent ${subaccountAgentId}` +
              (result.owner_user_id ? ` (owner_user_id=${result.owner_user_id})` : ''),
          );
        } else {
          // Row disappeared between fetch and recompute (safe to skip)
          rowsSkipped++;
          console.warn(
            `[cap-map-owner-backfill] subaccount_agent ${subaccountAgentId} not found during recompute — skipped`,
          );
        }
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : String(err);
        errors.push({ subaccountAgentId, organisationId, error: errMsg });
        console.warn(
          `[cap-map-owner-backfill] ERROR for subaccount_agent ${subaccountAgentId} (org ${organisationId}): ${errMsg}`,
        );
      }
    }
  }

  const summary: BackfillResult = {
    orgsProcessed: byOrg.size,
    rowsUpdated,
    rowsSkipped,
    errors,
  };

  console.log('[cap-map-owner-backfill] done:');
  console.log(`  orgs processed:  ${summary.orgsProcessed}`);
  console.log(`  rows updated:    ${summary.rowsUpdated}`);
  console.log(`  rows skipped:    ${summary.rowsSkipped}`);
  console.log(`  errors:          ${summary.errors.length}`);

  if (errors.length > 0) {
    console.warn('[cap-map-owner-backfill] errors encountered:');
    for (const e of errors) {
      console.warn(`  - ${e.subaccountAgentId} (org ${e.organisationId}): ${e.error}`);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCapabilityMapOwnerBackfill()
    .then((result) => {
      process.exitCode = result.errors.length > 0 ? 1 : 0;
    })
    .catch((err) => {
      console.error('[cap-map-owner-backfill] fatal error:', err);
      process.exitCode = 1;
    })
    .finally(() => {
      void client.end();
    });
}
