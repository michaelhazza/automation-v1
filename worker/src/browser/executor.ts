// ---------------------------------------------------------------------------
// BrowserStepExecutor — Playwright-backed implementation of StepExecutor.
// Spec §6.3, §12.2 (selector fallback), §13.6 (recovery handled in
// playwrightContext.ts).
// ---------------------------------------------------------------------------

import path from 'path';
import { promises as fs } from 'fs';
import type { Page } from 'playwright';
import {
  type ExecutionAction,
  BROWSER_ACTION_TYPES,
} from '../../../shared/iee/actionSchema.js';
import type { Observation } from '../../../shared/iee/observation.js';
import { SafetyError } from '../../../shared/iee/failureReason.js';
import { failure, FailureError } from '../../../shared/iee/failure.js';
import type { BrowserTaskContract } from '../../../shared/iee/jobPayload.js';
import type { StepExecutor, ActionResult } from '../loop/executionLoop.js';
import { buildBrowserObservation } from './observe.js';
import { openPersistentContext } from './playwrightContext.js';
import { db } from '../db.js';
import { ieeArtifacts } from '../../../server/db/schema/ieeArtifacts.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { performLoginWithRetry, LoginFailedError } from './login.js';
import { ContractEnforcedPage } from './contractEnforcedPage.js';
import {
  validateDownloadedArtifact,
  createDownloadStallGuard,
  DownloadStallError,
  type ArtifactKind,
} from './artifactValidator.js';
import { getWebLoginConnectionForRun } from '../persistence/integrationConnections.js';
import { captureStreamingVideo } from './captureStreamingVideo.js';
import { sql } from 'drizzle-orm';
import { subaccountAgents } from '../../../server/db/schema/subaccountAgents.js';
import { agentRuns } from '../../../server/db/schema/agentRuns.js';

/**
 * Default navigation timeout when no browserTaskContract is present or no
 * per-task budget is specified. Used for legacy (non-contract) paths and
 * as an upper cap for the contract-driven nav timeout (we never wait
 * longer than NAV_TIMEOUT_MAX_MS on a single navigation to avoid one goto
 * burning the whole task budget).
 *
 * Audit fix (Blocker #4): previously NAV_TIMEOUT_MS was a hard-coded 30s
 * that ignored contract.timeoutMs. Slow paywall sites would time out at
 * 30s regardless of the contract setting. Navigation timeout is now
 * derived from the contract, capped at NAV_TIMEOUT_MAX_MS so a single
 * slow goto cannot consume the entire task budget.
 */
const NAV_TIMEOUT_DEFAULT_MS = 30_000;
const NAV_TIMEOUT_MAX_MS = 120_000;
const ACTION_TIMEOUT_MS = 10_000;
const SELECTOR_PRIMARY_TIMEOUT_MS = 5_000;

function resolveNavigationTimeoutMs(contract: BrowserTaskContract | undefined): number {
  if (!contract) return NAV_TIMEOUT_DEFAULT_MS;
  // Cap the contract timeout so no single navigation can swallow the whole
  // task budget. A fast-loading page still respects Playwright's own
  // domcontentloaded signal — this cap only bounds the failure case.
  return Math.min(contract.timeoutMs, NAV_TIMEOUT_MAX_MS);
}

export interface BuildBrowserExecutorInput {
  ieeRunId: string;
  organisationId: string;
  subaccountId: string | null;
  sessionKey: string | undefined;
  startUrl: string | undefined;
  // Spec v3.4 §6 Code Change D7 — paywall workflow integration
  webLoginConnectionId?: string;
  browserTaskContract?: BrowserTaskContract;
  mode?: 'standard' | 'login_test' | 'capture_video';
  correlationId?: string;
  /** Agent id for fingerprint dedup (T16 read path). */
  agentId?: string;
  /** Parent agent run id for runMetadata writes from the worker. */
  agentRunId?: string | null;
  /** Optional play-button selector for capture_video mode. */
  playSelector?: string;
}

