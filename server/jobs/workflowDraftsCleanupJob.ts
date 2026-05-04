/**
 * workflow-drafts-cleanup — daily purge of unconsumed workflow_drafts older
 * than 7 days.
 *
 * Runs daily at 03:00 UTC via pg-boss (registered in queueService.startMaintenanceJobs).
 *
 * Unconsumed drafts (consumed_at IS NULL) that were created more than 7 days
 * ago are safe to discard — the orchestrator session that produced them is long
 * since idle and any Studio session referencing the draft would be stale.
 *
 * Idempotency: the DELETE is time-based with no external state; re-running
 * is safe.
 *
 * The job uses `withAdminConnection` + `SET LOCAL ROLE admin_role` because
 * it is a cross-org maintenance sweep. Without the role switch the DELETE
 * would fail-closed under the FORCE RLS policy on `workflow_drafts` and
 * delete zero rows on every tick.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

export async function runWorkflowDraftsCleanup(): Promise<void> {
  const deleted = await withAdminConnection(
    {
      source: 'jobs.workflowDraftsCleanup',
      reason: 'Daily sweep of unconsumed workflow_drafts older than 7 days',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      const result = (await tx.execute(sql`
        DELETE FROM workflow_drafts
        WHERE consumed_at IS NULL
          AND created_at < now() - interval '7 days'
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      return result.length;
    },
  );

  logger.info('workflow_drafts_cleanup.done', { deleted });
}
