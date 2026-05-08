import type PgBoss from 'pg-boss';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { eq, and, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getPostCommitStore } from '../lib/postCommitEmitter.js';
import {
  documentPromotionAudit,
  referenceDocuments,
  referenceDocumentVersions,
  referenceDocumentDataSources,
  executionFiles,
  executions,
} from '../db/schema/index.js';
import { hashContent, hashSerialized, serializeDocument, DOC_DELIMITER_END } from './referenceDocumentServicePure.js';
import { countTokens, SUPPORTED_MODEL_FAMILIES } from './llmRouter.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import type { ReferenceDocumentVersion } from '../db/schema/referenceDocumentVersions.js';

// ---------------------------------------------------------------------------
// Document Promotion Service — promotes an execution_files row to a permanent
// reference_documents entry in a single transaction, with an idempotency
// anchor in document_promotion_audit.
//
// Jobs are enqueued STRICTLY AFTER the transaction commits — spec invariant §1.5 #11.
// ---------------------------------------------------------------------------

async function computeAllTokenCounts(content: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const family of SUPPORTED_MODEL_FAMILIES) {
    counts[family] = await countTokens({ modelFamily: family, content });
  }
  return counts;
}

export async function promoteFile(input: {
  fileId: string;
  name: string;
  description?: string;
  organisationId: string;
  subaccountId?: string;
  agentId?: string;
  scheduledTaskId?: string;
  taskInstanceId?: string;
  principalId?: string;
  boss: PgBoss;
}): Promise<{ documentId: string; versionId: string; auditId: string }> {
  const {
    fileId, name, description,
    organisationId, subaccountId, agentId, scheduledTaskId, taskInstanceId,
    principalId, boss,
  } = input;

  const orgTx = getOrgScopedDb('documentPromotionService.promoteFile');

  // Step 1: fetch the execution_files row — inner-join with executions to enforce org membership (B1)
  const [fileRow] = await orgTx
    .select({
      id: executionFiles.id,
      storagePath: executionFiles.storagePath,
      mimeType: executionFiles.mimeType,
      fileSizeBytes: executionFiles.fileSizeBytes,
    })
    .from(executionFiles)
    .innerJoin(executions, eq(executionFiles.executionId, executions.id))
    .where(and(
      eq(executionFiles.id, fileId),
      eq(executions.organisationId, organisationId),
    ))
    .limit(1);

  if (!fileRow) {
    throw { statusCode: 404, errorCode: 'FILE_NOT_FOUND', message: `Execution file ${fileId} not found` };
  }

  // Step 2: read file content from R2/S3 — OUTSIDE the transaction
  const s3 = getS3Client();
  const bucket = getBucketName();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: fileRow.storagePath });
  const result = await s3.send(cmd);
  const body = result.Body;
  if (!body) {
    throw new Error('Empty response from storage for file ' + fileId);
  }
  const content = await (body as { transformToString: (encoding?: string) => Promise<string> }).transformToString('utf-8');

  // Step 3: check for reserved delimiter — same guard as referenceDocumentService.create
  if (content.includes(DOC_DELIMITER_END)) {
    throw { statusCode: 400, errorCode: 'CONTENT_CONTAINS_DELIMITER', message: 'Document content contains reserved delimiter ---DOC_END---' };
  }

  // Step 4: compute hashes and token counts — OUTSIDE the transaction
  const contentHash = hashContent(content);
  const tokenCounts = await computeAllTokenCounts(content);

  // Step 5: DB writes on the ambient org-scoped transaction (B2 — no nested db.transaction())

  // 5a: check for existing audit row (pre-check before unique index collision)
  const [existing] = await orgTx
    .select()
    .from(documentPromotionAudit)
    .where(and(
      eq(documentPromotionAudit.fileId, fileId),
      isNull(documentPromotionAudit.deletedAt),
    ))
    .limit(1);

  if (existing) {
    throw { statusCode: 409, errorCode: 'FILE_ALREADY_PROMOTED', existingDocumentId: existing.documentId };
  }

  // 5b: INSERT reference_documents
  const [doc] = await orgTx
    .insert(referenceDocuments)
    .values({
      organisationId,
      subaccountId: subaccountId ?? null,
      name,
      description: description ?? null,
      sourceType: 'from_file',
      mode: 'auto',
      currentVersion: 0,
    })
    .returning();

  // Serialize with the real document ID for version 1
  const serialized = serializeDocument({ documentId: doc.id, version: 1, content });
  const serializedBytesHash = hashSerialized(serialized);

  // 5c: INSERT reference_document_versions (version 1)
  const [version] = await orgTx
    .insert(referenceDocumentVersions)
    .values({
      documentId: doc.id,
      version: 1,
      content,
      contentHash,
      tokenCounts: tokenCounts as ReferenceDocumentVersion['tokenCounts'],
      serializedBytesHash,
      changeSource: 'manual_upload',
    })
    .returning();

  // 5d: UPDATE reference_documents SET current_version_id + current_version
  await orgTx
    .update(referenceDocuments)
    .set({ currentVersionId: version.id, currentVersion: 1, updatedAt: new Date() })
    .where(and(
      eq(referenceDocuments.id, doc.id),
      eq(referenceDocuments.organisationId, organisationId),
    ));

  // 5e: INSERT reference_document_data_sources (exactly one non-null scope tier)
  await orgTx
    .insert(referenceDocumentDataSources)
    .values({
      organisationId,
      documentId: doc.id,
      subaccountId: subaccountId ?? null,
      agentId: agentId ?? null,
      scheduledTaskId: scheduledTaskId ?? null,
      taskInstanceId: taskInstanceId ?? null,
    });

  // 5f: INSERT document_promotion_audit (idempotency anchor) — catch 23505 for concurrent promotions (B3)
  let auditRow: typeof documentPromotionAudit.$inferSelect;
  try {
    [auditRow] = await orgTx
      .insert(documentPromotionAudit)
      .values({
        fileId,
        documentId: doc.id,
        organisationId,
        principalId: principalId ?? null,
      })
      .returning();
  } catch (err: unknown) {
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr?.code === '23505' && pgErr?.constraint === 'document_promotion_audit_unique_per_file') {
      // Transaction is aborted after a constraint violation — no further queries are safe.
      // The pre-check at 5a covers the non-concurrent case with the winner's documentId.
      // Concurrent losers receive 409 without existingDocumentId; callers should retry GET.
      throw { statusCode: 409, errorCode: 'FILE_ALREADY_PROMOTED' };
    }
    throw err;
  }

  // Step 6: enqueue jobs AFTER the outer transaction commits — spec invariant §1.5 #11 (B2)
  const payload = {
    organisationId,
    documentId: doc.id,
    versionId: version.id,
    promotionAuditId: auditRow.id,
  };
  const store = getPostCommitStore();
  if (store) {
    store.enqueue(() => {
      void boss.send('document:summarise', payload);
      void boss.send('document:chunk-embed', payload);
    });
  } else {
    // Fallback: outside request context (e.g., tests calling the service directly)
    await boss.send('document:summarise', payload);
    await boss.send('document:chunk-embed', payload);
  }

  return {
    documentId: doc.id,
    versionId: version.id,
    auditId: auditRow.id,
  };
}
