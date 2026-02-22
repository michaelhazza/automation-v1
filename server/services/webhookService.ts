/**
 * webhookService
 *
 * Responsible for:
 *  1. Generating the per-execution return webhook URL that is injected into
 *     every outbound request so the external engine (n8n, Make, etc.) knows
 *     where to POST its results.
 *  2. Building the full outbound payload that is sent to the engine, including
 *     pre-signed download URLs for any R2 files attached to the execution.
 *  3. Verifying the HMAC signature on incoming callbacks (optional but
 *     recommended when WEBHOOK_SECRET is configured).
 *
 * The return URL is derived automatically from WEBHOOK_BASE_URL so users never
 * need to configure it per-task or per-execution.
 */

import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executionFiles, executions } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, getBucketName } from '../lib/storage.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const webhookService = {
  /**
   * Returns the URL the external engine should POST results back to.
   * Format: <WEBHOOK_BASE_URL>/api/webhooks/callback/<executionId>
   *
   * A HMAC token is appended as a query param so we can verify authenticity
   * without requiring the engine to send extra headers.
   */
  buildReturnUrl(executionId: string): string {
    const base = (env.WEBHOOK_BASE_URL ?? '').replace(/\/$/, '');
    const path = `/api/webhooks/callback/${executionId}`;

    if (env.WEBHOOK_SECRET) {
      const token = crypto
        .createHmac('sha256', env.WEBHOOK_SECRET)
        .update(executionId)
        .digest('hex');
      return `${base}${path}?token=${token}`;
    }

    return `${base}${path}`;
  },

  /**
   * Verifies an incoming callback token (if WEBHOOK_SECRET is set).
   * Returns true when:
   *   - WEBHOOK_SECRET is not configured (open mode), OR
   *   - The provided token matches the expected HMAC.
   */
  verifyCallbackToken(executionId: string, token?: string): boolean {
    if (!env.WEBHOOK_SECRET) return true;
    if (!token) return false;
    const expected = crypto
      .createHmac('sha256', env.WEBHOOK_SECRET)
      .update(executionId)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  },

  /**
   * Builds the full payload that is sent to the external engine.
   *
   * The payload merges:
   *  - The user-supplied inputData
   *  - The return webhook URL (so the engine knows where to send results)
   *  - Pre-signed download URLs for any files attached to the execution
   *    (so the engine can download them from R2 without needing credentials)
   *
   * The _meta key is a reserved namespace; the user's inputData is spread at
   * the top level so existing engine workflows don't need changes.
   */
  async buildOutboundPayload(
    executionId: string,
    inputData: unknown,
    returnWebhookUrl: string
  ): Promise<Record<string, unknown>> {
    // Fetch any files that were uploaded for this execution
    const files = await db
      .select()
      .from(executionFiles)
      .where(
        and(
          eq(executionFiles.executionId, executionId),
          eq(executionFiles.fileType, 'input')
        )
      );

    // Generate pre-signed download URLs for each file (1-hour validity so the
    // engine has enough time to download them even if it's a slow workflow)
    const signedFiles: Array<{
      fileId: string;
      fileName: string;
      mimeType: string | null;
      fileSizeBytes: number | null;
      downloadUrl: string;
      expiresAt: string;
    }> = [];

    if (files.length > 0) {
      const s3 = getS3Client();
      const bucket = getBucketName();

      for (const f of files) {
        try {
          const url = await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: bucket,
              Key: f.storagePath,
              ResponseContentDisposition: `attachment; filename="${f.fileName}"`,
            }),
            { expiresIn: 3600 } // 1 hour
          );
          signedFiles.push({
            fileId: f.id,
            fileName: f.fileName,
            mimeType: f.mimeType,
            fileSizeBytes: f.fileSizeBytes,
            downloadUrl: url,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          });
        } catch {
          // Non-fatal: if signing fails for one file, continue with others
        }
      }
    }

    const userInput =
      inputData !== null && typeof inputData === 'object' && !Array.isArray(inputData)
        ? (inputData as Record<string, unknown>)
        : { data: inputData };

    return {
      ...userInput,
      _meta: {
        executionId,
        returnWebhookUrl,
        files: signedFiles,
      },
    };
  },
};
