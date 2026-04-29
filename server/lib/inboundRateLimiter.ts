/**
 * inboundRateLimiter.ts — Postgres-backed sliding-window rate-limit primitive.
 *
 * Single CTE round-trip per check: derives window boundaries from DB time,
 * UPSERTs the current bucket, reads the prior bucket, and returns counts.
 * The DB is the canonical clock so multi-instance topologies cannot fragment
 * buckets via clock skew (spec §6.2.3 invariant).
 *
 * Pure math is in inboundRateLimiterPure.ts (separately testable without IO).
 *
 * Spec §6.2.3, §7.1, §10.1.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from './logger.js';
import { computeEffectiveCount } from './inboundRateLimiterPure.js';

export interface RateLimitCheckResult {
  /** True if this call is permitted; false means the caller MUST reject. */
  allowed: boolean;
  /**
   * Remaining calls in the current effective window after this one is counted.
   * Clamped at 0. Instantaneous estimate only.
   */
  remaining: number;
  /**
   * End of the current FIXED window. Approximation.
   */
  resetAt: Date;
}

/**
 * Derives the `Retry-After` header value (whole seconds) from a `resetAt` instant.
 * Centralised so every 429 emission shares the same rounding rule.
 */
export function getRetryAfterSeconds(resetAt: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
}

/**
 * Policy header tag emitted on every 429 response.
 */
export const RATE_LIMIT_POLICY_HEADER_VALUE = 'sliding-window;no-auto-retry';

/**
 * Sets the canonical 429 response headers: `Retry-After` (RFC 7231)
 * and `X-RateLimit-Policy`.
 */
export function setRateLimitDeniedHeaders(res: import('express').Response, resetAt: Date): void {
  res.set('Retry-After', String(getRetryAfterSeconds(resetAt)));
  res.set('X-RateLimit-Policy', RATE_LIMIT_POLICY_HEADER_VALUE);
}

interface CheckRow {
  current_count: number;
  curr_window_start: Date;
  prev_count: number;
  now_epoch: number;
  curr_epoch: number;
}

/**
 * Sliding-window rate-limit check. Atomic UPSERT — every call increments the
 * bucket regardless of allowed/denied.
 *
 * @param key       Caller-defined opaque string from rateLimitKeys.ts builders.
 * @param limit     Maximum allowed calls per window.
 * @param windowSec Window size in seconds.
 */
export async function check(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitCheckResult> {
  if (!Number.isInteger(windowSec) || windowSec <= 0) {
    throw new Error(`inboundRateLimiter.check: windowSec must be a positive integer (got ${windowSec})`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`inboundRateLimiter.check: limit must be a positive integer (got ${limit})`);
  }
  const result = await db.execute<CheckRow>(sql`
    WITH bounds AS (
      SELECT
        to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec})            AS curr_start,
        to_timestamp((floor(extract(epoch from now()) / ${windowSec}) - 1) * ${windowSec})      AS prev_start,
        extract(epoch from now())                                                                AS now_epoch,
        floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}                           AS curr_epoch
    ),
    upserted AS (
      INSERT INTO rate_limit_buckets (key, window_start, count)
      SELECT ${key}, curr_start, 1 FROM bounds
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = rate_limit_buckets.count + 1
      RETURNING count AS current_count, window_start AS curr_window_start
    ),
    prev AS (
      SELECT count AS prev_count
      FROM rate_limit_buckets, bounds
      WHERE key = ${key} AND window_start = bounds.prev_start
    )
    SELECT
      upserted.current_count,
      upserted.curr_window_start,
      COALESCE(prev.prev_count, 0) AS prev_count,
      bounds.now_epoch,
      bounds.curr_epoch
    FROM upserted CROSS JOIN bounds LEFT JOIN prev ON true
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error('inboundRateLimiter.check: CTE produced no row');
  }

  const elapsedFraction = (Number(row.now_epoch) - Number(row.curr_epoch)) / windowSec;
  const effectiveCount = computeEffectiveCount(
    Number(row.prev_count),
    Number(row.current_count),
    elapsedFraction,
  );
  const allowed = effectiveCount <= limit;
  const remaining = Math.max(0, Math.floor(limit - effectiveCount));
  const currWindowStartMs =
    row.curr_window_start instanceof Date
      ? row.curr_window_start.getTime()
      : new Date(row.curr_window_start as unknown as string).getTime();
  const resetAt = new Date(currWindowStartMs + windowSec * 1000);

  if (!allowed) {
    logger.info('rate_limit.denied', {
      key,
      limit,
      windowSec,
      currentCount: Number(row.current_count),
      effectiveCount,
      remaining,
      resetAt: resetAt.toISOString(),
    });
  }

  return { allowed, remaining, resetAt };
}
