/**
 * sandboxArtefactPurgeJob.ts — Artefact purge on run soft-delete (spec B §17.4).
 *
 * Triggered when an agent_runs row is soft-deleted. Physically deletes artefact
 * objects from object storage, then marks the pointer rows with
 * object_storage_state = 'purged' and is_active = false.
 *
 * Idempotent on sandbox_execution_id: artefacts already marked 'purged' are
 * skipped; S3 DeleteObject is safe to call on already-deleted keys.
 *
 * Does NOT delete the sandbox_executions row or sandbox_telemetry_events rows —
 * those stay for audit per spec §17.4.
 *
 * Spec B §17.4, §22.1.
 */

import type PgBoss from 'pg-boss';
import { and, eq, ne } from 'drizzle-orm';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sandboxArtefacts } from '../db/schema/sandboxArtefacts.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_ARTEFACT_PURGE_JOB } from '../lib/sandboxJobNames.js';

export interface SandboxArtefactPurgePayload {
  /** The agent_run_id being soft-deleted. All sandbox executions for this run are purged. */
  runId: string;
  organisationId: string;
  subaccountId: string;
}

export async function sandboxArtefactPurgeHandler(
  job: PgBoss.Job<SandboxArtefactPurgePayload>,
): Promise<void> {
  const { runId, organisationId } = job.data;

  const db = getOrgScopedDb('jobs.sandboxArtefactPurge');

  // Find all non-purged artefact rows for this run.
  // Executions are linked to runs via sandbox_executions.run_id;
  // artefacts are linked to executions via sandbox_artefacts.sandbox_execution_id.
  // We use a SQL subquery to walk the join.
  const { sql } = await import('drizzle-orm');

  // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
  const artefactRows = await db
    .select({
      id: sandboxArtefacts.id,
      objectKey: sandboxArtefacts.objectKey,
      sandboxExecutionId: sandboxArtefacts.sandboxExecutionId,
    })
    .from(sandboxArtefacts)
    .where(
      and(
        eq(sandboxArtefacts.organisationId, organisationId),
        ne(sandboxArtefacts.objectStorageState, 'purged'),
        // Filter to executions belonging to this run via subquery.
        sql`${sandboxArtefacts.sandboxExecutionId} IN (
          SELECT id FROM sandbox_executions
          WHERE run_id = ${runId}::uuid
            AND organisation_id = ${organisationId}::uuid
        )`,
      ),
    );

  if (artefactRows.length === 0) {
    logger.info('sandbox.artefact_purge.no_artefacts', { runId, organisationId });
    return;
  }

  const s3 = getS3Client();
  const bucket = getBucketName();

  let purged = 0;
  let failed = 0;

  for (const artefact of artefactRows) {
    try {
      // Delete from object storage first — if S3 delete fails, DB row stays so the
      // next invocation can retry. This matches the pattern in runArtifactsRetentionSweepJob.
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: artefact.objectKey,
        }),
      );
    } catch (err) {
      logger.warn('sandbox.artefact_purge.s3_delete_failed', {
        artefactId: artefact.id,
        sandboxExecutionId: artefact.sandboxExecutionId,
        objectKey: artefact.objectKey,
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
      continue;
    }

    // Mark pointer row as purged and soft-deleted.
    try {
      // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
      await db
        .update(sandboxArtefacts)
        .set({
          objectStorageState: 'purged',
          isActive: false,
        })
        .where(eq(sandboxArtefacts.id, artefact.id));

      purged += 1;
    } catch (err) {
      logger.warn('sandbox.artefact_purge.db_update_failed', {
        artefactId: artefact.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }

  logger.info('sandbox.artefact_purge.completed', {
    runId,
    organisationId,
    total: artefactRows.length,
    purged,
    failed,
  });

  // Propagate failure count so pg-boss retries if any S3 deletes failed.
  if (failed > 0) {
    throw new Error(
      `sandbox_artefact_purge: ${failed} of ${artefactRows.length} artefacts failed to purge`,
    );
  }
}

/**
 * Register the artefact purge worker with pg-boss.
 * Called from queueService.ts.
 */
export async function registerSandboxArtefactPurgeJob(boss: PgBoss): Promise<void> {
  const { createWorker } = await import('../lib/createWorker.js');

  await createWorker<SandboxArtefactPurgePayload>({
    queue: SANDBOX_ARTEFACT_PURGE_JOB,
    boss,
    resolveOrgContext: (job) => ({
      organisationId: job.data.organisationId,
      subaccountId: job.data.subaccountId,
    }),
    handler: sandboxArtefactPurgeHandler,
  });

  logger.info('sandbox.artefact_purge.handler_registered');
}
