// ---------------------------------------------------------------------------
// testRunRateLimit — in-process sliding-window rate limiter for test runs
// ---------------------------------------------------------------------------
//
// TODO(PROD-RATE-LIMIT): Replace with Redis or DB-backed sliding window before
// scaling to multi-instance deployments. See server/routes/public/formSubmission.ts
// and server/routes/public/pageTracking.ts for the same marker used on public
// public-traffic limiters.
//
// Phase 1 implementation (spec §4.8): a Map<userId, timestamp[]> is sufficient
// for single-instance deployments. Under horizontal scaling the per-user cap
// is multiplied by the instance count, which means the effective limit is
// N × TEST_RUN_RATE_LIMIT_PER_HOUR, not the stated value. The call site
// (checkTestRunRateLimit) stays unchanged when we swap the store.
//
// Guardrails:
//  1. A startup warning is emitted exactly once so the Phase 1 behaviour is
//     surfaced in ops logs rather than silently assumed safe.
//  2. The in-process map is capped at MAX_TRACKED_USERS entries — when the
//     cap is exceeded, the oldest entry (by last-seen timestamp) is evicted.
//     This prevents an unbounded map if many unique userIds trigger test runs.
//
// The window is exactly 1 hour (3600 s). Timestamps older than the window are
// pruned on each check so individual per-user arrays do not grow unboundedly.
// ---------------------------------------------------------------------------

import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
import { logger } from './logger.js';

/** Timestamps (ms) of recent test-run triggers, keyed by userId. */
const windowStore = new Map<string, number[]>();

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_TRACKED_USERS = 10_000;

let startupWarningEmitted = false;
function emitStartupWarningOnce(): void {
  if (startupWarningEmitted) return;
  startupWarningEmitted = true;
  logger.warn('testRunRateLimit.in_process_mode', {
    note: 'Phase 1 in-memory rate limiter — effective cap multiplies by instance count under horizontal scaling. Replace with Redis/DB backing before that happens.',
    perUserLimitPerHour: TEST_RUN_RATE_LIMIT_PER_HOUR,
    maxTrackedUsers: MAX_TRACKED_USERS,
  });
}

function evictOldestIfOverCap(): void {
  if (windowStore.size <= MAX_TRACKED_USERS) return;
  let oldestUserId: string | null = null;
  let oldestLastSeen = Infinity;
  for (const [uid, ts] of windowStore.entries()) {
    const last = ts[ts.length - 1] ?? 0;
    if (last < oldestLastSeen) {
      oldestLastSeen = last;
      oldestUserId = uid;
    }
  }
  if (oldestUserId !== null) windowStore.delete(oldestUserId);
}

/**
 * Record a test-run trigger for the given user. Throws a 429 service-error
 * shape if the user has exceeded TEST_RUN_RATE_LIMIT_PER_HOUR within the
 * rolling hour window.
 */
export function checkTestRunRateLimit(userId: string): void {
  emitStartupWarningOnce();
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const timestamps = (windowStore.get(userId) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= TEST_RUN_RATE_LIMIT_PER_HOUR) {
    throw {
      statusCode: 429,
      message: `Test run rate limit exceeded — maximum ${TEST_RUN_RATE_LIMIT_PER_HOUR} test runs per hour`,
    };
  }
  timestamps.push(now);
  windowStore.set(userId, timestamps);
  evictOldestIfOverCap();
}

/** Reset the in-process store — for use in tests only. */
export function _resetWindowStoreForTest(): void {
  windowStore.clear();
  startupWarningEmitted = false;
}
