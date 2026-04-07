/**
 * fetchPaywalledContentService — backs the `fetch_paywalled_content` skill.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §6 (Code Change D).
 *
 * Responsibilities:
 *   1. Build a strict BrowserTaskContract from the agent's input.
 *   2. Enqueue an IEE browser task that performs login + download.
 *   3. Poll iee_runs until terminal status (or timeout).
 *   4. Return either:
 *        - { noNewContent: true } if the worker short-circuited via T16
 *          fingerprint match, OR
 *        - the resulting iee_artifacts row (path, contentHash, etc.).
 *
 * The skill is purely deterministic — no LLM calls inside the service. The
 * worker still uses the LLM execution loop for the in-page actions (click
 * the download button, etc.) under the contract enforcement we wired in
 * round 2 of the spec.
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { ieeArtifacts } from '../db/schema/ieeArtifacts.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { failure, FailureError } from '../../shared/iee/failure.js';
import { logger } from '../lib/logger.js';
import { enqueueIEETask } from './ieeExecutionService.js';
import type { BrowserTaskContract } from '../../shared/iee/jobPayload.js';

export interface FetchPaywalledContentInput {
  webLoginConnectionId: string;
  contentUrl: string;
  intent: 'download_latest' | 'download_by_url' | 'extract_text' | 'screenshot';
  allowedDomains: string[];
  expectedArtifactKind?: 'video' | 'audio' | 'document' | 'image' | 'text';
  expectedMimeTypePrefix?: string;
  /**
   * Capture mode:
   *  - 'download_button': click downloadSelector to trigger a Playwright
   *    download (sites that expose an explicit download button)
   *  - 'capture_video':   no download button — snoop the page network for
   *    the actual mp4/m3u8 the player loads, refetch with session cookies,
   *    save to disk (HLS via ffmpeg). Equivalent of the Chrome
   *    "Video Downloader" extension. Use this for 42 Macro and similar
   *    paywalled players.
   */
  captureMode?: 'download_button' | 'capture_video';
  /** Required when captureMode='download_button'. */
  downloadSelector?: string;
  /** Optional CSS selector for a play button when captureMode='capture_video'. */
  playSelector?: string;
  timeoutMs?: number;
}

export interface FetchPaywalledContentContext {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  correlationId: string;
}

export type FetchPaywalledContentResult =
  | {
      noNewContent: true;
      ieeRunId: string;
    }
  | {
      noNewContent: false;
      ieeRunId: string;
      artifactId: string;
      path: string;
      contentHash: string;
      sizeBytes: number | null;
      mimeType: string | null;
    };

const POLL_INTERVAL_MS = 1_500;
// Hard cap on how long this skill will block waiting for the worker. Slightly
// longer than the contract timeout so we always observe a terminal status
// rather than racing the worker.
const POLL_OVERHEAD_MS = 30_000;

