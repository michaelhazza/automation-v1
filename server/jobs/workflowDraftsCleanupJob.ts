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
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowDrafts } from '../db/schema/workflowDrafts.js';
import { logger } from '../lib/logger.js';

export async function runWorkflowDraftsCleanup(): Promise<void> {
  const result = (await db
    .delete(workflowDrafts)
    .where(
      sql`${workflowDrafts.consumedAt} IS NULL AND ${workflowDrafts.createdAt} < now() - interval '7 days'`,
    )
    .returning({ id: workflowDrafts.id })) as Array<{ id: string }>;

  const deleted = result.length;
  logger.info('workflow_drafts_cleanup.done', { deleted });
}
