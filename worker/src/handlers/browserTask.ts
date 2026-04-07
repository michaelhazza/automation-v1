// ---------------------------------------------------------------------------
// pg-boss subscription for iee-browser-task. Spec §6.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { handleIEEJob } from './runHandler.js';
import { buildBrowserExecutor, LoginTestComplete, CaptureVideoComplete } from '../browser/executor.js';
import { validateDownloadedArtifact, type ArtifactKind } from '../browser/artifactValidator.js';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
import { ieeArtifacts } from '../../../server/db/schema/ieeArtifacts.js';
import { IEEJobPayload } from '../../../shared/iee/jobPayload.js';
import { loadRun, markRunning, finalizeRun } from '../persistence/runs.js';
import { logger } from '../logger.js';

const QUEUE = 'iee-browser-task';

export async function registerBrowserHandler(boss: PgBoss, workerInstanceId: string): Promise<void> {
  await boss.work(
    QUEUE,
    { teamSize: env.IEE_BROWSER_CONCURRENCY, teamConcurrency: 1 },
    async (job) => {
      // Spec v3.4 §6.3.1 / T2 — login_test and capture_video modes both
      // short-circuit the LLM loop. We perform the operation directly via
      // buildBrowserExecutor (which throws a sentinel) and finalize the
      // run. No LLM cost is incurred.
      const parsed = IEEJobPayload.safeParse(job.data);
      if (
        parsed.success &&
        parsed.data.task.type === 'browser' &&
        parsed.data.task.mode === 'capture_video'
      ) {
        await handleCaptureVideoJob(parsed.data, workerInstanceId);
        return;
      }
      if (
        parsed.success &&
        parsed.data.task.type === 'browser' &&
        parsed.data.task.mode === 'login_test'
      ) {
        const payload = parsed.data;
        const task = payload.task as Extract<typeof payload.task, { type: 'browser' }>;
        const run = await loadRun(payload.executionRunId);
        if (!run || run.status !== 'pending') return;
        const claimed = await markRunning(run.id, workerInstanceId);
        if (!claimed) return;
        const startMs = Date.now();
        try {
          // buildBrowserExecutor in login_test mode performs the login and
          // throws LoginTestComplete on success — there is no executor
          // object to keep around, by design (per pr-reviewer S1 the
          // login_test trap was removed entirely).
          await buildBrowserExecutor({
            ieeRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            sessionKey: task.sessionKey,
            startUrl: task.startUrl,
            webLoginConnectionId: task.webLoginConnectionId,
            browserTaskContract: task.browserTaskContract,
            mode: 'login_test',
            correlationId: payload.correlationId,
            agentId: run.agentId,
            agentRunId: run.agentRunId,
          });
          // Should not reach here — login_test always throws LoginTestComplete.
          throw new Error('login_test_unexpected_executor_returned');
        } catch (loginTestErr) {
          if (loginTestErr instanceof LoginTestComplete) {
            await finalizeRun({
              ieeRunId: run.id,
              status: 'completed',
              failureReason: null,
              resultSummary: {
                success: true,
                output: { mode: 'login_test', screenshotPath: loginTestErr.screenshotPath },
                stepCount: 0,
                durationMs: Date.now() - startMs,
              },
              stepCount: 0,
              llmCostCents: 0,
              llmCallCount: 0,
              runtimeWallMs: Date.now() - startMs,
              runtimeCpuMs: 0,
              runtimePeakRssBytes: 0,
              runtimeCostCents: 0,
            });
            logger.info('iee.login_test.complete', { ieeRunId: run.id });
            return;
          }
          // Login failed (or any other unexpected error). Finalize as failed.
          await finalizeRun({
            ieeRunId: run.id,
            status: 'failed',
            failureReason: 'auth_failure',
            resultSummary: {
              success: false,
              output: loginTestErr instanceof Error ? loginTestErr.message.slice(0, 500) : 'login_test failed',
              stepCount: 0,
              durationMs: Date.now() - startMs,
            },
            stepCount: 0,
            llmCostCents: 0,
            llmCallCount: 0,
            runtimeWallMs: Date.now() - startMs,
            runtimeCpuMs: 0,
            runtimePeakRssBytes: 0,
            runtimeCostCents: 0,
          });
          logger.warn('iee.login_test.failed', {
            ieeRunId: run.id,
            error: loginTestErr instanceof Error ? loginTestErr.message : String(loginTestErr),
          });
        }
        return;
      }

      await handleIEEJob({
        job,
        workerInstanceId,
        buildExecutor: async (run, payload) => {
          if (payload.task.type !== 'browser') {
            throw new Error(`browser handler received non-browser task: ${payload.task.type}`);
          }
          return buildBrowserExecutor({
            ieeRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            sessionKey: payload.task.sessionKey,
            startUrl: payload.task.startUrl,
            // Spec v3.4 §6 / Code Change D7 — paywall workflow wiring
            webLoginConnectionId: payload.task.webLoginConnectionId,
            browserTaskContract: payload.task.browserTaskContract,
            mode: payload.task.mode,
            correlationId: payload.correlationId,
            agentId: run.agentId,
            agentRunId: run.agentRunId,
          });
        },
      });
    },
  );
}

// ---------------------------------------------------------------------------
// capture_video mode handler — equivalent of the "Video Downloader" Chrome
// extension. Snoops the page network for the actual mp4/m3u8, downloads it
// with the session cookies, validates magic bytes, persists the artifact
// with a contentHash so the T16 fingerprint check still works, then writes
// the candidate fingerprint to agent_runs.run_metadata via the same atomic
// merge helper used by send_to_slack / transcribe_audio.
// ---------------------------------------------------------------------------

