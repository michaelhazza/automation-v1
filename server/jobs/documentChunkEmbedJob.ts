// documentChunkEmbedJob.ts — Chunk 3C.
// Chunks a document version, embeds the chunks outside any DB transaction,
// then atomically flips retrieval_version_id after a count-verification step.
//
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §13.1, §13.3
// Invariants: §1.5 #9 (embedding outside tx), §1.5 #11 (afterCommit-only enqueue)

import type PgBoss from 'pg-boss';
import { sql, eq, and, isNull } from 'drizzle-orm';
import { createWorker } from '../lib/createWorker.js';
import { getJobConfig } from '../config/jobConfig.js';
import { db } from '../db/index.js';
import { referenceDocumentVersions, referenceDocumentChunks, referenceDocuments } from '../db/schema/index.js';
import { chunkDocument, DEFAULT_CHUNK_TARGET_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS } from '../services/documentChunkingServicePure.js';
import { embedChunks } from '../services/documentEmbeddingService.js';
import { persistChunks } from '../services/referenceDocumentService.js';
import { withOrgTx } from '../instrumentation.js';
import { logger } from '../lib/logger.js';

export interface DocumentChunkEmbedJobPayload {
  organisationId: string;
  documentId: string;
  versionId: string;
  promotionAuditId?: string;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

export function registerDocumentChunkEmbedWorker(boss: PgBoss): void {
  createWorker<DocumentChunkEmbedJobPayload>({
    queue: 'document:chunk-embed',
    boss,
    // Opt out of createWorker's auto-transaction: embedding MUST run outside any
    // DB transaction (spec invariant §1.5 #9). The handler manages its own
    // transaction boundary explicitly below.
    resolveOrgContext: () => null,
    handler: async (job) => {
      const { organisationId, documentId, versionId, promotionAuditId } = job.data;

      // ── Step 1: Pre-transaction reads and embedding (NO DB transaction held) ──

      // 1a. Read version content via plain db (no org-scoped tx required here —
      //     this is a direct read before we open the short-lived write tx).
      const [versionRow] = await db
        .select({ content: referenceDocumentVersions.content })
        .from(referenceDocumentVersions)
        .where(eq(referenceDocumentVersions.id, versionId))
        .limit(1);

      if (!versionRow) {
        logger.warn('documentChunkEmbedJob.version_not_found', { organisationId, documentId, versionId });
        return;
      }

      // 1b. Capture effective chunking config — runtime-immutable per job (spec §1.5 #M1).
      const targetTokens = DEFAULT_CHUNK_TARGET_TOKENS;
      const overlapTokens = DEFAULT_CHUNK_OVERLAP_TOKENS;

      // 1c. Chunk the content (pure, no I/O).
      const chunks = chunkDocument({ content: versionRow.content, targetTokens, overlapTokens });

      if (chunks.length === 0) {
        logger.warn('documentChunkEmbedJob.no_chunks', { organisationId, documentId, versionId });
        return;
      }

      const expectedTotal = chunks.length;

      // 1d. Embed all chunks — OUTSIDE any DB transaction (spec invariant §1.5 #9).
      const embeddedChunks = await embedChunks(
        chunks.map((c) => ({
          versionId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embeddingModel: EMBEDDING_MODEL,
        })),
      );

      // ── Step 2: Short-lived DB transaction — no external I/O inside ─────────

      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`,
        );

        await withOrgTx(
          {
            tx,
            organisationId,
            source: `pgboss:document:chunk-embed:${job.id}`,
          },
          async () => {
            // 2a. Bulk-insert chunks (ON CONFLICT DO NOTHING — idempotent on retry).
            await persistChunks({
              chunks: embeddedChunks.map((ec) => {
                const chunk = chunks.find((c) => c.chunkIndex === ec.chunkIndex);
                return {
                  organisationId,
                  documentId,
                  versionId: ec.versionId,
                  chunkIndex: ec.chunkIndex,
                  embeddingModel: ec.embeddingModel,
                  embedding: ec.embedding,
                  content: chunk?.content ?? '',
                  tokenCount: chunk?.tokenCount ?? 0,
                };
              }),
            });

            // 2b. Verify row count matches expected total.
            const countResult = await tx
              .select({ count: sql<string>`count(*)` })
              .from(referenceDocumentChunks)
              .where(
                and(
                  eq(referenceDocumentChunks.documentId, documentId),
                  eq(referenceDocumentChunks.versionId, versionId),
                  eq(referenceDocumentChunks.embeddingModel, EMBEDDING_MODEL),
                  isNull(referenceDocumentChunks.deletedAt),
                ),
              );

            const actualCount = parseInt(countResult[0]?.count ?? '0', 10);

            // 2c. Guard: if count is short, roll back and let pg-boss retry.
            if (actualCount < expectedTotal) {
              throw Object.assign(
                new Error(`CHUNK_COUNT_MISMATCH: expected ${expectedTotal}, found ${actualCount}`),
                { documentId, versionId, expectedTotal, actualCount },
              );
            }

            // 2d. Atomic pointer flip — retrieval_version_id, active_embedding_model,
            //     last_chunked_at all set in the same transaction (spec §13.1).
            await tx
              .update(referenceDocuments)
              .set({
                retrievalVersionId: versionId,
                activeEmbeddingModel: EMBEDDING_MODEL,
                lastChunkedAt: new Date(),
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

      // ── Step 3: Post-commit — enqueue downstream job if requested ───────────
      // MUST be after the transaction commits (spec invariant §1.5 #11).
      if (promotionAuditId) {
        await boss.send(
          'document:promotion-finalise',
          { organisationId, documentId, versionId, promotionAuditId },
          getJobConfig('document:promotion-finalise'),
        );
      }
    },
  });
}
