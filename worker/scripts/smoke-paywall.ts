#!/usr/bin/env tsx
/**
 * Smoke test script for the Reporting Agent paywall login flow.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §11.8
 * (manual Playwright smoke test — first thing to run before merging D).
 *
 * Purpose:
 *   - Verify performLogin() works against the real paywall site
 *   - Confirm the configured selectors match the actual page
 *   - Validate the three-tier success detection (T20)
 *   - Capture a screenshot artifact regardless of outcome
 *
 * Why a standalone script: the runHandler integration (D7) wires
 * performLogin into the worker pipeline, but the spec mandates a manual
 * smoke test against the real site BEFORE that wire-up so we know the
 * deterministic login actually works. This script lets you run that
 * verification with no worker, no DB, no LLM — just Playwright + the
 * helper module.
 *
 * Usage:
 *   tsx worker/scripts/smoke-paywall.ts
 *
 * Required environment variables:
 *   SMOKE_LOGIN_URL          e.g. https://42macro.com/login
 *   SMOKE_USERNAME           e.g. reports@breakoutsolutions.com
 *   SMOKE_PASSWORD           plaintext password (env var only — never commit)
 *   SMOKE_CONTENT_URL        (optional) post-login navigation target
 *   SMOKE_SUCCESS_SELECTOR   (optional) e.g. .member-dashboard
 *   SMOKE_USERNAME_SELECTOR  (optional, defaults to standard email selectors)
 *   SMOKE_PASSWORD_SELECTOR  (optional, defaults to standard password selectors)
 *   SMOKE_SUBMIT_SELECTOR    (optional, defaults to button[type=submit])
 *   SMOKE_TIMEOUT_MS         (optional, default 30000)
 *   SMOKE_HEADLESS           (optional, '0' to run headed for debugging)
 *
 * Output:
 *   - Console log of each step
 *   - Screenshot at /tmp/smoke-paywall-<timestamp>.png
 *   - Exit code 0 on success, 1 on failure
 */

import { chromium } from 'playwright';
import { performLogin, LoginFailedError } from '../src/browser/login.js';
import type { DecryptedWebLoginCredentials, Plaintext } from '../src/persistence/integrationConnections.js';

async function main(): Promise<number> {
  const env = process.env;
  const required = ['SMOKE_LOGIN_URL', 'SMOKE_USERNAME', 'SMOKE_PASSWORD'] as const;
  for (const key of required) {
    if (!env[key]) {
      console.error(`error: ${key} is required`);
      console.error('See worker/scripts/smoke-paywall.ts header for usage.');
      return 1;
    }
  }

  const screenshotPath = `/tmp/smoke-paywall-${Date.now()}.png`;
  const headless = env.SMOKE_HEADLESS !== '0';

  const credentials: DecryptedWebLoginCredentials = {
    id: 'smoke-test',
    organisationId: 'smoke-test-org',
    subaccountId: null,
    config: {
      loginUrl: env.SMOKE_LOGIN_URL!,
      contentUrl: env.SMOKE_CONTENT_URL,
      username: env.SMOKE_USERNAME!,
      usernameSelector: env.SMOKE_USERNAME_SELECTOR,
      passwordSelector: env.SMOKE_PASSWORD_SELECTOR,
      submitSelector: env.SMOKE_SUBMIT_SELECTOR,
      successSelector: env.SMOKE_SUCCESS_SELECTOR,
      timeoutMs: env.SMOKE_TIMEOUT_MS ? Number(env.SMOKE_TIMEOUT_MS) : 30_000,
    },
    password: env.SMOKE_PASSWORD! as Plaintext<string>,
  };

  console.log('[smoke] launching chromium', { headless });
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('[smoke] running performLogin', {
      loginUrl: credentials.config.loginUrl,
      hasSuccessSelector: !!credentials.config.successSelector,
      contentUrl: credentials.config.contentUrl,
    });

    try {
      const result = await performLogin(page, credentials, {
        runId: 'smoke-test-run',
        correlationId: 'smoke-test-corr',
        screenshotPath,
      });
      console.log('[smoke] login SUCCEEDED', result);

      // Optional: navigate to contentUrl if set so we can verify the
      // post-login navigation target is reachable.
      if (credentials.config.contentUrl) {
        console.log('[smoke] navigating to contentUrl');
        await page.goto(credentials.config.contentUrl, { waitUntil: 'networkidle' });
        await page.screenshot({ path: screenshotPath });
        console.log('[smoke] contentUrl reached', { url: page.url() });
      }
      return 0;
    } catch (err) {
      if (err instanceof LoginFailedError) {
        console.error('[smoke] login FAILED', {
          message: err.message,
          detectionFailures: err.detectionFailures,
          screenshotPath: err.screenshotPath,
          metadata: err.metadata,
        });
      } else {
        console.error('[smoke] unexpected error', err);
      }
      return 1;
    }
  } finally {
    await browser.close();
    console.log('[smoke] screenshot at', screenshotPath);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[smoke] fatal', err);
    process.exit(1);
  });
