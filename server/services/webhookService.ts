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
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executionFiles, executions, executionPayloads, users, automationEngines } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { emailService } from './emailService.js';
import { emitExecutionUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const webhookService = {
  /**
   * Returns the URL the external engine should POST results back to.
   * Format: <WEBHOOK_BASE_URL>/api/webhooks/callback/<executionId>
   *
   * Uses per-engine HMAC secret when provided, falls back to global
   * WEBHOOK_SECRET for backward compatibility with older executions.
   */
  buildReturnUrl(executionId: string, engineHmacSecret?: string): string {
    const base = (env.WEBHOOK_BASE_URL ?? '').replace(/\/$/, '');
    const path = `/api/webhooks/callback/${executionId}`;

    const secret = engineHmacSecret ?? env.WEBHOOK_SECRET;
    if (secret) {
      const token = crypto
        .createHmac('sha256', secret)
        .update(executionId)
        .digest('hex');
      return `${base}${path}?token=${token}`;
    }

    return `${base}${path}`;
  },

  /**
   * Compute the HMAC signature for an outbound request to an engine.
   * Included as X-Webhook-Signature header.
   */
  signOutboundRequest(executionId: string, hmacSecret: string): string {
    return crypto
      .createHmac('sha256', hmacSecret)
      .update(executionId)
      .digest('hex');
  },

  /**
   * Verifies an incoming callback token.
   * Accepts a per-engine secret or falls back to global WEBHOOK_SECRET.
   * Returns true when:
   *   - Neither per-engine nor global secret is configured (open mode), OR
   *   - The provided token matches the expected HMAC.
   */
  verifyCallbackToken(executionId: string, token?: string, engineHmacSecret?: string): boolean {
    const secret = engineHmacSecret ?? env.WEBHOOK_SECRET;
    if (!secret) return true;
    if (!token) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(executionId)
      .digest('hex');
    // Validate lengths match before timingSafeEqual (prevents throw on mismatched lengths)
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);
    if (tokenBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(tokenBuf, expectedBuf);
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
    returnWebhookUrl: string,
    options?: {
      auth?: Record<string, { access_token: string }>;
      config?: Record<string, unknown>;
      processId?: string;
    }
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

    const payload: Record<string, unknown> = {
      execution_id: executionId,
      input: userInput,
      _meta: {
        executionId,
        returnWebhookUrl,
        files: signedFiles,
      },
    };

    // Inject auth tokens (connection tokens keyed by slot name)
    if (options?.auth && Object.keys(options.auth).length > 0) {
      payload.auth = options.auth;
    }

    // Inject merged config
    if (options?.config && Object.keys(options.config).length > 0) {
      payload.config = options.config;
    }

    if (options?.processId) {
      payload.process_id = options.processId;
    }

    return payload;
  },

  /**
   * Process an incoming webhook callback from an external engine.
   * Returns a result object for the route to send as the HTTP response.
   */
  async processCallback(
    executionId: string,
    token: string | undefined,
    callbackPayload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    // 1. Look up the execution
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.id, executionId));

    if (!execution) {
      return { status: 200, body: { received: true, note: 'Execution not found — already processed or invalid' } };
    }

    // 2. Verify the HMAC token using per-engine secret (falls back to global)
    let engineHmacSecret: string | undefined;
    if (execution.engineId) {
      const [engine] = await db.select()
        .from(automationEngines)
        // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to fetch engine HMAC secret; engineId obtained from execution row"
        .where(eq(automationEngines.id, execution.engineId));
      engineHmacSecret = engine?.hmacSecret;
    }

    if (!this.verifyCallbackToken(executionId, token, engineHmacSecret)) {
      return { status: 401, body: { error: 'Invalid or missing webhook token' } };
    }

    // 3. Idempotency: if already completed/failed, still ack but skip update
    const terminalStatuses = ['completed', 'failed', 'timeout', 'cancelled'];
    if (terminalStatuses.includes(execution.status) && execution.callbackReceivedAt) {
      return { status: 200, body: { received: true, note: 'Callback already processed' } };
    }

    // 4. Determine success/failure from payload heuristic
    const isErrorPayload =
      !!callbackPayload.error ||
      callbackPayload.status === 'error' ||
      callbackPayload.status === 'failed';

    const now = new Date();
    const finalStatus = isErrorPayload ? 'failed' : 'completed';

    // 5. Update execution record
    await db
      .update(executions)
      .set({
        status: finalStatus,
        outputData: isErrorPayload ? null : (callbackPayload as unknown as Record<string, unknown>),
        errorMessage: isErrorPayload
          ? String(callbackPayload.error ?? callbackPayload.message ?? 'External engine reported an error')
          : null,
        callbackReceivedAt: now,
        completedAt: now,
        durationMs: execution.startedAt
          ? now.getTime() - execution.startedAt.getTime()
          : null,
        updatedAt: now,
      })
      .where(eq(executions.id, executionId));

    // Store raw callback payload in execution_payloads (keeps executions lean)
    await db
      .insert(executionPayloads)
      .values({ executionId, callbackPayload: callbackPayload as unknown as Record<string, unknown> })
      .onConflictDoUpdate({
        target: executionPayloads.executionId,
        set: { callbackPayload: callbackPayload as unknown as Record<string, unknown> },
      });

    // 6. Emit real-time WebSocket updates
    emitExecutionUpdate(executionId, 'execution:status', {
      status: finalStatus,
      outputData: isErrorPayload ? null : callbackPayload,
      errorMessage: isErrorPayload
        ? String(callbackPayload.error ?? callbackPayload.message ?? 'External engine reported an error')
        : null,
      durationMs: execution.startedAt ? now.getTime() - execution.startedAt.getTime() : null,
    });
    if (execution.subaccountId) {
      emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
        executionId, status: finalStatus,
      });
    }

    // 7. Send completion notification if the user opted in
    if (execution.notifyOnComplete && execution.triggeredByUserId) {
      try {
        const [user] = await db.select().from(users).where(and(eq(users.id, execution.triggeredByUserId), isNull(users.deletedAt)));
        if (user) {
          const [payloadRow] = await db
            .select({ processSnapshot: executionPayloads.processSnapshot })
            .from(executionPayloads)
            .where(eq(executionPayloads.executionId, executionId));
          const processName = (payloadRow?.processSnapshot as Record<string, unknown> | null)?.name as string | undefined ?? 'Process';
          await emailService.sendExecutionCompletionEmail(
            user.email,
            processName,
            executionId,
            finalStatus,
          );
        }
      } catch {
        /* Email failures don't affect the webhook acknowledgement */
      }
    }

    return { status: 200, body: { received: true, executionId, status: finalStatus } };
  },

  /**
   * Build a redacted copy of the outbound payload for audit storage.
   * Replaces auth tokens with "[REDACTED]".
   */
  redactPayloadForAudit(payload: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...payload };
    if (redacted.auth && typeof redacted.auth === 'object') {
      const authKeys = Object.keys(redacted.auth as Record<string, unknown>);
      const redactedAuth: Record<string, string> = {};
      for (const key of authKeys) {
        redactedAuth[key] = '[REDACTED]';
      }
      redacted.auth = redactedAuth;
    }
    return redacted;
  },
};