async function handleCaptureVideoJob(
  payload: ReturnType<typeof IEEJobPayload.parse>,
  workerInstanceId: string,
): Promise<void> {
  const task = payload.task as Extract<typeof payload.task, { type: 'browser' }>;
  const run = await loadRun(payload.executionRunId);
  if (!run || run.status !== 'pending') return;
  const claimed = await markRunning(run.id, workerInstanceId);
  if (!claimed) return;

  const startMs = Date.now();
  try {
    await buildBrowserExecutor({
      ieeRunId: run.id,
      organisationId: run.organisationId,
      subaccountId: run.subaccountId,
      sessionKey: task.sessionKey,
      startUrl: task.startUrl,
      webLoginConnectionId: task.webLoginConnectionId,
      browserTaskContract: task.browserTaskContract,
      mode: 'capture_video',
      correlationId: payload.correlationId,
      agentId: run.agentId,
      agentRunId: run.agentRunId,
      playSelector: task.playSelector,
    });
    // Should never get here — capture_video always throws CaptureVideoComplete
    // on success or a FailureError on any failure.
    throw new Error('capture_video_unexpected_executor_returned');
  } catch (err) {
    if (err instanceof CaptureVideoComplete) {
      // Validate the file the same way the standard download path does
      // (magic-bytes MIME check + minimum size + sha256 contentHash).
      const expectedKind = task.browserTaskContract?.expectedArtifactKind as
        | ArtifactKind
        | undefined;
      const validation = await validateDownloadedArtifact(err.outputPath, {
        expectedKind,
        expectedMimeTypePrefix: task.browserTaskContract?.expectedMimeTypePrefix,
      });
      if (!validation.ok) {
        await finalizeRun({
          ieeRunId: run.id,
          status: 'failed',
          failureReason: 'execution_error',
          resultSummary: {
            success: false,
            output: `capture_video validation failed: ${validation.reason} ${validation.detail}`,
            stepCount: 0,
            durationMs: Date.now() - startMs,
          },
          stepCount: 0,
          llmCostCents: 0,
          llmCallCount: 0,
          runtimeWallMs: Date.now() - startMs,
          runtimeCpuMs: 0,
          runtimePeakRssBytes: 0,
          runtimeCostCents: 0,
        });
        logger.warn('iee.capture_video.validation_failed', {
          ieeRunId: run.id,
          reason: validation.reason,
        });
        return;
      }

      // Persist the artifact + stage the fingerprint candidate so the
      // end-of-run hook can advance the dedup map. Same shape as the
      // standard download case in executor.ts.
      const [artifactRow] = await db
        .insert(ieeArtifacts)
        .values({
          ieeRunId: run.id,
          organisationId: run.organisationId,
          kind: 'download',
          path: err.outputPath,
          sizeBytes: validation.sizeBytes,
          mimeType: validation.detectedMime ?? undefined,
          metadata: {
            source: 'capture_video',
            captureKind: err.source,
            capturedUrl: err.capturedUrl.slice(0, 500),
            pageUrl: err.pageUrl,
            pageTitle: err.pageTitle,
            contentHash: validation.contentHash,
            intent: task.browserTaskContract?.intent,
          } as object,
        })
        .returning({ id: ieeArtifacts.id });

      // Stage fingerprint candidate via the same atomic jsonb merge helper.
      const intent = task.browserTaskContract?.intent;
      if (intent && run.agentRunId) {
        const fpJson = JSON.stringify({
          intent,
          sourceUrl: err.pageUrl,
          pageTitle: err.pageTitle ?? undefined,
          contentHash: validation.contentHash,
        });
        await db.execute(sql`
          UPDATE agent_runs
             SET run_metadata = jsonb_set(
                   COALESCE(run_metadata, '{}'::jsonb),
                   '{reportingAgent}',
                   COALESCE(run_metadata->'reportingAgent', '{}'::jsonb) || ${'{"fingerprint":' + fpJson + '}'}::jsonb,
                   true
                 )
           WHERE id = ${run.agentRunId}
        `);
      }

      await finalizeRun({
        ieeRunId: run.id,
        status: 'completed',
        failureReason: null,
        resultSummary: {
          success: true,
          output: {
            mode: 'capture_video',
            artifactId: artifactRow.id,
            source: err.source,
            sizeBytes: validation.sizeBytes,
            contentHash: validation.contentHash,
          },
          stepCount: 0,
          durationMs: Date.now() - startMs,
        },
        stepCount: 0,
        llmCostCents: 0,
        llmCallCount: 0,
        runtimeWallMs: Date.now() - startMs,
        runtimeCpuMs: 0,
        runtimePeakRssBytes: 0,
        runtimeCostCents: 0,
      });
      logger.info('iee.capture_video.complete', {
        ieeRunId: run.id,
        source: err.source,
        sizeBytes: validation.sizeBytes,
      });
      return;
    }

    // Any other error — finalize as failed.
    await finalizeRun({
      ieeRunId: run.id,
      status: 'failed',
      failureReason: 'execution_error',
      resultSummary: {
        success: false,
        output: err instanceof Error ? err.message.slice(0, 500) : 'capture_video failed',
        stepCount: 0,
        durationMs: Date.now() - startMs,
      },
      stepCount: 0,
      llmCostCents: 0,
      llmCallCount: 0,
      runtimeWallMs: Date.now() - startMs,
      runtimeCpuMs: 0,
      runtimePeakRssBytes: 0,
      runtimeCostCents: 0,
    });
    logger.warn('iee.capture_video.failed', {
      ieeRunId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
