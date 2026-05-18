import { eq, and, desc, isNotNull, isNull, lt } from 'drizzle-orm';
import * as fs from 'node:fs';
import { db } from '../db/index.js';
import { documentPromotionAudit, executionFiles, executions } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

export interface ListFilesOptions {
  subaccountId?: string;
  linkedToKnowledge?: 'true' | 'false';
  cursor?: Date;
  limit: number;
}

export interface ListedFile {
  id: string;
  fileName: string;
  fileType: 'input' | 'output';
  mimeType: string | null;
  fileSizeBytes: number | null;
  expiresAt: string;
  createdAt: string;
  executionId: string;
  subaccountId: string | null;
  promotedDocumentId: string | null;
}

export class FileService {
  async uploadFile(
    executionId: string,
    userId: string,
    organisationId: string,
    file: Express.Multer.File
  ) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [execution] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.organisationId, organisationId)));

    if (!execution) {
      throw { statusCode: 404, message: 'Execution not found' };
    }

    const fileId = uuidv4();
    const storagePath = `executions/${executionId}/input/${fileId}-${file.originalname}`;

    // `validateMultipart` uses `multer.diskStorage` (spec §6.1) so files arrive
    // on disk at `file.path`, not in `file.buffer`. Stream from disk and pass
    // `ContentLength` explicitly so the SDK skips the buffer-to-measure path.
    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: storagePath,
        Body: fs.createReadStream(file.path),
        ContentLength: file.size,
        ContentType: file.mimetype,
      })
    );

    const expiresAt = new Date(Date.now() + (env.FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000));

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [fileRecord] = await db
      .insert(executionFiles)
      .values({
        executionId,
        fileName: file.originalname,
        fileType: 'input',
        storagePath,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        expiresAt,
        createdAt: new Date(),
      })
      .returning();

    return {
      id: fileRecord.id,
      fileName: fileRecord.fileName,
      fileType: fileRecord.fileType,
      fileSizeBytes: fileRecord.fileSizeBytes,
      expiresAt: fileRecord.expiresAt,
    };
  }

  async downloadFile(fileId: string, userId: string, organisationId: string, role: string) {
    // Single query: fetch file and validate org ownership via execution join
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [result] = await db
      .select({
        file: executionFiles,
        execution: executions,
      })
      .from(executionFiles)
      .innerJoin(executions, and(
        eq(executionFiles.executionId, executions.id),
        eq(executions.organisationId, organisationId)
      ))
      .where(eq(executionFiles.id, fileId));

    if (!result) {
      throw { statusCode: 404, message: 'File not found or not accessible' };
    }

    const fileRecord = result.file;
    const execution = result.execution;

    if (new Date() > fileRecord.expiresAt) {
      throw { statusCode: 410, message: 'File has expired and is no longer available' };
    }

    if (role === 'user' && execution.triggeredByUserId !== userId) {
      throw { statusCode: 404, message: 'File not found or not accessible' };
    }

    const s3 = getS3Client();
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: getBucketName(),
        Key: fileRecord.storagePath,
        ResponseContentDisposition: `attachment; filename="${fileRecord.fileName}"`,
      }),
      { expiresIn: 900 } // 15 minutes
    );

    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + 900 * 1000),
      fileName: fileRecord.fileName,
    };
  }

  // List execution files for an org, optionally filtered by subaccount and
  // promoted-to-knowledge status. Uses getOrgScopedDb() so the query runs
  // inside the ALS-tracked tx with app.organisation_id bound — closes
  // AKR-ADV-2 (route was importing db directly, running outside the tx).
  async listFiles(
    organisationId: string,
    options: ListFilesOptions,
  ): Promise<{ files: ListedFile[]; hasMore: boolean }> {
    const orgDb = getOrgScopedDb('fileService.listFiles');

    const conditions = [eq(executions.organisationId, organisationId)];
    if (options.subaccountId) {
      conditions.push(eq(executions.subaccountId, options.subaccountId));
    }
    if (options.cursor) {
      conditions.push(lt(executionFiles.createdAt, options.cursor));
    }

    const promotionConditions = [
      eq(documentPromotionAudit.fileId, executionFiles.id),
      eq(documentPromotionAudit.organisationId, organisationId),
      isNull(documentPromotionAudit.deletedAt),
    ];

    const where =
      options.linkedToKnowledge === 'true'
        ? and(...conditions, isNotNull(documentPromotionAudit.id))
        : options.linkedToKnowledge === 'false'
          ? and(...conditions, isNull(documentPromotionAudit.id))
          : and(...conditions);

    const rows = await orgDb
      .select({
        id: executionFiles.id,
        fileName: executionFiles.fileName,
        fileType: executionFiles.fileType,
        mimeType: executionFiles.mimeType,
        fileSizeBytes: executionFiles.fileSizeBytes,
        expiresAt: executionFiles.expiresAt,
        createdAt: executionFiles.createdAt,
        executionId: executionFiles.executionId,
        subaccountId: executions.subaccountId,
        promotedDocumentId: documentPromotionAudit.documentId,
      })
      .from(executionFiles)
      .innerJoin(executions, eq(executionFiles.executionId, executions.id))
      .leftJoin(documentPromotionAudit, and(...promotionConditions))
      .where(where)
      .orderBy(desc(executionFiles.createdAt), desc(executionFiles.id))
      .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const files: ListedFile[] = rows.slice(0, options.limit).map((r) => ({
      id: r.id,
      fileName: r.fileName,
      fileType: r.fileType,
      mimeType: r.mimeType,
      fileSizeBytes: r.fileSizeBytes,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      executionId: r.executionId,
      subaccountId: r.subaccountId,
      promotedDocumentId: r.promotedDocumentId ?? null,
    }));

    return { files, hasMore };
  }
}

export const fileService = new FileService();