export async function fetchPaywalledContent(
  input: FetchPaywalledContentInput,
  ctx: FetchPaywalledContentContext,
): Promise<FetchPaywalledContentResult> {
  const timeoutMs = input.timeoutMs ?? 300_000;
  const captureMode = input.captureMode ?? 'download_button';

  if (captureMode === 'download_button' && !input.downloadSelector) {
    throw new FailureError(
      failure('execution_error', 'download_selector_required', {
        hint: 'captureMode=download_button requires downloadSelector. For paywalled players with no download button, set captureMode=capture_video.',
      }),
    );
  }

  const goal =
    captureMode === 'capture_video'
      ? `Navigate to ${input.contentUrl}, snoop the page network for the streaming video URL, and download it (mp4 or HLS). No LLM loop.`
      : `Navigate to ${input.contentUrl} and click the download selector ${input.downloadSelector}. Then emit 'done' once the download completes.`;

  const contract: BrowserTaskContract = {
    webLoginConnectionId: input.webLoginConnectionId,
    intent: input.intent,
    allowedDomains: input.allowedDomains,
    expectedArtifactKind: input.expectedArtifactKind,
    expectedMimeTypePrefix: input.expectedMimeTypePrefix,
    successCondition: { artifactDownloaded: true },
    goal,
    maxSteps: 10,
    timeoutMs,
  };

  const enqueueResult = await enqueueIEETask({
    task: {
      type: 'browser',
      goal: contract.goal,
      startUrl: input.contentUrl,
      webLoginConnectionId: input.webLoginConnectionId,
      browserTaskContract: contract,
      mode: captureMode === 'capture_video' ? 'capture_video' : 'standard',
      playSelector: input.playSelector,
    },
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
    agentId: ctx.agentId,
    agentRunId: ctx.runId,
    correlationId: ctx.correlationId,
  });

  logger.info('fetchPaywalledContent.enqueued', {
    runId: ctx.runId,
    correlationId: ctx.correlationId,
    ieeRunId: enqueueResult.ieeRunId,
    deduplicated: enqueueResult.deduplicated,
  });

  // ── Poll iee_runs until terminal status ──────────────────────────────────
  const deadline = Date.now() + timeoutMs + POLL_OVERHEAD_MS;
  let terminalStatus: string | null = null;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ status: ieeRuns.status, failureReason: ieeRuns.failureReason })
      .from(ieeRuns)
      .where(eq(ieeRuns.id, enqueueResult.ieeRunId))
      .limit(1);
    if (row && (row.status === 'completed' || row.status === 'failed')) {
      terminalStatus = row.status;
      if (row.status !== 'completed') {
        throw new FailureError(
          failure(
            'execution_error',
            `iee_browser_${row.status}`,
            { ieeRunId: enqueueResult.ieeRunId, failureReason: row.failureReason ?? null },
          ),
        );
      }
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (terminalStatus !== 'completed') {
    throw new FailureError(
      failure('connector_timeout', 'fetch_paywalled_content_poll_timeout', {
        ieeRunId: enqueueResult.ieeRunId,
        waitedMs: timeoutMs + POLL_OVERHEAD_MS,
      }),
    );
  }

  // ── Check for the no_new_content short-circuit (T16 read path) ───────────
  const [arRow] = await db
    .select({ runMetadata: agentRuns.runMetadata })
    .from(agentRuns)
    .where(eq(agentRuns.id, ctx.runId))
    .limit(1);
  const ra =
    ((arRow?.runMetadata as Record<string, unknown> | null)?.reportingAgent as
      | { terminationResult?: string }
      | undefined) ?? {};
  if (ra.terminationResult === 'no_new_content') {
    return { noNewContent: true, ieeRunId: enqueueResult.ieeRunId };
  }

  // ── Resolve the latest download artifact for this IEE run ────────────────
  const [artifact] = await db
    .select()
    .from(ieeArtifacts)
    .where(
      and(
        eq(ieeArtifacts.ieeRunId, enqueueResult.ieeRunId),
        eq(ieeArtifacts.kind, 'download'),
      ),
    )
    .orderBy(desc(ieeArtifacts.createdAt))
    .limit(1);

  if (!artifact) {
    throw new FailureError(
      failure('data_incomplete', 'no_download_artifact_emitted', {
        ieeRunId: enqueueResult.ieeRunId,
      }),
    );
  }

  const meta = (artifact.metadata as { contentHash?: string } | null) ?? {};
  const contentHash = meta.contentHash;
  if (!contentHash) {
    throw new FailureError(
      failure('data_incomplete', 'artifact_missing_content_hash', {
        ieeRunId: enqueueResult.ieeRunId,
        artifactId: artifact.id,
      }),
    );
  }

  return {
    noNewContent: false,
    ieeRunId: enqueueResult.ieeRunId,
    artifactId: artifact.id,
    path: artifact.path,
    contentHash,
    sizeBytes: artifact.sizeBytes ?? null,
    mimeType: artifact.mimeType ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
