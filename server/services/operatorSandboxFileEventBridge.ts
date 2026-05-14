import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';

import { getS3Client, getBucketName } from '../lib/storage.js';
import { withBackoff } from '../lib/withBackoff.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { appendEvent } from './agentExecutionEventService.js';
import { emitAgentRunUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';
import {
  computeSha256,
  deriveFileEventType,
  detectMimeType,
  isPathSafe,
  shouldWatcherSkip,
} from './operatorSandboxFileEventBridgePure.js';

export interface FileEventInput {
  agentRunId: string;
  organisationId: string;
  subaccountId: string;
  ownerUserId: string | null;
  path: string;
  content: Buffer;
  emittedBy: 'tool_call' | 'watcher';
}

export interface WatcherFileEventInput extends FileEventInput {
  emittedBy: 'watcher';
  existingContentSha256: string | null;
}

function isR2Retryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) return true;
  }
  const e = err as { $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (typeof status !== 'number') return false;
  // 429 Too Many Requests + 408 Request Timeout are transient throttling /
  // timeout responses R2 commonly returns under load — must be retried.
  // 5xx covers the upstream-error class. Anything else (4xx auth / validation)
  // is permanent and would just burn retries.
  return status === 408 || status === 429 || status >= 500;
}

async function handleToolCallEvent(input: FileEventInput): Promise<void> {
  if (!isPathSafe(input.path)) {
    logger.warn('operator_file_event.path_rejected', { reason: 'unsafe_path', emittedBy: input.emittedBy });
    return;
  }

  const contentSha256 = computeSha256(input.content);
  const mimeType = detectMimeType(input.path);
  const storageKey = `runs/${input.agentRunId}/${input.path}`;

  await withBackoff(
    () =>
      getS3Client().send(
        new PutObjectCommand({
          Bucket: getBucketName(),
          Key: storageKey,
          Body: input.content,
          ContentType: mimeType,
        }),
      ),
    {
      label: 'operatorSandboxFileEventBridge.r2.put',
      maxAttempts: 3,
      isRetryable: isR2Retryable,
      correlationId: input.agentRunId,
      runId: input.agentRunId,
    },
  );

  const db = getOrgScopedDb('operatorSandboxFileEventBridge.handleToolCallEvent');
  const rows = await db.execute<{ version: number }>(sql`
    INSERT INTO operator_run_files
      (id, organisation_id, agent_run_id, path, version, size_bytes, content_sha256,
       mime_type, storage_key, owner_user_id, subaccount_id, emitted_by, emitted_at, created_at)
    VALUES
      (gen_random_uuid(), ${input.organisationId}, ${input.agentRunId}, ${input.path},
       1, ${input.content.length}, ${contentSha256}, ${mimeType}, ${storageKey},
       ${input.ownerUserId}, ${input.subaccountId}, ${input.emittedBy}, NOW(), NOW())
    ON CONFLICT (agent_run_id, path) DO UPDATE SET
      version        = operator_run_files.version + 1,
      size_bytes     = EXCLUDED.size_bytes,
      content_sha256 = EXCLUDED.content_sha256,
      mime_type      = EXCLUDED.mime_type,
      storage_key    = EXCLUDED.storage_key,
      emitted_by     = EXCLUDED.emitted_by,
      emitted_at     = NOW()
    RETURNING version
  `);

  const version = Number(rows[0].version);
  const eventType = deriveFileEventType(version);

  await appendEvent({
    runId: input.agentRunId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    payload:
      eventType === 'file.created'
        ? {
            eventType: 'file.created',
            critical: false,
            agentRunId: input.agentRunId,
            path: input.path,
            version: 1,
            mimeType,
            sizeBytes: input.content.length,
            contentSha256,
            storageKey,
            emittedBy: input.emittedBy,
            ownerUserId: input.ownerUserId,
          }
        : {
            eventType: 'file.modified',
            critical: false,
            agentRunId: input.agentRunId,
            path: input.path,
            version,
            mimeType,
            sizeBytes: input.content.length,
            contentSha256,
            storageKey,
            emittedBy: input.emittedBy,
            ownerUserId: input.ownerUserId,
          },
    sourceService: 'operatorSandboxFileEventBridge',
  });

  emitAgentRunUpdate(input.agentRunId, 'file.event', {
    eventType,
    path: input.path,
    version,
    mimeType,
    sizeBytes: input.content.length,
    storageKey,
  });

  logger.info('operator_file_event.emitted', {
    agentRunId: input.agentRunId,
    path: input.path,
    version,
    eventType,
    emittedBy: input.emittedBy,
  });
}

async function handleWatcherEvent(
  input: WatcherFileEventInput,
): Promise<{ success: true; suppressed?: boolean; reason?: string }> {
  if (!isPathSafe(input.path)) {
    logger.warn('operator_file_event.path_rejected', { reason: 'unsafe_path' });
    return { success: true, suppressed: true, reason: 'path_rejected' };
  }

  const computedSha256 = computeSha256(input.content);

  if (shouldWatcherSkip(input.existingContentSha256, computedSha256)) {
    logger.info('operator_file_event.watcher_deduped', {
      agentRunId: input.agentRunId,
      path: input.path,
    });
    return { success: true, suppressed: true, reason: 'lost_race_to_tool_call' };
  }

  await handleToolCallEvent({ ...input, emittedBy: 'watcher' });

  return { success: true };
}

export const operatorSandboxFileEventBridge = {
  handleToolCallEvent,
  handleWatcherEvent,
};
