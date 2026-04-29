import { eq, and } from 'drizzle-orm';
import * as fs from 'node:fs';
import { db } from '../db/index.js';
import { executionFiles, executions } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { getS3Client, getBucketName } from '../lib/storage.js';

export class FileService {
  async uploadFile(
    executionId: string,
    userId: string,
    organisationId: string,
    file: Express.Multer.File
  ) {
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
}

export const fileService = new FileService();
