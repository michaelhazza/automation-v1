/**
 * iee-run-completed event handler — main-app side.
 *
 * The IEE worker emits an 'iee-run-completed' pg-boss event after every
 * terminal iee_runs write (see worker/src/persistence/runs.ts::finalizeRun).
 * This handler consumes those events and finalises the parent agent_runs
 * row via finaliseAgentRunFromIeeRun.
 *
 * Idempotency: the finalisation service is idempotent, so duplicate event
 * deliveries (expected — worker retry sweep re-emits unemitted events) are
 * safe no-ops.
 *
 * See docs/iee-delegation-lifecycle-spec.md Step 3.
 */

import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { finaliseAgentRunFromIeeRun } from '../services/agentRunFinalizationService.js';
import { reportRenderingService } from '../services/reportRenderingService.js';
import * as fileDeliveryService from '../services/fileDeliveryService.js';
import { logger } from '../lib/logger.js';
import { getJobConfig } from '../config/jobConfig.js';
import { createWorker } from '../lib/createWorker.js';

// Pinned version recorded in the PDF Producer field (spec §4.4.3).
const PDF_RENDERER_VERSION = '4.5.1';

/**
 * Shape of the macroReport field written into iee_runs.resultSummary by the
 * worker's 42 Macro execution path. Optional — handler skips PDF generation
 * gracefully when this field is absent (non-macro browser runs).
 */
interface MacroReportSummary {
  date: string;
  source: { videoTitle: string; publishedDate: string; sourceUrl: string };
  executiveSummary: string[];
  fullAnalysis: { heading: string; body: string }[];
  transcriptExcerpt: string | null;
}

function extractMacroReport(resultSummary: unknown): MacroReportSummary | null {
  if (resultSummary === null || typeof resultSummary !== 'object') return null;
  const rs = resultSummary as Record<string, unknown>;
  const mr = rs.macroReport;
  if (mr === null || typeof mr !== 'object') return null;
  const m = mr as Record<string, unknown>;
  if (
    typeof m.date !== 'string' ||
    m.source === null || typeof m.source !== 'object' ||
    !Array.isArray(m.executiveSummary) ||
    !Array.isArray(m.fullAnalysis)
  ) return null;
  const src = m.source as Record<string, unknown>;
  if (
    typeof src.videoTitle !== 'string' ||
    typeof src.publishedDate !== 'string' ||
    typeof src.sourceUrl !== 'string'
  ) return null;
  return {
    date: m.date,
    source: {
      videoTitle: src.videoTitle,
      publishedDate: src.publishedDate,
      sourceUrl: src.sourceUrl,
    },
    executiveSummary: m.executiveSummary as string[],
    fullAnalysis: m.fullAnalysis as { heading: string; body: string }[],
    transcriptExcerpt: typeof m.transcriptExcerpt === 'string' ? m.transcriptExcerpt : null,
  };
}

export const QUEUE = 'iee-run-completed';

/**
 * Current supported event payload version. Bump the worker-side emitter
 * and this constant together when the shape changes. Events arriving
 * with a different version are rejected (logged and acked) rather than
 * parsed blindly — external review Blocker 6.
 */
const SUPPORTED_EVENT_VERSION = 1;

interface IeeRunCompletedPayload {
  version: number;
  eventKey: string;
  ieeRunId: string;
  status: 'completed' | 'failed' | 'cancelled';
  failureReason?: string | null;
  totalCostCents?: number;
  stepCount?: number;
}

/**
 * Shallow payload validation — enough to catch version mismatch and
 * gross shape drift before we hit the DB. The iee_runs row is the
 * source of truth, so we do not trust payload content beyond the
 * fields needed to locate the row.
 */
function validatePayload(data: unknown): IeeRunCompletedPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  // Pre-versioning (no `version` field) events are treated as v1 for
  // backwards compatibility with any in-flight pg-boss jobs at deploy
  // time. Future bumps should NOT accept a missing version.
  const version = typeof obj.version === 'number' ? obj.version : 1;
  if (version !== SUPPORTED_EVENT_VERSION) return null;
  if (typeof obj.ieeRunId !== 'string' || obj.ieeRunId.length === 0) return null;
  if (typeof obj.eventKey !== 'string') return null;
  if (obj.status !== 'completed' && obj.status !== 'failed' && obj.status !== 'cancelled') return null;
  return {
    version,
    eventKey: obj.eventKey,
    ieeRunId: obj.ieeRunId,
    status: obj.status,
    failureReason: typeof obj.failureReason === 'string' ? obj.failureReason : null,
    totalCostCents: typeof obj.totalCostCents === 'number' ? obj.totalCostCents : undefined,
    stepCount: typeof obj.stepCount === 'number' ? obj.stepCount : undefined,
  };
}

