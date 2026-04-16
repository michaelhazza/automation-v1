// ---------------------------------------------------------------------------
// testRunRateLimit — in-process sliding-window rate limiter for test runs
// ---------------------------------------------------------------------------
//
// Phase 1 implementation (spec §4.8): a Map<userId, timestamp[]> is sufficient
// for single-instance deployments. When multi-instance deploys become standard,
// swap the store for a Redis-backed sorted set — the call site (checkTestRunRateLimit)
// stays unchanged.
//
// The window is exactly 1 hour (3600 s). Timestamps older than the window are
// pruned on each check so the map does not grow unboundedly.
// ---------------------------------------------------------------------------

import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';

/** Timestamps (ms) of recent test-run triggers, keyed by userId. */
const windowStore = new Map<string, number[]>();

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Record a test-run trigger for the given user. Throws a 429 service-error
 * shape if the user has exceeded TEST_RUN_RATE_LIMIT_PER_HOUR within the
 * rolling hour window.
 */
export function checkTestRunRateLimit(userId: string): void {
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
}
