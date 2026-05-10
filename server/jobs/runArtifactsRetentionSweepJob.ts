/**
 * run-artifacts-retention-sweep — daily prune job (Phase 1 §6.1.2b).
 *
 * Hard-deletes S3 objects then DB rows where retain_until < now().
 * Processes in pages of 100 to bound per-tick blast radius. Emits
 * `phase1.file_delivery.expired` structured log after each hard-delete.
 *
 * Uses withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS
 * (cross-org maintenance sweep). Idempotency: fifo — each tick re-reads
 * current DB state; duplicate delivery is a safe no-op.
 *
 * See server/config/jobConfig.ts 'run-artifacts-retention-sweep'.
 */

import type PgBoss from 'pg-boss';
import { sql } from 'drizzle-orm';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { createWorker } from '../lib/createWorker.js';
import { logger } from '../lib/logger.js';

export const QUEUE = 'run-artifacts-retention-sweep';

const PAGE_SIZE = 100;

interface ExpiredArtifactRow {
  id: string;
  organisation_id: string;
  storage_key: string;
  retain_until: string;
}

export async function registerRunArtifactsRetentionSweepJob(boss: PgBoss): Promise<void> {
  await createWorker<Record<string, unknown>>({
    queue: QUEUE,
    boss,
    concurrency: 1,
    resolveOrgContext: () => null, // cross-org admin sweep

    handler: async () => {
      await withAdminConnection(
        {
          source: 'jobs.runArtifactsRetentionSweep',
          reason: 'Daily sweep of run_artifacts with retain_until < now()',
        },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);

          const s3 = getS3Client();
          const bucket = getBucketName();
          let totalDeleted = 0;

          // Paginate until a page smaller than PAGE_SIZE signals exhaustion
          let pageExhausted = false;
          while (!pageExhausted) {
            const rows = (await tx.execute(sql`
              SELECT id, organisation_id, storage_key, retain_until
              FROM run_artifacts
              WHERE retain_until IS NOT NULL
                AND retain_until < NOW()
              ORDER BY retain_until ASC
              LIMIT ${PAGE_SIZE}
            `)) as unknown as ExpiredArtifactRow[] | { rows?: ExpiredArtifactRow[] };

            const page: ExpiredArtifactRow[] = Array.isArray(rows)
              ? rows
              : Array.isArray((rows as { rows?: ExpiredArtifactRow[] }).rows)
                ? (rows as { rows: ExpiredArtifactRow[] }).rows
                : [];

            if (page.length === 0) break;

            // Track per-page progress so a full page that fails to delete any
            // rows (e.g. S3 outage, bad credentials) does not respin the same
            // result set forever within a single tick — exit and let the next
            // scheduled tick retry instead.
            let pageDeleted = 0;

            for (const artifact of page) {
              try {
                // Delete S3 object first — if S3 delete fails, DB row stays
                // and the next sweep tick will retry. Avoids orphaned rows.
                await s3.send(
                  new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: artifact.storage_key,
                  }),
                );
              } catch (err) {
                logger.warn('run_artifacts.retention_sweep.s3_delete_failed', {
                  artifactId: artifact.id,
                  storageKey: artifact.storage_key,
                  error: err instanceof Error ? err.message : String(err),
                });
                // Skip DB delete — row will be retried on next tick
                continue;
              }

              // Hard-delete the DB row
              try {
                await tx.execute(sql`
                  DELETE FROM run_artifacts WHERE id = ${artifact.id}::uuid
                `);

                const retainUntilDate = new Date(artifact.retain_until);
                const ageDays = Math.floor(
                  (Date.now() - retainUntilDate.getTime()) / (1000 * 60 * 60 * 24),
                );

                logger.info('phase1.file_delivery.expired', {
                  artifactId: artifact.id,
                  organisationId: artifact.organisation_id,
                  retainUntil: artifact.retain_until,
                  ageDays,
                });

                totalDeleted += 1;
                pageDeleted += 1;
              } catch (err) {
                logger.warn('run_artifacts.retention_sweep.db_delete_failed', {
                  artifactId: artifact.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            // Page smaller than limit means we've exhausted the result set
            if (page.length < PAGE_SIZE) pageExhausted = true;

            // If a full page yielded zero DB deletes the same rows would be
            // re-read on every iteration — defer to the next scheduled tick.
            if (pageDeleted === 0 && page.length === PAGE_SIZE) {
              logger.warn('run_artifacts.retention_sweep.no_progress_break', {
                pageSize: page.length,
              });
              pageExhausted = true;
            }
          }

          logger.info('run_artifacts.retention_sweep.completed', { totalDeleted });
        },
      );
    },
  });

  logger.info('run_artifacts.retention_sweep.handler_registered');
}
