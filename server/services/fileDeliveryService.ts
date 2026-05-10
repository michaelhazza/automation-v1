// File delivery service — manages run_artifacts (customer-facing file ledger).
// Spec §6.1.1–§6.1.5b. This service is the single write point for all
// customer-visible artifacts. Workers call fileDeliveryService.upload via
// the internal finalize route; the original iee_artifacts row is never moved.

import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { logger } from '../lib/logger.js';
import { withBackoff } from '../lib/withBackoff.js';
import { runArtifacts } from '../db/schema/runArtifacts.js';
import {
  deriveStorageKey,
  deriveSignedUrlExpiry,
  deriveRetainUntil,
} from './fileDeliveryServicePure.js';
import type { RunArtifact, UploadInput, UploadResult, SignedUrlOptions } from '../../shared/types/runArtifact.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function bufferStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function isRetryableS3Error(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = String(e.$metadata ? (e.$metadata as Record<string, unknown>).httpStatusCode ?? '' : '');
  // Retry on 429, 500, 502, 503, 504
  return ['429', '500', '502', '503', '504'].includes(code);
}

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

export async function upload(input: UploadInput): Promise<UploadResult> {
  const {
    organisationId,
    agentRunId,
    ieeRunId,
    artifactKind,
    displayName,
    mimeType,
    contentBuffer: rawContent,
    retainUntil: callerRetainUntil,
  } = input;

  // Materialise buffer so we can hash it
  const buf = Buffer.isBuffer(rawContent)
    ? rawContent
    : await bufferStream(rawContent as NodeJS.ReadableStream);

  const contentHash = sha256Hex(buf);
  const sizeBytes = buf.length;
  const storageKey = deriveStorageKey(organisationId, agentRunId, artifactKind, contentHash, mimeType);
  const now = new Date();
  const retainUntil = callerRetainUntil ?? deriveRetainUntil(artifactKind, now);

  // --- Upload to S3 with retry ---
  const s3 = getS3Client();
  const bucket = getBucketName();
  const region = process.env.S3_REGION ?? null;

  try {
    await withBackoff(
      () =>
        s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            Body: buf,
            ContentLength: sizeBytes,
            ContentType: mimeType,
          }),
        ),
      {
        label: 'fileDelivery.s3.put',
        maxAttempts: 3,
        isRetryable: isRetryableS3Error,
        correlationId: agentRunId,
        runId: agentRunId,
      },
    );
  } catch (err) {
    logger.error('file_delivery.s3_upload_failed', {
      organisationId,
      agentRunId,
      storageKey,
      error: err instanceof Error ? err.message : String(err),
    });
    throw { statusCode: 502, message: 'S3 upload failed after retries', errorCode: 's3_upload_failed' };
  }

  // --- Insert into run_artifacts (idempotent via unique index) ---
  const db = getOrgScopedDb('fileDeliveryService.upload');

  try {
    const [row] = await db
      .insert(runArtifacts)
      .values({
        organisationId,
        agentRunId,
        ieeRunId: ieeRunId ?? null,
        artifactKind,
        displayName,
        mimeType,
        sizeBytes,
        contentHash,
        storageProvider: 's3',
        storageKey,
        storageRegion: region,
        retainUntil,
      })
      .returning();

    logger.info('phase1.file_delivery.uploaded', {
      artifactId: row.id,
      organisationId,
      agentRunId,
      ieeRunId: ieeRunId ?? null,
      contentHash,
      sizeBytes,
      storageProvider: 's3',
      storageKey,
      mimeType,
      artifactKind,
      wasReplay: false,
    });

    return {
      artifactId: row.id,
      contentHash,
      sizeBytes,
      wasReplay: false,
    };
  } catch (err: unknown) {
    // 23505 = unique_violation — idempotent hit
    const pgErr = err as Record<string, unknown>;
    if (pgErr.code === '23505' && String(pgErr.constraint ?? '').includes('run_kind_hash_unique')) {
      const [existing] = await db
        .select()
        .from(runArtifacts)
        .where(
          and(
            eq(runArtifacts.organisationId, organisationId),
            eq(runArtifacts.agentRunId, agentRunId),
            eq(runArtifacts.artifactKind, artifactKind),
            eq(runArtifacts.contentHash, contentHash),
          ),
        )
        .limit(1);

      if (!existing) {
        throw err;
      }

      logger.info('phase1.file_delivery.uploaded', {
        artifactId: existing.id,
        organisationId,
        agentRunId,
        ieeRunId: ieeRunId ?? null,
        contentHash,
        sizeBytes,
        storageProvider: 's3',
        storageKey,
        mimeType,
        artifactKind,
        wasReplay: true,
      });

      return {
        artifactId: existing.id,
        contentHash,
        sizeBytes,
        wasReplay: true,
      };
    }

    // 23503 = foreign_key_violation on agent_run_id
    if (pgErr.code === '23503' && String(pgErr.constraint ?? '').includes('agent_run')) {
      throw { statusCode: 410, message: 'Agent run not found or deleted', errorCode: 'run_gone' };
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// issueSignedUrl
// ---------------------------------------------------------------------------

export async function issueSignedUrl(
  artifactId: string,
  organisationId: string,
  options: SignedUrlOptions = {},
): Promise<string> {
  const db = getOrgScopedDb('fileDeliveryService.issueSignedUrl');

  const [artifact] = await db
    .select()
    .from(runArtifacts)
    .where(
      and(
        eq(runArtifacts.id, artifactId),
        eq(runArtifacts.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!artifact) {
    throw { statusCode: 404, message: `Artifact ${artifactId} not found`, errorCode: 'artifact_not_found' };
  }

  const expiresIn = options.expiresIn ?? deriveSignedUrlExpiry(artifact.artifactKind as RunArtifact['artifactKind']);

  const s3 = getS3Client();
  const bucket = getBucketName();

  const safeDisplayName = artifact.displayName.replace(/[\r\n]/g, '').replace(/"/g, '\\"');
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: artifact.storageKey,
    ResponseContentDisposition: options.inlineDisposition
      ? `inline; filename="${safeDisplayName}"`
      : `attachment; filename="${safeDisplayName}"`,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

// ---------------------------------------------------------------------------
// listForRun
// ---------------------------------------------------------------------------

export async function listForRun(
  agentRunId: string,
  organisationId: string,
): Promise<RunArtifact[]> {
  const db = getOrgScopedDb('fileDeliveryService.listForRun');

  const rows = await db
    .select()
    .from(runArtifacts)
    .where(
      and(
        eq(runArtifacts.agentRunId, agentRunId),
        eq(runArtifacts.organisationId, organisationId),
      ),
    );

  // RLS deny → empty array (not 403), per spec error handling contract
  return rows.map((r) => ({
    id: r.id,
    organisationId: r.organisationId,
    agentRunId: r.agentRunId,
    ieeRunId: r.ieeRunId,
    artifactKind: r.artifactKind as RunArtifact['artifactKind'],
    displayName: r.displayName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    contentHash: r.contentHash,
    storageProvider: r.storageProvider as RunArtifact['storageProvider'],
    storageKey: r.storageKey,
    storageRegion: r.storageRegion,
    retainUntil: r.retainUntil,
    downloadCount: r.downloadCount,
    createdAt: r.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// deleteByRun — admin sweep helper; also used by retention job
// ---------------------------------------------------------------------------

export async function deleteByRun(
  agentRunId: string,
  organisationId: string,
): Promise<void> {
  const db = getOrgScopedDb('fileDeliveryService.deleteByRun');

  await db
    .delete(runArtifacts)
    .where(
      and(
        eq(runArtifacts.agentRunId, agentRunId),
        eq(runArtifacts.organisationId, organisationId),
      ),
    );
}
