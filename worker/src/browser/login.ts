// ---------------------------------------------------------------------------
// performLogin — deterministic paywall login that runs BEFORE the LLM
// execution loop is entered.
//
// Spec: docs/reporting-agent-paywall-workflow-spec.md §6.4 (login flow),
// §6.6.1 (worker secret handling), §6.6 / T1 (no plaintext in queue),
// §6.4 / T20 (three-tier success detection).
//
// Key invariants:
//
//   1. The credentials object never enters the LLM execution loop. The
//      caller (runHandler / browserTask) calls performLogin BEFORE
//      handing the page to the loop, then discards the credentials.
//
//   2. Three-tier success detection (T20), in priority order:
//        a. successSelector (if configured) — most reliable
//        b. URL changed away from loginUrl
//        c. A new session-like cookie was set by the login response
//      The first one that succeeds wins. We accumulate failure reasons
//      only if all three fail.
//
//   3. On failure: capture a screenshot artifact for operator debugging
//      and throw a structured failure object that includes the failed
//      detection reasons.
//
//   4. The function NEVER logs the password and NEVER includes credentials
//      in the thrown error object — error metadata is limited to the
//      detection failures and the screenshot path.
// ---------------------------------------------------------------------------

import type { Page } from 'playwright';
import type { DecryptedWebLoginCredentials, WebLoginConfig } from '../persistence/integrationConnections.js';
import { logger } from '../logger.js';

export class LoginFailedError extends Error {
  readonly _tag = 'LoginFailedError' as const;
  constructor(
    message: string,
    public readonly detectionFailures: string[],
    public readonly screenshotPath: string | null,
    public readonly metadata: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface PerformLoginResult {
  loginDurationMs: number;
  successDetectionMethod: 'selector' | 'url_change' | 'session_cookie';
  finalUrl: string;
}

const SESSION_COOKIE_NAME_PATTERN = /session|sess|sid|auth|token/i;
const SESSION_COOKIE_MIN_VALUE_LENGTH = 8;

/**
 * Run the deterministic login flow against the given Playwright page.
 *
 * Throws `LoginFailedError` on any failure (selector miss, navigation
 * timeout, success detection unmet). The error carries the detection
 * failures + screenshot path so operators can diagnose without re-running.
 */
export async function performLogin(
  page: Page,
  creds: DecryptedWebLoginCredentials,
  opts: { runId: string; correlationId: string; screenshotPath: string },
): Promise<PerformLoginResult> {
  const start = Date.now();
  const config = creds.config;
  const timeoutMs = config.timeoutMs ?? 30_000;

  logger.info('worker.perform_login.start', {
    runId: opts.runId,
    correlationId: opts.correlationId,
    connectionId: creds.id,
    loginUrl: config.loginUrl,
    hasSuccessSelector: !!config.successSelector,
  });

  try {
    // 1. Navigate to the login page
    await page.goto(config.loginUrl, { waitUntil: 'networkidle', timeout: timeoutMs });

    // 2. Fill credentials. The username/password selectors must be present
    //    in the resolved config — defaults are applied at the persistence
    //    layer (webLoginConnectionService.resolveCredentials).
    const usernameSelector = config.usernameSelector ?? 'input[type=email], input[name=email], #email';
    const passwordSelector = config.passwordSelector ?? 'input[type=password], #password';
    const submitSelector = config.submitSelector ?? 'button[type=submit], input[type=submit]';

    await page.fill(usernameSelector, config.username, { timeout: timeoutMs });
    await page.fill(passwordSelector, creds.password, { timeout: timeoutMs });

    // 3. Submit and wait for navigation. We race wait-for-navigation against
    //    the click so a stable post-submit state is reached before checking
    //    the success conditions. The navigation may not happen for SPA
    //    flows — in that case the wait silently times out and we fall
    //    through to the cookie / URL detection branches.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => null),
      page.click(submitSelector, { timeout: timeoutMs }),
    ]);

    // 4. Three-tier success detection (T20)
    const failures: string[] = [];
    let detectionMethod: PerformLoginResult['successDetectionMethod'] | null = null;

    // Tier 1 — successSelector
    if (config.successSelector) {
      try {
        await page.waitForSelector(config.successSelector, { timeout: timeoutMs });
        detectionMethod = 'selector';
      } catch {
        failures.push('selector_not_found');
      }
    }

    // Tier 2 — URL change
    if (!detectionMethod) {
      const currentUrl = page.url();
      if (currentUrl !== config.loginUrl) {
        detectionMethod = 'url_change';
      } else {
        failures.push('url_unchanged');
      }
    }

    // Tier 3 — session cookie presence
    if (!detectionMethod) {
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find(
        (c) =>
          SESSION_COOKIE_NAME_PATTERN.test(c.name) &&
          c.value &&
          c.value.length >= SESSION_COOKIE_MIN_VALUE_LENGTH,
      );
      if (sessionCookie) {
        detectionMethod = 'session_cookie';
      } else {
        failures.push('no_session_cookie');
      }
    }

    if (!detectionMethod) {
      // All three tiers failed. Capture a screenshot and throw.
      const path = await captureScreenshotSafe(page, opts.screenshotPath);
      throw new LoginFailedError(
        `login_failed:${failures.join(',')}`,
        failures,
        path,
        {
          runId: opts.runId,
          correlationId: opts.correlationId,
          connectionId: creds.id,
          loginUrl: config.loginUrl,
        },
      );
    }

    const result: PerformLoginResult = {
      loginDurationMs: Date.now() - start,
      successDetectionMethod: detectionMethod,
      finalUrl: page.url(),
    };

    logger.info('worker.perform_login.success', {
      runId: opts.runId,
      correlationId: opts.correlationId,
      connectionId: creds.id,
      detectionMethod,
      durationMs: result.loginDurationMs,
    });

    return result;
  } catch (err) {
    if (err instanceof LoginFailedError) throw err;

    // Any other failure (navigation timeout, selector miss in the fill step)
    // is also a login failure. Capture a screenshot, record the original
    // error message (truncated, no credentials), and throw.
    const path = await captureScreenshotSafe(page, opts.screenshotPath);
    const message = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    logger.warn('worker.perform_login.failed', {
      runId: opts.runId,
      correlationId: opts.correlationId,
      connectionId: creds.id,
      reason: message,
      screenshotPath: path,
    });
    throw new LoginFailedError(
      `login_failed:${message}`,
      [message],
      path,
      {
        runId: opts.runId,
        correlationId: opts.correlationId,
        connectionId: creds.id,
      },
    );
  }
}

/**
 * Capture a screenshot for failure diagnosis. Best-effort — if the page is
 * already closed or the screenshot capture itself throws, we log and
 * return null rather than masking the original failure.
 */
async function captureScreenshotSafe(page: Page, screenshotPath: string): Promise<string | null> {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
    return screenshotPath;
  } catch (err) {
    logger.warn('worker.perform_login.screenshot_failed', {
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    return null;
  }
}

/**
 * Defensive helper: validate a config object before passing it to
 * performLogin. Returns the same object on success or throws a
 * LoginFailedError with a clear reason if the config is incomplete.
 *
 * Useful for catching config drift in tests / smoke scripts before the
 * worker actually runs Playwright.
 */
export function assertWebLoginConfig(config: WebLoginConfig): WebLoginConfig {
  if (!config.loginUrl) {
    throw new LoginFailedError('config_incomplete:loginUrl', ['loginUrl_missing'], null, {});
  }
  if (!config.username) {
    throw new LoginFailedError('config_incomplete:username', ['username_missing'], null, {});
  }
  return config;
}