export async function registerIeeRunCompletedHandler(boss: PgBoss): Promise<void> {
  const config = getJobConfig(QUEUE);
  await createWorker<Record<string, unknown>>({
    queue: QUEUE,
    boss,
    concurrency: 4,
    resolveOrgContext: () => null,  // cross-org: payload carries no organisationId
    handler: async (job) => {
      // Validate payload shape + version before touching the DB.
      const payload = validatePayload(job.data);
      if (!payload) {
        logger.warn('iee.run_completed.invalid_payload', {
          jobId: job.id,
          rawKeys: typeof job.data === 'object' && job.data !== null
            ? Object.keys(job.data as Record<string, unknown>)
            : typeof job.data,
        });
        // Return (ack) rather than throw — retrying a malformed payload
        // will always produce the same result. Poison pills go to the DLQ
        // via retry exhaustion anyway; ack here keeps the sweep clean.
        return;
      }
      const { ieeRunId, eventKey } = payload;

      // Source-of-truth re-read. The event payload is a hint; the iee_runs row
      // is authoritative. This matters because the retry sweep may re-emit a
      // stale event after the main-app handler has already processed it.
      const [ieeRun] = await db
        .select()
        .from(ieeRuns)
        .where(eq(ieeRuns.id, ieeRunId))
        .limit(1);

      if (!ieeRun) {
        logger.warn('iee.run_completed.unknown_iee_run', { ieeRunId, eventKey });
        return;
      }

      try {
        await finaliseAgentRunFromIeeRun(ieeRun);
      } catch (err) {
        logger.error('iee.run_completed.finalise_failed', {
          ieeRunId,
          eventKey,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err; // let pg-boss retry / DLQ per jobConfig
      }

      // 42 Macro PDF branch — fires after happy-path finalisation (spec §4.4.3).
      // Only applies to completed browser runs that carry a macroReport payload.
      // Must NOT block run finalisation — wrapped in try/catch. Failures are
      // logged and swallowed so the agent run result is not affected.
      if (ieeRun.type === 'browser' && ieeRun.status === 'completed' && ieeRun.agentRunId) {
        const macroReport = extractMacroReport(ieeRun.resultSummary);
        if (macroReport) {
          const agentRunId = ieeRun.agentRunId;
          const organisationId = ieeRun.organisationId;

          let pdfBuf: Buffer | undefined;
          try {
            pdfBuf = await reportRenderingService.renderMacroReportPdf({
              organisationId,
              agentRunId,
              ieeRunId,
              date: macroReport.date,
              source: macroReport.source,
              executiveSummary: macroReport.executiveSummary,
              fullAnalysis: macroReport.fullAnalysis,
              transcriptExcerpt: macroReport.transcriptExcerpt,
              pdfRendererVersion: PDF_RENDERER_VERSION,
            });
          } catch (err) {
            logger.warn('phase1.macro.report_rendering_failed', {
              agentRunId,
              ieeRunId,
              attemptCount: 1,
              lastError: String(err),
            });
          }

          if (pdfBuf) {
            try {
              await fileDeliveryService.upload({
                organisationId,
                agentRunId,
                ieeRunId,
                artifactKind: 'report',
                displayName: 'Report.pdf',
                mimeType: 'application/pdf',
                contentBuffer: pdfBuf,
              });
            } catch (err) {
              logger.warn('phase1.macro.artifact_upload_failed', {
                agentRunId,
                ieeRunId,
                artifactKind: 'report',
                lastError: String(err),
              });
            }
          }
        }
      }
    },
  });

  logger.info('iee.run_completed.handler_registered', {
    retryLimit: config.retryLimit,
    deadLetter: 'deadLetter' in config ? config.deadLetter : undefined,
  });
}
