/**
 * server/services/optimiser/optimiserCronPure.ts
 *
 * Pure helper: computes a deterministic cron expression for a given subaccountId.
 *
 * Formula:
 *   hash = sha256(subaccountId) as hex
 *   minute = parseInt(hash.slice(0, 2), 16) % 60     → 0-59
 *   hour   = 6 + (parseInt(hash.slice(2, 4), 16) % 6) → 6-11
 *   cron   = `${minute} ${hour} * * *`
 *
 * Properties:
 *   - Deterministic: same subaccountId always produces the same cron.
 *   - Staggered: uniformly distributed across 06:00-11:59 UTC.
 *   - Pure: no I/O, no clock reads. Safe to call from tests without mocking.
 *
 * Used by both the backfill script and the subaccountService.create hook
 * so that new sub-accounts inherit the same staggering rule rather than
 * clustering on a fixed 0 6 * * * cron (spec §4 + §13 schedule storm).
 *
 * Spec: docs/sub-account-optimiser-spec.md §4, §13
 */

import { createHash } from 'crypto';

/**
 * Compute a deterministic daily cron for the given subaccountId.
 * Returns a 5-field cron string, e.g. "47 8 * * *".
 */
export function computeOptimiserCron(subaccountId: string): string {
  const hash = createHash('sha256').update(subaccountId).digest('hex');
  const minute = parseInt(hash.slice(0, 2), 16) % 60;
  const hour = 6 + (parseInt(hash.slice(2, 4), 16) % 6);
  return `${minute} ${hour} * * *`;
}
