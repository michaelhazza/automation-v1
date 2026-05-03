/**
 * workflow-drafts-cleanup — purges unconsumed workflow_drafts rows older
 * than 7 days.
 *
 * Spec: Workflows V1 §16.3 #35a.
 *
 * Only rows with consumed_at IS NULL are reaped — consumed drafts have
 * already been used by Studio and should be left for audit purposes
 * (their consumed_at timestamp is the record of when they were picked up).
 *
 * Schedule: once daily at 03:00 UTC, registered in queueService.ts.
 *
 * Uses withAdminConnection + SET LOCAL ROLE admin_role for a cross-org
 * sweep. Without the role switch the DELETE would fail-closed under RLS
 * and delete zero rows. Matches the pattern in agentRunCleanupJob.ts.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { computeWorkflowDraftsCutoff } from './workflowDraftsCleanupJobPure.js';

const THRESHOLD_DAYS = 7;

export interface WorkflowDraftsCleanupResult {
  deleted: number;
  cutoff: string;
  durationMs: number;
}

// @rls-allowlist-bypass: workflow_drafts workflowDraftsCleanup [ref: spec §16.3]
export async function runWorkflowDraftsCleanup(): Promise<WorkflowDraftsCleanupResult> {
  const started = Date.now();
  const cutoff = computeWorkflowDraftsCutoff({ nowMs: started, thresholdDays: THRESHOLD_DAYS });
  const cutoffIso = cutoff.toISOString();

  let deleted = 0;

  await withAdminConnection(
    {
      source: 'jobs.workflowDraftsCleanup',
      reason: 'Daily sweep of unconsumed workflow_drafts older than 7 days',
    },
    async (tx) => {
      // Elevate to admin_role so the DELETE bypasses RLS — this is a
      // cross-org maintenance sweep by design.
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const result = await tx.execute(sql`
        DELETE FROM workflow_drafts
        WHERE consumed_at IS NULL
          AND created_at < ${cutoffIso}::timestamptz
        RETURNING id
      `);

      const rows = result as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };
      deleted = Array.isArray(rows)
        ? rows.length
        : Array.isArray((rows as { rows?: Array<{ id: string }> }).rows)
          ? ((rows as { rows: Array<{ id: string }> }).rows).length
          : 0;
    },
  );

  const durationMs = Date.now() - started;

  console.info(
    JSON.stringify({
      event: 'workflow_drafts_cleanup_complete',
      deleted,
      cutoff: cutoffIso,
      durationMs,
    }),
  );

  return { deleted, cutoff: cutoffIso, durationMs };
}
