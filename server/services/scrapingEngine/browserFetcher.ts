/**
 * browserFetcher — Tier 2 scraping via the IEE browser infrastructure.
 *
 * Phase 1: plain Playwright navigation — navigate to the URL and extract the
 * fully rendered HTML. No login, no download, no LLM loop.
 *
 * Phase 3 TODO: wire in the stealth plugin (puppeteer-extra-plugin-stealth or
 * playwright-stealth) on the worker side to handle bot-detection challenges.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { ieeRuns } from '../../db/schema/ieeRuns.js';
import { enqueueIEETask } from '../ieeExecutionService.js';
import { logger } from '../../lib/logger.js';
import type { TierResult } from './types.js';

const POLL_INTERVAL_MS = 1_500;
// Allow extra headroom beyond the browser task timeout so we always observe
// a terminal status rather than racing the worker.
const POLL_OVERHEAD_MS = 30_000;
const BROWSER_TIMEOUT_MS = 30_000;

export async function browserFetch(
  url: string,
  context: { orgId: string; subaccountId: string | null; agentId: string; runId: string },
): Promise<TierResult> {
  const hostname = new URL(url).hostname;
  const goal = `Navigate to ${url} and extract the fully rendered HTML of the page. Do not interact with any elements. Return the complete page HTML in the result summary under the key "html".`;

  let enqueueResult: Awaited<ReturnType<typeof enqueueIEETask>>;
  try {
    enqueueResult = await enqueueIEETask({
      task: {
        type: 'browser',
        goal,
        startUrl: url,
        mode: 'standard',
        browserTaskContract: {
          intent: 'extract_text',
          allowedDomains: [hostname],
          successCondition: { selectorPresent: 'body' },
          goal,
          maxSteps: 3,
          timeoutMs: BROWSER_TIMEOUT_MS,
        },
      },
      organisationId: context.orgId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      correlationId: context.runId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('browserFetch.enqueue_failed', { url, error: message });
    return { success: false, wasBlocked: false, error: `IEE enqueue failed: ${message}` };
  }

  logger.info('browserFetch.enqueued', {
    url,
    ieeRunId: enqueueResult.ieeRunId,
    deduplicated: enqueueResult.deduplicated,
  });

  // ── Poll iee_runs until terminal status ───────────────────────────────────
  const deadline = Date.now() + BROWSER_TIMEOUT_MS + POLL_OVERHEAD_MS;

  while (Date.now() < deadline) {
    const [row] = await db
      .select({ status: ieeRuns.status, resultSummary: ieeRuns.resultSummary, failureReason: ieeRuns.failureReason })
      .from(ieeRuns)
      .where(and(eq(ieeRuns.id, enqueueResult.ieeRunId), eq(ieeRuns.organisationId, context.orgId)))
      .limit(1);

    if (!row) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (row.status === 'completed') {
      const summary = row.resultSummary as Record<string, unknown> | null;
      const html = typeof summary?.html === 'string' ? summary.html : undefined;

      if (!html) {
        logger.warn('browserFetch.no_html_in_result', { ieeRunId: enqueueResult.ieeRunId });
        return {
          success: false,
          wasBlocked: false,
          error: 'Browser task completed but returned no HTML in result summary',
        };
      }

      return {
        success: true,
        html,
        wasBlocked: false,
      };
    }

    if (row.status === 'failed') {
      const reason = row.failureReason ?? 'unknown';
      // Classify the failure so the engine can decide whether to escalate.
      // Navigation/bot-detection failures mean the page is likely blocking us —
      // treat as wasBlocked so Tier 3 is attempted. Infrastructure failures
      // (timeout waiting for a slot, worker crash) are not blocking signals.
      const wasBlocked =
        reason.includes('navigation') ||
        reason.includes('blocked') ||
        reason.includes('bot') ||
        reason.includes('captcha');
      logger.warn('browserFetch.iee_failed', {
        ieeRunId: enqueueResult.ieeRunId,
        failureReason: reason,
        wasBlocked,
      });
      return {
        success: false,
        wasBlocked,
        error: `IEE browser task failed: ${reason}`,
      };
    }

    // pending or running — keep polling
    await sleep(POLL_INTERVAL_MS);
  }

  // Deadline exceeded
  logger.warn('browserFetch.poll_timeout', { ieeRunId: enqueueResult.ieeRunId, url });
  return {
    success: false,
    wasBlocked: false,
    error: `Browser fetch timed out after ${BROWSER_TIMEOUT_MS + POLL_OVERHEAD_MS}ms`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
