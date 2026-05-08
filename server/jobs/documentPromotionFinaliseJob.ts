// documentPromotionFinaliseJob.ts — Chunk 5B.
// Deferred durability flip: after the chunk-embed job has flipped
// retrieval_version_id, sets execution_files.expiresAt to a far-future
// sentinel (year 9999) so the promoted file is never pruned by the
// maintenance cleanup sweep.
//
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §4.6, §6.5, §8
// Invariants: §1.5 #11 (enqueued only after chunk-embed tx commits)

import type PgBoss from 'pg-boss';
import { eq, and, lt, sql } from 'drizzle-orm';
import { createWorker } from '../lib/createWorker.js';
import { db } from '../db/index.js';
import { documentPromotionAudit, executionFiles, referenceDocuments } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

// Far-future sentinel meaning "this file has been made durable and must not
// be pruned". Used because execution_files.expires_at is NOT NULL in the
// schema; spec §4.6 allows "NULL or far-future" — we choose far-future.
const DURABLE_SENTINEL = new Date('9999-12-31T00:00:00.000Z');
// Any expiresAt at or beyond this threshold is already the durable sentinel.
const DURABLE_THRESHOLD = new Date('9000-01-01T00:00:00.000Z');

export interface DocumentPromotionFinaliseJobPayload {
  organisationId: string;
  documentId: string;
  versionId: string;
  promotionAuditId: string;
}

export function registerDocumentPromotionFinaliseWorker(boss: PgBoss): void {
  createWorker<DocumentPromotionFinaliseJobPayload>({
    queue: 'document:promotion-finalise',
    boss,
    // Opt out of createWorker's auto-tx: this handler runs separate read and
    // write transactions and explicitly sets `app.organisation_id` inside each
    // tx that touches FORCE-RLS tables. The `executionFiles` write tx does
    // not need the GUC because that table is not RLS-protected.
    resolveOrgContext: () => null,
    handler: async (job) => {
      const { organisationId, documentId, promotionAuditId } = job.data;

      // Steps 1+2: Read retrieval_version_id and audit fileId in a single
      // short org-scoped read tx. `reference_documents` and
      // `document_promotion_audit` are both FORCE RLS — without setting
      // `app.organisation_id`, the policies fail-closed and return zero rows.
      // Explicit organisationId predicates remain as belt-and-braces (AKR-ADV-6).
      const { doc, audit } = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`,
        );

        const docRows = await tx
          .select({ retrievalVersionId: referenceDocuments.retrievalVersionId })
          .from(referenceDocuments)
          .where(
            and(
              eq(referenceDocuments.id, documentId),
              eq(referenceDocuments.organisationId, organisationId),
            ),
          )
          .limit(1);

        const auditRows = await tx
          .select({ fileId: documentPromotionAudit.fileId })
          .from(documentPromotionAudit)
          .where(
            and(
              eq(documentPromotionAudit.id, promotionAuditId),
              eq(documentPromotionAudit.organisationId, organisationId),
            ),
          )
          .limit(1);

        return { doc: docRows[0], audit: auditRows[0] };
      });

      // Step 1 guard: if chunk-embed has not yet flipped the pointer, throw so
      // pg-boss retries with exponential backoff (retryLimit: 5, retryBackoff:
      // true in jobConfig).
      if (!doc || !doc.retrievalVersionId) {
        throw Object.assign(
          new Error('RETRIEVAL_VERSION_NOT_READY: chunk-embed has not flipped the pointer yet'),
          { documentId, promotionAuditId },
        );
      }

      if (!audit) {
        // Audit row missing — this should be impossible given 5A is a
        // prerequisite, but guard against stale jobs from a failed 5A.
        throw Object.assign(
          new Error('PROMOTION_AUDIT_NOT_FOUND'),
          { promotionAuditId, documentId },
        );
      }

      const { fileId } = audit;

      // Steps 3+4: Read and flip in one transaction so the idempotency check
      // and the UPDATE are hermetic under concurrent retries.
      let flipped = false;
      await db.transaction(async (tx) => {
        const fileRows = await tx
          .select({ expiresAt: executionFiles.expiresAt })
          .from(executionFiles)
          .where(eq(executionFiles.id, fileId))
          .limit(1);

        const file = fileRows[0];
        if (!file) {
          // File has been deleted — nothing to flip. The audit row remains as
          // the durable-promotion record.
          logger.warn('document:promotion-finalise.file_not_found', { fileId, documentId, promotionAuditId });
          return;
        }

        if (file.expiresAt >= DURABLE_THRESHOLD) {
          // Already flipped on a previous run — no-op.
          logger.info('document:promotion-finalise.already_durable', { fileId, documentId });
          return;
        }

        await tx
          .update(executionFiles)
          .set({ expiresAt: DURABLE_SENTINEL })
          .where(
            and(
              eq(executionFiles.id, fileId),
              lt(executionFiles.expiresAt, DURABLE_THRESHOLD),
            ),
          );

        flipped = true;
      });

      if (flipped) {
        logger.info('document:promotion-finalise.durability_flip_applied', { fileId, documentId, promotionAuditId });
      }
    },
  });
}
