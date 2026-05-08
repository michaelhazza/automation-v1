// documentReembedJob.ts — Chunk 3D.
// Embedding-model upgrade sweep: for each document in the org where
// active_embedding_model != targetEmbeddingModel, re-embeds missing chunks
// under the new model, then atomically flips active_embedding_model after a
// count-verification step.
//
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §13.1, §13.3
// Invariants: §1.5 #9 (embedding outside tx), §1.5 #11 (afterCommit-only enqueue)

import type PgBoss from 'pg-boss';
import { sql, eq, and, isNull, ne } from 'drizzle-orm';
import { createWorker } from '../lib/createWorker.js';
import { db } from '../db/index.js';
import { referenceDocumentChunks, referenceDocuments } from '../db/schema/index.js';
import { embedChunks } from '../services/documentEmbeddingService.js';
import { persistChunks } from '../services/referenceDocumentService.js';
import { withOrgTx } from '../instrumentation.js';
import { logger } from '../lib/logger.js';

export interface DocumentReembedJobPayload {
  organisationId: string;
  targetEmbeddingModel: string; // the new embedding model to upgrade to
}

const MAX_DOCUMENTS_PER_RUN = 10;

export function registerDocumentReembedWorker(boss: PgBoss): void {
  createWorker<DocumentReembedJobPayload>({
    queue: 'document:reembed',
    boss,
    // Opt out of createWorker's auto-transaction: embedding MUST run outside any
    // DB transaction (spec invariant §1.5 #9). The handler manages its own
    // transaction boundary explicitly below.
    resolveOrgContext: () => null,
    handler: async (job) => {
      const { organisationId, targetEmbeddingModel } = job.data;

      // ── Find documents eligible for upgrade ───────────────────────────────
      // Eligible: retrieval_version_id IS NOT NULL and active_embedding_model != target.
      const eligibleDocs = await db
        .select({
          id: referenceDocuments.id,
          retrievalVersionId: referenceDocuments.retrievalVersionId,
          activeEmbeddingModel: referenceDocuments.activeEmbeddingModel,
        })
        .from(referenceDocuments)
        .where(
          and(
            eq(referenceDocuments.organisationId, organisationId),
            isNull(referenceDocuments.deletedAt),
            // retrieval_version_id IS NOT NULL — document has been chunked at least once
            sql`${referenceDocuments.retrievalVersionId} IS NOT NULL`,
            // active_embedding_model is either NULL or different from target
            sql`(${referenceDocuments.activeEmbeddingModel} IS NULL OR ${referenceDocuments.activeEmbeddingModel} != ${targetEmbeddingModel})`,
          ),
        )
        .limit(MAX_DOCUMENTS_PER_RUN);

      if (eligibleDocs.length === 0) {
        logger.info('documentReembedJob.no_eligible_docs', { organisationId, targetEmbeddingModel });
        return;
      }

      logger.info('documentReembedJob.starting', {
        organisationId,
        targetEmbeddingModel,
        documentCount: eligibleDocs.length,
      });

      // ── Process each document independently ──────────────────────────────
      for (const doc of eligibleDocs) {
        try {
          await processDocument({
            job,
            organisationId,
            documentId: doc.id,
            retrievalVersionId: doc.retrievalVersionId!,
            targetEmbeddingModel,
          });
        } catch (err) {
          // Per-document failure must not abort sibling documents.
          logger.error('documentReembedJob.document_failed', {
            organisationId,
            documentId: doc.id,
            targetEmbeddingModel,
            err,
          });
        }
      }
    },
  });
}

