// ---------------------------------------------------------------------------
// BrowserStepExecutor — Playwright-backed implementation of StepExecutor.
// Spec §6.3, §12.2 (selector fallback), §13.6 (recovery handled in
// playwrightContext.ts).
// ---------------------------------------------------------------------------

import path from 'path';
import { promises as fs } from 'fs';
import type { BrowserContext, Page, Locator } from 'playwright';
import {
  type ExecutionAction,
  BROWSER_ACTION_TYPES,
} from '../../../shared/iee/actionSchema.js';
import type { Observation } from '../../../shared/iee/observation.js';
import { SafetyError, EnvironmentError } from '../../../shared/iee/failureReason.js';
import { failure, FailureError } from '../../../shared/iee/failure.js';
import type { BrowserTaskContract } from '../../../shared/iee/jobPayload.js';
import type { StepExecutor, ActionResult } from '../loop/executionLoop.js';
import { buildBrowserObservation } from './observe.js';
import { openPersistentContext } from './playwrightContext.js';
import { db } from '../db.js';
import { ieeArtifacts } from '../../../server/db/schema/ieeArtifacts.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { performLogin, LoginFailedError } from './login.js';
import { ContractEnforcedPage } from './contractEnforcedPage.js';
import {
  validateDownloadedArtifact,
  createDownloadStallGuard,
  DownloadStallError,
  type ArtifactKind,
} from './artifactValidator.js';
import { getWebLoginConnectionForRun } from '../persistence/integrationConnections.js';

const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const SELECTOR_PRIMARY_TIMEOUT_MS = 5_000;

export interface BuildBrowserExecutorInput {
  ieeRunId: string;
  organisationId: string;
  subaccountId: string | null;
  sessionKey: string | undefined;
  startUrl: string | undefined;
  // Spec v3.4 §6 Code Change D7 — paywall workflow integration
  webLoginConnectionId?: string;
  browserTaskContract?: BrowserTaskContract;
  mode?: 'standard' | 'login_test';
  correlationId?: string;
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
    let creds: Awaited<ReturnType<typeof getWebLoginConnectionForRun>> | null = null;
    try {
      creds = await getWebLoginConnectionForRun(
        {
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          runId: input.ieeRunId,
        },
        input.webLoginConnectionId,
      );
      await performLogin(page, creds, {
        runId: input.ieeRunId,
        correlationId,
        screenshotPath,
      });
    } catch (err) {
      // Surface as a structured failure so the run terminates with an
      // auth_failure rather than a generic crash.
      const detail =
        err instanceof LoginFailedError
          ? { reasons: err.detectionFailures, screenshotPath: err.screenshotPath }
          : { message: err instanceof Error ? err.message.slice(0, 200) : String(err) };
      try { await context.close(); } catch { /* swallow */ }
      throw new FailureError(failure('auth_failure', 'login_failed', detail));
    } finally {
      // Drop the reference. (We can't truly wipe a JS string, but losing
      // the only reference allows GC and prevents accidental capture in
      // the executor closure below.)
      creds = null;
    }

    // T2 — login_test mode short-circuits here. Optionally navigate to the
    // contentUrl for proof-of-paywall, capture a screenshot, then return a
    // no-op executor that immediately signals 'done' to the loop.
    if (input.mode === 'login_test') {
      const proofPath = path.join(env.WORKSPACE_BASE_DIR, input.ieeRunId, 'login-success.png');
      try {
        await page.screenshot({ path: proofPath, fullPage: false });
      } catch (err) {
        logger.warn('iee.browser.login_test.screenshot_failed', {
          ieeRunId: input.ieeRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return buildLoginTestExecutor({
        ieeRunId: input.ieeRunId,
        context,
        screenshotPath: proofPath,
      });
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
      await page.goto(input.startUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      logger.warn('iee.browser.start_url_failed', {
        ieeRunId: input.ieeRunId,
        startUrl: input.startUrl,
        error: err instanceof Error ? err.message : String(err),
      });
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
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
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
          const downloadPromise = page.waitForEvent('download', { timeout: NAV_TIMEOUT_MS });
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
// login_test mode — no-op StepExecutor that immediately reports done.
// Spec v3.4 §6.3.1 / T2.
// ---------------------------------------------------------------------------

function buildLoginTestExecutor(args: {
  ieeRunId: string;
  context: BrowserContext;
  screenshotPath: string;
}): StepExecutor {
  let emitted = false;
  return {
    mode: 'browser',
    availableActions: BROWSER_ACTION_TYPES,
    async observe(): Promise<Observation> {
      // Synthetic minimum-viable observation; the loop will not actually
      // call the LLM because execute() returns 'done' on the first turn.
      return {
        url: 'about:blank',
        pageText: 'login_test_mode_complete',
        clickableElements: [],
        inputs: [],
        lastActionResult: emitted ? 'login_test_done' : undefined,
      } as Observation;
    },
    async execute(): Promise<ActionResult> {
      // Per pr-reviewer S1 — this executor is intentionally only consumed by
      // browserTask.ts's login_test short-circuit (which calls dispose()
      // immediately after build). It is NOT loop-safe: handing it to
      // runExecutionLoop would still trigger an LLM call before execute()
      // fires, violating spec T2. Fail loudly if anything ever passes us
      // through the loop instead.
      emitted = true;
      throw new FailureError(
        failure('internal_error', 'login_test_executor_not_for_loop', {
          screenshotPath: args.screenshotPath,
        }),
      );
    },
    async dispose(): Promise<void> {
      try { await args.context.close(); } catch { /* swallow */ }
    },
  };
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
  if (fallbackText && fallbackText.trim().length > 0) {
    return `text=${JSON.stringify(fallbackText)}`;
  }
  return `:has-text(${JSON.stringify(selector)})`;
}
