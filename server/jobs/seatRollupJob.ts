/**
 * seatRollupJob — hourly billing-snapshot rollup for workspace seat counts.
 *
 * Counts active workspace identities per organisation using
 * countActiveIdentities from shared/billing/seatDerivation.ts, then writes
 * the result to org_subscriptions.consumed_seats. The SeatsPanel UI reads
 * this snapshot and compares it against the live count to satisfy D-Inv-4.
 *
 * Scheduled: every 60 minutes ('0 * * * *') via pg-boss in queueService.ts.
 */

import { db } from '../db/index.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { orgSubscriptions } from '../db/schema/orgSubscriptions.js';
import { subaccounts } from '../db/schema/subaccounts.js';
import { eq } from 'drizzle-orm';
import { countActiveIdentities } from '../../shared/billing/seatDerivation.js';
import { logger } from '../lib/logger.js';
import type { WorkspaceIdentityStatus } from '../../shared/types/workspace.js';

export async function runSeatRollup(): Promise<void> {
  logger.info('seatRollupJob.start', { operation: 'runSeatRollup' });

  // Fetch all workspace identities joined to their org via subaccounts
  const rows = await db
    .select({
      organisationId: subaccounts.organisationId,
      status: workspaceIdentities.status,
    })
    .from(workspaceIdentities)
    .innerJoin(subaccounts, eq(subaccounts.id, workspaceIdentities.subaccountId));

  // Aggregate per org in memory
  const perOrg = new Map<string, { status: WorkspaceIdentityStatus }[]>();
  for (const row of rows) {
    if (!perOrg.has(row.organisationId)) perOrg.set(row.organisationId, []);
    perOrg.get(row.organisationId)!.push({ status: row.status as WorkspaceIdentityStatus });
  }

  for (const [organisationId, identities] of perOrg) {
    const count = countActiveIdentities(identities);
    await db
      .update(orgSubscriptions)
      .set({ consumedSeats: count, updatedAt: new Date() })
      .where(eq(orgSubscriptions.organisationId, organisationId));
    logger.info('seatRollupJob.updated', {
      operation: 'runSeatRollup',
      organisationId,
      consumedSeats: count,
    });
  }

  logger.info('seatRollupJob.done', { operation: 'runSeatRollup', orgCount: perOrg.size });
}