async function processDocument(opts: {
  job: { id: string };
  organisationId: string;
  documentId: string;
  retrievalVersionId: string;
  targetEmbeddingModel: string;
}): Promise<void> {
  const { job, organisationId, documentId, retrievalVersionId, targetEmbeddingModel } = opts;

  // ── Step 1: Pre-transaction reads (NO DB transaction held) ────────────────

  // 1a. Find chunks under the old (active) model — these are the source of
  //     truth for content. We need (chunkIndex, content, tokenCount).
  const oldModelChunks = await db
    .select({
      chunkIndex: referenceDocumentChunks.chunkIndex,
      content: referenceDocumentChunks.content,
      tokenCount: referenceDocumentChunks.tokenCount,
    })
    .from(referenceDocumentChunks)
    .where(
      and(
        eq(referenceDocumentChunks.documentId, documentId),
        eq(referenceDocumentChunks.versionId, retrievalVersionId),
        isNull(referenceDocumentChunks.deletedAt),
        // Any model that is NOT the target (covers the current active model)
        ne(referenceDocumentChunks.embeddingModel, targetEmbeddingModel),
      ),
    );

  if (oldModelChunks.length === 0) {
    logger.warn('documentReembedJob.no_source_chunks', {
      organisationId,
      documentId,
      retrievalVersionId,
      targetEmbeddingModel,
    });
    return;
  }

  const expectedTotal = oldModelChunks.length;

  // 1b. Find chunk indices already present under targetEmbeddingModel.
  const existingTargetChunks = await db
    .select({ chunkIndex: referenceDocumentChunks.chunkIndex })
    .from(referenceDocumentChunks)
    .where(
      and(
        eq(referenceDocumentChunks.documentId, documentId),
        eq(referenceDocumentChunks.versionId, retrievalVersionId),
        eq(referenceDocumentChunks.embeddingModel, targetEmbeddingModel),
        isNull(referenceDocumentChunks.deletedAt),
      ),
    );

  const existingIndices = new Set(existingTargetChunks.map((c) => c.chunkIndex));

  // 1c. Identify missing chunks (present under old model, absent under new model).
  const missingChunks = oldModelChunks.filter((c) => !existingIndices.has(c.chunkIndex));

  if (missingChunks.length === 0) {
    // All chunks already exist under the target model — only the pointer flip
    // is needed. Fall through to the transaction below with an empty embed result.
    logger.info('documentReembedJob.all_chunks_present', {
      organisationId,
      documentId,
      targetEmbeddingModel,
      expectedTotal,
    });
  }

  // 1d. Embed missing chunks OUTSIDE any DB transaction (spec invariant §1.5 #9).
  const embeddedChunks = missingChunks.length > 0
    ? await embedChunks(
        missingChunks.map((c) => ({
          versionId: retrievalVersionId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embeddingModel: targetEmbeddingModel,
        })),
      )
    : [];

  // ── Step 2: Short-lived DB transaction — no external I/O inside ──────────

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`,
    );

    await withOrgTx(
      {
        tx,
        organisationId,
        source: `pgboss:document:reembed:${job.id}:${documentId}`,
      },
      async () => {
        // 2a. Bulk-insert newly embedded chunks (ON CONFLICT DO NOTHING — idempotent).
        if (embeddedChunks.length > 0) {
          await persistChunks({
            chunks: embeddedChunks.map((ec) => {
              const src = missingChunks.find((c) => c.chunkIndex === ec.chunkIndex);
              return {
                organisationId,
                documentId,
                versionId: retrievalVersionId,
                chunkIndex: ec.chunkIndex,
                embeddingModel: ec.embeddingModel,
                embedding: ec.embedding,
                content: src?.content ?? '',
                tokenCount: src?.tokenCount ?? 0,
              };
            }),
          });
        }

        // 2b. Verify total chunk count under targetEmbeddingModel equals expected.
        const countResult = await tx
          .select({ count: sql<string>`count(*)` })
          .from(referenceDocumentChunks)
          .where(
            and(
              eq(referenceDocumentChunks.documentId, documentId),
              eq(referenceDocumentChunks.versionId, retrievalVersionId),
              eq(referenceDocumentChunks.embeddingModel, targetEmbeddingModel),
              isNull(referenceDocumentChunks.deletedAt),
            ),
          );

        const actualCount = parseInt(countResult[0]?.count ?? '0', 10);

        // 2c. Guard: if count is short, roll back and let pg-boss retry.
        if (actualCount < expectedTotal) {
          throw Object.assign(
            new Error(`REEMBED_COUNT_MISMATCH: expected ${expectedTotal}, found ${actualCount}`),
            { documentId, retrievalVersionId, targetEmbeddingModel, expectedTotal, actualCount },
          );
        }

        // 2d. Atomic pointer flip — only active_embedding_model changes here.
        await tx
          .update(referenceDocuments)
          .set({
            activeEmbeddingModel: targetEmbeddingModel,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(referenceDocuments.id, documentId),
              eq(referenceDocuments.organisationId, organisationId),
            ),
          );
      },
    );
  });

  logger.info('documentReembedJob.document_upgraded', {
    organisationId,
    documentId,
    targetEmbeddingModel,
    chunksEmbedded: embeddedChunks.length,
  });
}
