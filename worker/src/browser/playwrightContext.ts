// ---------------------------------------------------------------------------
// Playwright persistent context lifecycle. Spec §6.2 + §13.6 (recovery).
//
// Sessions are namespaced per organisation/subaccount/sessionKey to prevent
// cross-tenant access. A path-traversal-safe regex restricts sessionKey to
// alphanumeric+_- characters.
//
// On second consecutive launch failure for the same userDataDir, the
// directory is renamed to <dir>.corrupt.<ts> and a fresh empty dir is used.
// In-memory tracking; reset on worker restart.
// ---------------------------------------------------------------------------

import { promises as fs } from 'fs';
import path from 'path';
import { chromium, type BrowserContext } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { SafetyError, EnvironmentError } from '../../../shared/iee/failureReason.js';

const SESSION_KEY_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const launchFailureCount = new Map<string, number>();

export interface OpenContextInput {
  organisationId: string;
  subaccountId: string | null;
  sessionKey: string | undefined;
  ieeRunId: string;
  downloadsDir: string;
}

export interface OpenContextResult {
  context: BrowserContext;
  userDataDir: string;
}

function buildUserDataDir(input: OpenContextInput): string {
  const sessionKey = input.sessionKey ?? 'default';
  if (!SESSION_KEY_RE.test(sessionKey)) {
    throw new SafetyError(`invalid sessionKey: must match ${SESSION_KEY_RE}`, 'invalid_session_key');
  }
  const effectiveKey = input.subaccountId
    ? `${input.subaccountId}__${sessionKey}`
    : sessionKey;
  return path.join(env.BROWSER_SESSION_DIR, input.organisationId, effectiveKey);
}

export async function openPersistentContext(input: OpenContextInput): Promise<OpenContextResult> {
  const userDataDir = buildUserDataDir(input);

  await fs.mkdir(userDataDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(input.downloadsDir, { recursive: true, mode: 0o700 });

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
      downloadsPath: input.downloadsDir,
    });
    // Successful launch — clear any prior failure count
    launchFailureCount.delete(userDataDir);
    return { context, userDataDir };
  } catch (err) {
    const prevFailures = launchFailureCount.get(userDataDir) ?? 0;
    const failures = prevFailures + 1;
    launchFailureCount.set(userDataDir, failures);

    logger.warn('iee.browser.launch_failed', {
      ieeRunId: input.ieeRunId,
      userDataDir,
      consecutiveFailures: failures,
      error: err instanceof Error ? err.message : String(err),
    });

    if (failures < 2) {
      throw new EnvironmentError(
        `Playwright launch failed (attempt ${failures}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // §13.6 — second consecutive failure: rename and recreate
    const ts = Date.now();
    const corruptedDir = `${userDataDir}.corrupt.${ts}`;
    try {
      await fs.rename(userDataDir, corruptedDir);
    } catch (renameErr) {
      logger.error('iee.browser.session_rename_failed', {
        ieeRunId: input.ieeRunId,
        userDataDir,
        error: renameErr instanceof Error ? renameErr.message : String(renameErr),
      });
      throw new EnvironmentError(`Session corruption recovery failed: ${renameErr}`);
    }
    await fs.mkdir(userDataDir, { recursive: true, mode: 0o700 });

    logger.info('iee.browser.session_recreated', {
      ieeRunId: input.ieeRunId,
      userDataDir,
      corruptedDir,
      reason: 'two_consecutive_launch_failures',
    });

    // One more attempt with the fresh dir
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        acceptDownloads: true,
        viewport: { width: 1280, height: 800 },
        downloadsPath: input.downloadsDir,
      });
      launchFailureCount.delete(userDataDir);
      return { context, userDataDir };
    } catch (err2) {
      throw new EnvironmentError(
        `Playwright launch failed even with fresh session dir: ${err2 instanceof Error ? err2.message : String(err2)}`,
      );
    }
  }
}
