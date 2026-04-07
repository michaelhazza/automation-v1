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
import type { StepExecutor, ActionResult } from '../loop/executionLoop.js';
import { buildBrowserObservation } from './observe.js';
import { openPersistentContext } from './playwrightContext.js';
import { db } from '../db.js';
import { ieeArtifacts } from '../../../server/db/schema/ieeArtifacts.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const SELECTOR_PRIMARY_TIMEOUT_MS = 5_000;

export interface BuildBrowserExecutorInput {
  ieeRunId: string;
  organisationId: string;
  subaccountId: string | null;
  sessionKey: string | undefined;
  startUrl: string | undefined;
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

  return {
    mode: 'browser',
    availableActions: BROWSER_ACTION_TYPES,

    async observe(): Promise<Observation> {
      return buildBrowserObservation(page, lastResult);
    },

    async execute(action: ExecutionAction): Promise<ActionResult> {
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
          await download.saveAs(savePath);
          let sizeBytes: number | null = null;
          try {
            const stat = await fs.stat(savePath);
            sizeBytes = stat.size;
          } catch { /* swallow */ }
          await db.insert(ieeArtifacts).values({
            ieeRunId: input.ieeRunId,
            organisationId: input.organisationId,
            kind: 'download',
            path: savePath,
            sizeBytes: sizeBytes ?? undefined,
            metadata: { selector: action.selector, suggestedName } as object,
          });
          downloadEmitted = true;
          lastResult = `downloaded ${suggestedName} (${sizeBytes ?? '?'} bytes)`;
          return {
            output: { path: savePath, sizeBytes },
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