export async function buildBrowserExecutor(
  input: BuildBrowserExecutorInput,
): Promise<StepExecutor> {
  const downloadsDir = path.join(env.WORKSPACE_BASE_DIR, input.ieeRunId, 'downloads');

  const { context } = await openPersistentContext({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    sessionKey: input.sessionKey,
    ieeRunId: input.ieeRunId,
    downloadsDir,
  });

  const page: Page = context.pages()[0] ?? (await context.newPage());

  // Navigation timeout for the whole function. Used by the login_test
  // post-login navigation, the startUrl navigation, and the per-step
  // navigate action. See resolveNavigationTimeoutMs for derivation.
  const navTimeoutMs = resolveNavigationTimeoutMs(input.browserTaskContract);

  // ── D7: deterministic paywall login BEFORE entering the LLM loop ─────────
  // Spec §6.4 / T20. The credentials object is fetched at this boundary,
  // used by performLogin, then dropped before the executor is returned so
  // it never enters the loop closure.
  if (input.webLoginConnectionId) {
    const correlationId = input.correlationId ?? input.ieeRunId;
    const screenshotPath = path.join(
      env.WORKSPACE_BASE_DIR,
      input.ieeRunId,
      'login-failure.png',
    );

    let creds: Awaited<ReturnType<typeof getWebLoginConnectionForRun>> | null;
    // Audit fix (Non-blocker #10): capture contentUrl + successSelector
    // separately so the login_test post-login validation block can use
    // them after `creds` is dropped by the finally clause.
    let loginTestContentUrl: string | undefined;
    let loginTestSuccessSelector: string | undefined;
    let loginTestLoginUrl: string | undefined;
    try {
      creds = await getWebLoginConnectionForRun(
        {
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          runId: input.ieeRunId,
        },
        input.webLoginConnectionId,
      );
      loginTestContentUrl = creds.config.contentUrl;
      loginTestSuccessSelector = creds.config.successSelector;
      loginTestLoginUrl = creds.config.loginUrl;
      // Audit fix (Non-blocker #12): retry transient failures up to 3
      // attempts before giving up. Hard failures (wrong credentials,
      // missing success-detection path) are NOT retried.
      await performLoginWithRetry(page, creds, {
        runId: input.ieeRunId,
        correlationId,
        screenshotPath,
      });
    } catch (err) {
      // Surface as a structured failure so the run terminates with an
      // auth_failure rather than a generic crash.
      //
      // Audit fix (Non-blocker #7): persist the failure screenshot to
      // iee_artifacts with kind='log' so operators can debug after the
      // container is cleaned up. The screenshot file itself remains
      // ephemeral in /tmp until artifact S3 upload lands (audit #6,
      // deferred); in the meantime the row at least gives us a
      // database-durable audit trail of which runs produced screenshots.
      let persistedArtifactId: string | null = null;
      if (err instanceof LoginFailedError && err.screenshotPath) {
        try {
          const [row] = await db
            .insert(ieeArtifacts)
            .values({
              ieeRunId: input.ieeRunId,
              organisationId: input.organisationId,
              kind: 'log',
              path: err.screenshotPath,
              metadata: {
                source: 'login_failure_screenshot',
                detectionFailures: err.detectionFailures,
                webLoginConnectionId: input.webLoginConnectionId,
              } as object,
            })
            .returning({ id: ieeArtifacts.id });
          persistedArtifactId = row?.id ?? null;
        } catch (persistErr) {
          logger.warn('iee.browser.login_screenshot_persist_failed', {
            ieeRunId: input.ieeRunId,
            error: persistErr instanceof Error ? persistErr.message : String(persistErr),
          });
        }
      }

      const detail =
        err instanceof LoginFailedError
          ? {
              reasons: err.detectionFailures,
              screenshotPath: err.screenshotPath,
              screenshotArtifactId: persistedArtifactId,
            }
          : { message: err instanceof Error ? err.message.slice(0, 200) : String(err) };
      try { await context.close(); } catch { /* swallow */ }
      throw new FailureError(failure('auth_failure', 'login_failed', detail));
    } finally {
      // Drop the reference — creds is not read after this block.
      // (We can't truly wipe a JS string, but setting to null allows GC
      // and prevents accidental capture in the executor closure below.)
      creds = null; // eslint-disable-line no-useless-assignment
    }

    // T2 — login_test mode short-circuits here.
    //
    // Audit fix (Non-blocker #10): navigate to contentUrl when configured
    // and validate the resulting page. The operator needs to see whether
    // the screenshot shows authenticated content or just the post-submit
    // redirect landing page. Validation signals:
    //   - navigatedToContentUrl — did we attempt a contentUrl navigation?
    //   - urlChangedFromLogin   — did the final URL move away from loginUrl?
    //   - successSelectorFound  — if a successSelector was configured, is
    //                             it visible on the final page? (null if
    //                             not configured — can't validate.)
    if (input.mode === 'login_test') {
      let navigatedToContentUrl = false;
      if (loginTestContentUrl) {
        try {
          await page.goto(loginTestContentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: navTimeoutMs,
          });
          navigatedToContentUrl = true;
        } catch (err) {
          logger.warn('iee.browser.login_test.content_url_navigation_failed', {
            ieeRunId: input.ieeRunId,
            contentUrl: loginTestContentUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const finalUrl = page.url();
      const urlChangedFromLogin = !!loginTestLoginUrl && finalUrl !== loginTestLoginUrl;

      let successSelectorFound: boolean | null = null;
      if (loginTestSuccessSelector) {
        try {
          await page.waitForSelector(loginTestSuccessSelector, { timeout: 3_000 });
          successSelectorFound = true;
        } catch {
          successSelectorFound = false;
        }
      }

      const proofPath = path.join(env.WORKSPACE_BASE_DIR, input.ieeRunId, 'login-success.png');
      try {
        await page.screenshot({ path: proofPath, fullPage: false });
      } catch (err) {
        logger.warn('iee.browser.login_test.screenshot_failed', {
          ieeRunId: input.ieeRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Throw a sentinel — browserTask.ts's login_test short-circuit
      // catches this and finalizes the run as completed. Pure throw means
      // there is no executor object that can ever be passed into the loop.
      try { await context.close(); } catch { /* swallow */ }
      throw new LoginTestComplete(proofPath, {
        finalUrl,
        navigatedToContentUrl,
        urlChangedFromLogin,
        successSelectorFound,
      });
    }

    // ── capture_video mode short-circuit ───────────────────────────────────
    // Equivalent of the Chrome "Video Downloader" extension: snoop network
    // traffic for the actual mp4/m3u8 the player loads, then refetch with
    // the session cookies (Playwright APIRequestContext for mp4, ffmpeg for
    // HLS). No LLM loop. The contract guard's framenavigated hook still
    // fires for the navigation inside captureStreamingVideo, so the domain
    // allow-list is enforced.
    if (input.mode === 'capture_video') {
      if (!input.startUrl) {
        try { await context.close(); } catch { /* swallow */ }
        throw new FailureError(
          failure('execution_error', 'capture_video_requires_start_url', {}),
        );
      }
      const outputPath = path.join(downloadsDir, `capture-${Date.now()}.mp4`);
      let pageTitle: string | null = null;
      let result: Awaited<ReturnType<typeof captureStreamingVideo>>;
      try {
        result = await captureStreamingVideo(context, page, {
          contentUrl: input.startUrl,
          outputPath,
          playSelector: input.playSelector ?? null,
          runId: input.ieeRunId,
          correlationId: input.correlationId ?? input.ieeRunId,
        });
        try { pageTitle = await page.title(); } catch { /* swallow */ }
      } catch (err) {
        try { await context.close(); } catch { /* swallow */ }
        throw err;
      }
      try { await context.close(); } catch { /* swallow */ }
      throw new CaptureVideoComplete(
        result.outputPath,
        result.source,
        result.capturedUrl,
        input.startUrl,
        pageTitle,
      );
    }
  }

  // ── D7: install ContractEnforcedPage hooks (deny-by-default) ─────────────
  // We attach the proxy purely for its event-driven side effects (domain
  // allow-list, redirect checks, download kind prefilter). The raw `Page`
  // is still passed to observe.ts / action handlers (which use a small
  // surface compatible with the proxy), but every step we assert no
  // violations were recorded by the proxy and terminate the run if any
  // appear.
  const contractGuard = input.browserTaskContract
    ? new ContractEnforcedPage(page, {
        contract: input.browserTaskContract,
        runId: input.ieeRunId,
        correlationId: input.correlationId ?? input.ieeRunId,
      })
    : null;

  if (input.startUrl) {
    try {
      // Route through the contract guard so startUrl is also subject to
      // the domain allow-list (pr-reviewer round 2 #2).
      if (contractGuard) {
        await contractGuard.goto(input.startUrl, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
        const violations = contractGuard.getViolations();
        if (violations.length > 0) {
          throw new FailureError(
            failure('environment_error', `contract_violation:${violations[0].kind}`, {
              kind: violations[0].kind,
              detail: violations[0].detail,
            }),
          );
        }
      } else {
        await page.goto(input.startUrl, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
      }
    } catch (err) {
      // Contract violations must terminate the run.
      if (err instanceof FailureError) throw err;
      // Audit fix (Non-blocker #9): startUrl navigation failure is no longer
      // silently swallowed. A failed initial navigation leaves the page at
      // about:blank and the LLM loop then tries to click selectors on an
      // empty page, producing confusing multi-step failures. Raise a clear
      // failure so the run terminates with an actionable reason.
      logger.warn('iee.browser.start_url_failed', {
        ieeRunId: input.ieeRunId,
        startUrl: input.startUrl,
        navTimeoutMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new FailureError(
        failure('environment_error', 'start_url_navigation_failed', {
          startUrl: input.startUrl,
          navTimeoutMs,
          error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        }),
      );
    }
  }

  let lastResult: string | undefined;
  let downloadEmitted = false;

  // Spec v3.4 §6.7.1 / T9 — assert no contract violations have accumulated.
  // Called before/after every step. Throws via failure() if any are present.
  function assertNoContractViolations(): void {
    if (!contractGuard) return;
    const violations = contractGuard.getViolations();
    if (violations.length === 0) return;
    const first = violations[0];
    throw new FailureError(
      failure('environment_error', `contract_violation:${first.kind}`, {
        kind: first.kind,
        detail: first.detail,
        metadata: first.metadata,
      }),
    );
  }

  return {
    mode: 'browser',
    availableActions: BROWSER_ACTION_TYPES,

    async observe(): Promise<Observation> {
      assertNoContractViolations();
      return buildBrowserObservation(page, lastResult);
    },

    async execute(action: ExecutionAction): Promise<ActionResult> {
      assertNoContractViolations();
      switch (action.type) {
        case 'navigate': {
          // Per pr-reviewer round 2 #2: navigation MUST go through the
          // contract guard so the domain allow-list is preventative, not
          // observational. Without contract: behave as before (no contract,
          // no enforcement).
          if (contractGuard) {
            await contractGuard.goto(action.url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
            // Hard stop if the guard refused — assertNoContractViolations()
            // will throw and the loop will terminate.
            assertNoContractViolations();
          } else {
            await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
          }
          lastResult = `navigated to ${action.url}`;
          return { output: { url: page.url() }, summary: lastResult };
        }
        case 'click': {
          await clickWithFallback(page, action.selector, action.fallbackText);
          lastResult = `clicked ${action.selector}`;
          return { output: { selector: action.selector }, summary: lastResult };
        }
        case 'type': {
          await typeWithFallback(page, action.selector, action.text, action.fallbackText);
          lastResult = `typed into ${action.selector}`;
          return { output: { selector: action.selector }, summary: lastResult };
        }
        case 'extract': {
          const text = await page.evaluate(() => document.body?.innerText ?? '');
          const slice = text.slice(0, 4000);
          lastResult = `extracted ${slice.length} chars matching: ${action.query}`;
          return { output: { query: action.query, snippet: slice }, summary: lastResult };
        }
        case 'download': {
          const downloadPromise = page.waitForEvent('download', { timeout: navTimeoutMs });
          await clickWithFallback(page, action.selector, undefined);
          const download = await downloadPromise;
          const suggestedName = download.suggestedFilename() || `download-${Date.now()}`;
          const savePath = path.join(downloadsDir, suggestedName);

          // T24 — download wall-clock guard.
          //
          // NOTE: Playwright's `download.saveAs()` does not expose a chunk
          // stream, so we cannot feed `guard.record()` and the stall +
          // throughput checks would falsely trip on any download longer than
          // `stallMs`. We disable those by setting stallMs / minBytesPerSec
          // to effectively no-op values; only the wall-clock check is
          // enforced from this call site. Per pr-reviewer B2.
          const wallClockMs = Math.min(
            input.browserTaskContract?.timeoutMs ?? 600_000,
            600_000,
          );
          const guard = createDownloadStallGuard({
            wallClockMs,
            stallMs: wallClockMs + 1, // disable stall trip
            minBytesPerSec: 0,        // disable throughput trip
            warmupMs: wallClockMs + 1,
          });
          try {
            await Promise.race([download.saveAs(savePath), guard.abortPromise]);
            guard.finish();
          } catch (err) {
            guard.finish();
            if (err instanceof DownloadStallError) {
              throw new FailureError(
                failure('connector_timeout', err.reason, {
                  bytesReceived: err.bytesReceived,
                }),
              );
            }
            throw err;
          }

          // T17 — validate before computing the content hash
          const expectedKind = input.browserTaskContract?.expectedArtifactKind as
            | ArtifactKind
            | undefined;
          const validation = await validateDownloadedArtifact(savePath, {
            expectedKind,
            expectedMimeTypePrefix: input.browserTaskContract?.expectedMimeTypePrefix,
          });
          if (!validation.ok) {
            throw new FailureError(
              failure('data_incomplete', validation.reason, {
                detail: validation.detail,
                ...validation.metadata,
              }),
            );
          }

          // T16 read path — short-circuit if the content hash matches what
          // we last successfully processed for this (subaccount_agent,
          // intent). The agent will see the lastResult on the next observe
          // and emit `done`. The end-of-run invariant accepts this branch
          // because terminationResult='no_new_content' only requires
          // fingerprintRead. Per pr-reviewer round 2 #3.
          const intent = input.browserTaskContract?.intent;
          if (intent && input.subaccountId && input.agentId && input.agentRunId) {
            const matched = await checkFingerprintMatch({
              organisationId: input.organisationId,
              subaccountId: input.subaccountId,
              agentId: input.agentId,
              intent,
              contentHash: validation.contentHash,
            });
            // Always mark fingerprintRead so the invariant can confirm the
            // cache was consulted (even on a miss).
            await markFingerprintRead(input.agentRunId, matched);
            if (matched) {
              lastResult = `no_new_content: contentHash matches last processed fingerprint for intent=${intent}; emit done`;
              return {
                output: {
                  noNewContent: true,
                  intent,
                  contentHash: validation.contentHash,
                },
                summary: lastResult,
              };
            }
          }

          await db.insert(ieeArtifacts).values({
            ieeRunId: input.ieeRunId,
            organisationId: input.organisationId,
            kind: 'download',
            path: savePath,
            sizeBytes: validation.sizeBytes,
            mimeType: validation.detectedMime ?? undefined,
            metadata: {
              selector: action.selector,
              suggestedName,
              contentHash: validation.contentHash,
              intent: input.browserTaskContract?.intent,
            } as object,
          });
          downloadEmitted = true;

          // Stage the candidate fingerprint into the parent agent_runs row
          // so the end-of-run hook can persist it after the invariant
          // passes. T16 write half. Per pr-reviewer round 2 #1 this writes
          // via the atomic jsonb merge helper.
          if (intent && input.agentRunId) {
            await markFingerprintCandidate(input.agentRunId, {
              intent,
              sourceUrl: page.url(),
              pageTitle: await page.title().catch(() => undefined),
              contentHash: validation.contentHash,
            });
          }

          lastResult = `downloaded ${suggestedName} (${validation.sizeBytes} bytes, sha256=${validation.contentHash.slice(0, 12)}…)`;
          assertNoContractViolations();
          return {
            output: {
              path: savePath,
              sizeBytes: validation.sizeBytes,
              contentHash: validation.contentHash,
              detectedMime: validation.detectedMime,
            },
            summary: lastResult,
            artifacts: [savePath],
          };
        }
        case 'done':
        case 'failed':
          // Terminal — handled by the loop. Return a no-op result.
          return { output: action, summary: action.type };
        default:
          throw new SafetyError(
            `browser executor received unsupported action type: ${(action as { type: string }).type}`,
          );
      }
    },

    async dispose(): Promise<void> {
      try {
        await context.close();
      } catch (err) {
        logger.warn('iee.browser.context_close_failed', {
          ieeRunId: input.ieeRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Clean up empty downloads dir if nothing was emitted
      if (!downloadEmitted) {
        await fs.rm(downloadsDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// T16 fingerprint read/stage helpers — worker side.
//
// The worker is the natural place to do the contentHash comparison because
// it is the only component that has the file bytes. The persist itself
// happens in server/lib/reportingAgentRunHook.ts at end-of-run; the worker
// stages the candidate into agent_runs.run_metadata so the hook has it.
// ---------------------------------------------------------------------------

interface FingerprintCheckArgs {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  intent: string;
  contentHash: string;
}

async function checkFingerprintMatch(args: FingerprintCheckArgs): Promise<boolean> {
  const rows = await db
    .select({ map: subaccountAgents.lastProcessedFingerprintsByIntent })
    .from(subaccountAgents)
    .where(
      sql`${subaccountAgents.organisationId} = ${args.organisationId}
          AND ${subaccountAgents.subaccountId} = ${args.subaccountId}
          AND ${subaccountAgents.agentId} = ${args.agentId}`,
    )
    .limit(1);
  const row = rows[0];
  if (!row?.map) return false;
  const map = row.map as Record<string, { contentHash?: string } | undefined>;
  return map[args.intent]?.contentHash === args.contentHash;
}

async function markFingerprintRead(agentRunId: string, matched: boolean): Promise<void> {
  // Atomic jsonb merge so we don't race with skill writes.
  const patch = JSON.stringify({
    fingerprintRead: true,
    ...(matched ? { terminationResult: 'no_new_content' } : {}),
  });
  await db.execute(sql`
    UPDATE agent_runs
       SET run_metadata = jsonb_set(
             COALESCE(run_metadata, '{}'::jsonb),
             '{reportingAgent}',
             COALESCE(run_metadata->'reportingAgent', '{}'::jsonb) || ${patch}::jsonb,
             true
           )
     WHERE id = ${agentRunId}
  `);
}

async function markFingerprintCandidate(
  agentRunId: string,
  fp: { intent: string; sourceUrl: string; pageTitle?: string; contentHash: string },
): Promise<void> {
  const patch = JSON.stringify({ fingerprint: fp });
  await db.execute(sql`
    UPDATE agent_runs
       SET run_metadata = jsonb_set(
             COALESCE(run_metadata, '{}'::jsonb),
             '{reportingAgent}',
             COALESCE(run_metadata->'reportingAgent', '{}'::jsonb) || ${patch}::jsonb,
             true
           )
     WHERE id = ${agentRunId}
  `);
}

// Suppress unused-import warning when only the type-side of agentRuns is needed.
void agentRuns;

// ---------------------------------------------------------------------------
// login_test mode — no executor is returned. browserTask.ts handles this
// branch by calling buildBrowserExecutor() in 'login_test' mode (which
// performs the login + success screenshot in this file's prelude), then
// receives a sentinel via the LoginTestComplete throw and finalizes the
// run as completed without entering runExecutionLoop. Spec v3.4 §6.3.1 / T2.
// ---------------------------------------------------------------------------

/**
 * LoginTestComplete sentinel. Thrown by buildBrowserExecutor after a
 * successful login_test run; caught by browserTask.ts's login_test
 * short-circuit and finalised as a completed run.
 *
 * Audit fix (Non-blocker #10): now carries post-login validation data so
 * operators can tell whether the screenshot actually shows an authenticated
 * content page or just the login page. The boolean fields distinguish
 * "login succeeded AND content is reachable" from "login succeeded but the
 * success-detection screenshot shows a stale / pre-auth page".
 */
export class LoginTestComplete {
  readonly _tag = 'LoginTestComplete' as const;
  constructor(
    public readonly screenshotPath: string,
    public readonly validation: {
      finalUrl: string;
      navigatedToContentUrl: boolean;
      urlChangedFromLogin: boolean;
      successSelectorFound: boolean | null;
    },
  ) {}
}

/**
 * capture_video mode sentinel — thrown by buildBrowserExecutor after the
 * streaming-video capture finishes. browserTask.ts catches it, validates +
 * persists the artifact via the existing validator, and finalizes the run.
 *
 * Carries enough info for the caller to record the artifact without having
 * to re-derive anything from the page state (which has already been closed).
 */
export class CaptureVideoComplete {
  readonly _tag = 'CaptureVideoComplete' as const;
  constructor(
    public readonly outputPath: string,
    public readonly source: 'mp4' | 'hls',
    public readonly capturedUrl: string,
    public readonly pageUrl: string,
    public readonly pageTitle: string | null,
  ) {}
}

// ---------------------------------------------------------------------------
// Selector fallback. Spec §12.2.
// ---------------------------------------------------------------------------

async function clickWithFallback(
  page: Page,
  selector: string,
  fallbackText: string | undefined,
): Promise<void> {
  const primary = page.locator(selector).first();
  try {
    await primary.click({ timeout: SELECTOR_PRIMARY_TIMEOUT_MS });
    return;
  } catch (err) {
    const fallbackSelector = buildFallbackSelector(selector, fallbackText);
    if (!fallbackSelector) throw err;
    try {
      await page.locator(fallbackSelector).first().click({ timeout: ACTION_TIMEOUT_MS });
    } catch {
      throw err;
    }
  }
}

async function typeWithFallback(
  page: Page,
  selector: string,
  text: string,
  fallbackText: string | undefined,
): Promise<void> {
  const primary = page.locator(selector).first();
  try {
    await primary.fill(text, { timeout: SELECTOR_PRIMARY_TIMEOUT_MS });
    return;
  } catch (err) {
    const fallbackSelector = buildFallbackSelector(selector, fallbackText);
    if (!fallbackSelector) throw err;
    try {
      await page.locator(fallbackSelector).first().fill(text, { timeout: ACTION_TIMEOUT_MS });
    } catch {
      throw err;
    }
  }
}

function buildFallbackSelector(selector: string, fallbackText: string | undefined): string | null {
  if (selector.startsWith('text=')) return null; // already text-based
  // Audit fix (Non-blocker #8): use Playwright's case-insensitive regex
  // text selector via /text/i. Previously `text=${JSON.stringify(str)}` was
  // case-sensitive and whitespace-sensitive, so "Click Submit" failed to
  // match a button that said "submit" on the page. Regex is evaluated
  // against the trimmed text content of elements.
  if (fallbackText && fallbackText.trim().length > 0) {
    const trimmed = fallbackText.trim();
    // Escape regex metacharacters so the LLM-provided text is matched
    // literally, not as a pattern.
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `text=/${escaped}/i`;
  }
  return `:has-text(${JSON.stringify(selector)})`;
}
